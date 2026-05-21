// Per-position env-tag column-width unifier for workflow-rows mode. Fixes
// issue #23: each `.leaf-pair` is an independent CSS Grid whose column-1
// (`auto`) sizes only to its own env-tag content, so adjacent rows of the
// same service with different env-label widths push their nth deployment
// cell to different X positions.
//
// Within each `.svc-block` host, this directive walks every `.leaf-pair`
// grouped by its `data-env-position` (the path-position index within that
// row), takes the max intrinsic env-tag width at each position, applies the
// ceil+1px subpixel-safety rule, and writes `--env-tag-col-{idx}-width` CSS
// custom properties onto the block. Each `.leaf-pair` reads the variable
// matching its own position via `--env-tag-col-width` resolved in the
// stylesheet (see styles.css `.leaf-pair[data-env-position="…"]`).
//
// Per-service-block scope ONLY — never cross-service. Mirrors the swim-lane
// `.depth-slot` mental model (every leaf-pair at depth N shares one grid /
// width slot) but applied positionally inside a single service's workflow-
// row stack rather than across services.
//
// NFR-09 preservation:
//   (a) `.leaf-pair` cells remain in CSS Grid; column-1 and column-2 cannot
//       overlap by construction. Only how column-1's width is computed
//       changes (per-position-max instead of per-cell-auto).
//   (b) Arrow anchors continue to attach to MEASURED stage-box rects via
//       `recomputeConnectorTops`. Wider column-1 reflows the rect; the
//       recompute already keys off measured positions, so arrow geometry
//       reflows automatically.
//   (c) The new per-block `ResizeObserver` + `MutationObserver` mirror the
//       trigger model used by `SvcNameColumnWidthDirective`. Custom-property
//       writes are idempotent and rAF-debounced.
//
// Mirrors `SvcNameColumnWidthDirective` (observer topology, sandbox-based
// measurement, lazy single-instance ResizeObserver) but is HOST-scoped to
// `.svc-block` rather than container-scoped to the per-layout host.

import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject
} from '@angular/core';

/**
 * Subpixel-safety margin added to each measured intrinsic max-content width.
 * Float-truncating an `Xpx` reservation can leave a sub-pixel sliver shorter
 * than the rendered text on some DPRs / font hinting paths, dropping the
 * last glyph into the column-gap. The +1 px guard makes the reservation
 * provably wider than the rendered text in all observed combinations.
 */
const SUBPIXEL_SAFETY_PX = 1;

@Directive({
  selector: '[ddEnvTagColumnWidth]',
  standalone: true
})
export class EnvTagColumnWidthDirective {
  private readonly hostRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly observedCells = new WeakSet<Element>();
  private readonly resizeHandler = (): void => this.scheduleRecompute();
  /** Per-position last-written px values — short-circuit identical writes. */
  private readonly lastPx = new Map<number, number>();
  /** rAF coalesce flag for all async recompute triggers. */
  private scheduled = false;

  private scheduleRecompute(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => requestAnimationFrame(() => {
      this.scheduled = false;
      this.recompute();
    }));
  }

  constructor() {
    // Mirrors `SvcNameColumnWidthDirective` lifecycle:
    //   - `afterNextRender` — one-shot initial measure post first paint.
    //   - `MutationObserver` on host subtree (childList) — covers row /
    //     env-tag mount-unmount (filter, search, layout switch, SSE,
    //     workflow-rows expand/collapse, focus toggle).
    //   - `ResizeObserver` on host + each measured env-tag — covers font
    //     load, browser zoom, viewport resize, content reflow.
    //   - window `resize` belt-and-braces.
    //
    // `afterEveryRender` deliberately avoided: it would re-fire during
    // every CD pass alongside the layout component's signal-writing
    // afterRender hooks, tripping NG0103 on zoneless.
    afterNextRender({
      mixedReadWrite: () => {
        this.recompute();
        this.attachMutationObserver();
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }
    this.destroyRef.onDestroy(() => {
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', this.resizeHandler);
      }
      if (this.sandboxEl && this.sandboxEl.isConnected) {
        this.sandboxEl.remove();
      }
      this.sandboxEl = null;
    });
  }

  /**
   * Walk every `.leaf-pair[data-env-position]` inside the host `.svc-block`,
   * bucket by position index, measure each env-tag's intrinsic max-content
   * width, take the per-position max, apply ceil+1px, and write one
   * `--env-tag-col-{idx}-width` custom property per position on the host.
   *
   * Glance view exception: `.leaf-pair-glance` collapses to one column with
   * the env-tag rendered INSIDE the pill — it has no outside-the-box env-tag
   * to measure. Such cells are skipped; if EVERY cell at a position is in
   * Glance, no variable is written and the CSS fallback (`auto`) applies.
   */
  private recompute(): void {
    const host = this.hostRef.nativeElement;
    if (!host) return;
    const buckets = this.collectByPosition(host);
    const positionsSeen = new Set<number>();
    const measuredCells: HTMLElement[] = [];
    for (const [pos, cells] of buckets) {
      positionsSeen.add(pos);
      let maxContent = 0;
      for (const cell of cells) {
        measuredCells.push(cell);
        const w = this.measureEnvTag(cell);
        if (w > maxContent) maxContent = w;
      }
      if (maxContent <= 0) continue;
      const finalPx = Math.ceil(maxContent) + SUBPIXEL_SAFETY_PX;
      if (this.lastPx.get(pos) === finalPx) continue;
      host.style.setProperty(`--env-tag-col-${pos}-width`, `${finalPx}px`);
      this.lastPx.set(pos, finalPx);
    }
    // Clear stale positions (path shortened / row removed) so a previously-
    // written wider column doesn't linger after the data shrinks.
    for (const pos of Array.from(this.lastPx.keys())) {
      if (positionsSeen.has(pos)) continue;
      host.style.removeProperty(`--env-tag-col-${pos}-width`);
      this.lastPx.delete(pos);
    }
    this.attachObserver(host, measuredCells);
  }

  /**
   * Group `.leaf-pair[data-env-position]` cells by their position index.
   * Returns a map keyed by integer position; ordering is insertion order.
   * Glance cells (`.leaf-pair-glance`) are skipped — they have no outside
   * env-tag to measure.
   */
  private collectByPosition(host: HTMLElement): Map<number, HTMLElement[]> {
    const buckets = new Map<number, HTMLElement[]>();
    const pairs = host.querySelectorAll<HTMLElement>(
      '.leaf-pair[data-env-position]'
    );
    for (const pair of Array.from(pairs)) {
      if (pair.classList.contains('leaf-pair-glance')) continue;
      const tag = pair.querySelector<HTMLElement>(':scope > .env-tag');
      if (!tag) continue;
      const rawPos = pair.getAttribute('data-env-position');
      const pos = rawPos === null ? NaN : Number(rawPos);
      if (!Number.isFinite(pos) || pos < 0) continue;
      const bucket = buckets.get(pos) ?? [];
      bucket.push(tag);
      buckets.set(pos, bucket);
    }
    return buckets;
  }

  /**
   * Measure the env-tag's intrinsic (max-content) width. The live element
   * sits inside a CSS Grid track whose width we are trying to compute, so
   * reading its own dimensions would return the CURRENT track width
   * (chicken-and-egg). Deep-clone into an off-screen `width: max-content`
   * sandbox and read `getBoundingClientRect().width` — that IS the
   * intrinsic size by browser definition.
   */
  private measureEnvTag(cell: HTMLElement): number {
    const sandbox = this.sandbox();
    if (!sandbox) return 0;
    const clone = cell.cloneNode(true) as HTMLElement;
    clone.style.width = 'max-content';
    clone.style.minWidth = '0';
    clone.style.maxWidth = 'none';
    sandbox.appendChild(clone);
    const w = clone.getBoundingClientRect().width;
    sandbox.removeChild(clone);
    return w;
  }

  /**
   * Lazily-created off-screen measurement sandbox. Sits at document.body
   * root (so it inherits the same font / Tailwind context as live cells)
   * but is positioned out of view and ignored by layout.
   * `width: max-content` flexes out to whatever the cloned env-tag
   * intrinsically needs.
   */
  private sandboxEl: HTMLDivElement | null = null;
  private sandbox(): HTMLDivElement | null {
    if (typeof document === 'undefined') return null;
    if (this.sandboxEl && this.sandboxEl.isConnected) return this.sandboxEl;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:-99999px;top:0;visibility:hidden;' +
      'pointer-events:none;width:max-content;contain:layout style;';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-env-tag-col-sandbox', '');
    document.body.appendChild(el);
    this.sandboxEl = el;
    return el;
  }

  /**
   * Lazily attach one ResizeObserver for the directive's lifetime; observe
   * the host plus every env-tag cell we haven't seen yet. Reusing the same
   * observer (vs. recreating per render) avoids the initial-callback storm
   * that creating a new observer per recompute would unleash on zoneless
   * change detection — see SvcNameColumnWidthDirective for the same
   * defence.
   */
  private attachObserver(host: HTMLElement, cells: readonly HTMLElement[]): void {
    if (typeof ResizeObserver === 'undefined') return;
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRecompute());
      this.resizeObserver.observe(host);
      this.observedCells.add(host);
    }
    for (const c of cells) {
      if (this.observedCells.has(c)) continue;
      this.resizeObserver.observe(c);
      this.observedCells.add(c);
    }
  }

  /**
   * Watch the host subtree for childList mutations — rows mount/unmount on
   * filter, search, layout switch, SSE data change, workflow-rows expand /
   * collapse, focus expand. Schedules a single coalesced recompute.
   */
  private attachMutationObserver(): void {
    if (typeof MutationObserver === 'undefined') return;
    if (this.mutationObserver) return;
    const host = this.hostRef.nativeElement;
    if (!host) return;
    this.mutationObserver = new MutationObserver(() => this.scheduleRecompute());
    this.mutationObserver.observe(host, { childList: true, subtree: true });
  }
}
