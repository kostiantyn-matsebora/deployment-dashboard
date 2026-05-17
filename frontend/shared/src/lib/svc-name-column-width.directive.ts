// Unifies the service-name column width across every row in a per-layout
// container so deployment columns start at the same horizontal x for every
// service (NFR-09 #6 uniform-column-width strengthening). Mirrors the
// canonical mockup's `recomputeSvcNameColumnWidth()` helper
// (docs/ui/deployment-dashboard.html).
//
// The directive walks every service-name cell inside the host element
// (`.lane-label` for swim-lane; `.svc-block .svc-block-meta > .svc-block-
// meta-row:first-child` for workflow-rows), takes the max intrinsic
// content width across them, applies the 176-px floor, and writes the
// result onto the host as the `--svc-name-col-width` CSS custom property.
//
// Variable lives on the per-layout CONTAINER (NOT on `:root`) so two
// independent layouts on the same page can have independent widths and so
// that switching layouts doesn't leak stale widths across boundaries.
//
// Re-measurement triggers:
//   - `afterNextRender` — one-shot initial measure after the first paint.
//   - `MutationObserver` on the host subtree (childList) — covers all
//     Angular-driven row mount/unmount (filter, search, layout switch,
//     SSE data change). Cheaper than `afterEveryRender` and avoids the
//     zoneless NG0103 hazard.
//   - `ResizeObserver` on the host AND every measured cell — covers
//     non-DOM-mutation triggers (font load, browser zoom, viewport
//     resize, content reflow inside an existing cell).
//   - window `resize` listener — belt-and-braces against viewport-driven
//     reflow that the ResizeObserver path may miss on some platforms.
//
// Measurement is done by deep-cloning each cell into an off-screen
// `width: max-content` sandbox and reading `getBoundingClientRect().
// width`. Summing children's widths in-place doesn't work because
// `.lane-label` is flex-COLUMN (sums vertical-stack widths) and child
// `scrollWidth` reflects current laid-out width, not intrinsic. The
// clone approach delegates intrinsic-size math to the browser.

import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject
} from '@angular/core';

/** 176-px typical-name visual-reservation floor. */
const FLOOR_PX = 176;

@Directive({
  selector: '[ddSvcNameColumnWidth]',
  standalone: true
})
export class SvcNameColumnWidthDirective {
  private readonly hostRef = inject(ElementRef) as ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly observedCells = new WeakSet<Element>();
  private readonly resizeHandler = (): void => this.scheduleRecompute();
  /** Last written px value — short-circuit identical writes. */
  private lastPx = -1;
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
    // One-shot initial measure after the first paint. All subsequent
    // updates are driven by three non-Angular observers:
    //
    //   - `MutationObserver` on the host (subtree childList) — fires
    //     when rows mount / unmount (filter, search, layout switch,
    //     SSE-driven data change). This is the main source of
    //     re-measurement; new rows mean new content widths.
    //   - `ResizeObserver` on host + each measured cell — covers
    //     non-DOM-mutation triggers (font load, browser zoom,
    //     viewport resize, content reflow inside an existing cell).
    //   - `window` resize listener — belt-and-braces against viewport
    //     resizes the ResizeObserver path may miss on some platforms.
    //
    // We deliberately do NOT use `afterEveryRender`: it would re-fire
    // during every CD pass alongside the layout components' own
    // signal-writing afterRender hooks, and stacking the two trips
    // Angular's zoneless NG0103 infinite-render guard even though no
    // single hook is itself unstable.
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
   * Walk every service-name cell, take the max intrinsic content width,
   * apply the 176-px floor + ceil-to-whole-px guard, and write
   * `--svc-name-col-width` on the host element. Re-attach the
   * ResizeObserver so newly-mounted cells are watched.
   *
   * Empty-cells case: leave the existing value alone rather than reset.
   * The same render cycle that mounts the @for-driven cells may see
   * `cells.length === 0` followed by a non-zero count on the next pass;
   * removing + re-writing would create a no-op style mutation pair that
   * trips Angular's zoneless NG0103 infinite-render guard when stacked
   * against the layout components' signal-write afterRender hooks.
   */
  private recompute(): void {
    const host = this.hostRef.nativeElement;
    if (!host) return;
    const cells = this.collectCells(host);
    if (cells.length === 0) {
      // First-ever measurement with no cells - emit the floor so the
      // initial paint reserves space; subsequent empty passes are no-ops.
      if (this.lastPx === -1) {
        host.style.setProperty('--svc-name-col-width', `${FLOOR_PX}px`);
        this.lastPx = FLOOR_PX;
      }
      this.attachObserver(host, []);
      return;
    }
    let maxContent = 0;
    for (const cell of cells) {
      const w = this.measureCell(cell);
      if (w > maxContent) maxContent = w;
    }
    const finalPx = Math.ceil(Math.max(FLOOR_PX, maxContent));
    if (finalPx !== this.lastPx) {
      host.style.setProperty('--svc-name-col-width', `${finalPx}px`);
      this.lastPx = finalPx;
    }
    this.attachObserver(host, cells);
  }

  /**
   * Pick the cell shape that matches this host. Swim-lane uses
   * `.lane-label` (the leftmost flex column with the name); workflow-rows
   * uses the first `.svc-block-meta-row` inside each `.svc-block-meta`
   * (the row that carries the chevron + service-name <p> + workflow-count
   * badge — the ONE that drives the column's content-width minimum).
   */
  private collectCells(host: HTMLElement): HTMLElement[] {
    const swimLane = host.querySelectorAll<HTMLElement>('.lane-label');
    if (swimLane.length > 0) return Array.from(swimLane);
    const wf = host.querySelectorAll<HTMLElement>(
      '.svc-block .svc-block-meta > .svc-block-meta-row:first-child'
    );
    return Array.from(wf);
  }

  /**
   * Measure the cell's intrinsic (max-content) width — the width the cell
   * would take if its column was unconstrained. This is the value we
   * actually need to unify across rows: any lesser value would leave at
   * least one row's content clipped or overflowing the cell border.
   *
   * Why not just sum children's `scrollWidth` + padding + gap?
   *   - `.lane-label` is flex-COLUMN. Children stack vertically; summing
   *     their widths is meaningless (massively overestimates — every
   *     vertical-stack row's width adds up). The chevron+pin row, the
   *     name <p>, the failure label and the topology hint would all be
   *     summed instead of max'd, producing values 3-5x reality.
   *   - `.svc-block-meta-row` is flex-ROW but children like the `wfs`
   *     badge use Tailwind utility classes that don't pre-size them; a
   *     child's `scrollWidth` reflects its current laid-out width which
   *     equals its content width only when nothing has shrunk it. The
   *     name <p> uses `width: max-content` (intrinsic), but the badge
   *     and chevron are governed by flex sizing.
   *
   * Approach — let the browser do the math: clone the cell into an
   * off-screen sandbox sized at `max-content`, measure
   * `getBoundingClientRect().width` of the clone, throw it away. The
   * clone preserves every computed style (Tailwind utilities included)
   * because we deep-clone the live element; the sandbox just removes the
   * column-width constraint that the live grid imposes.
   */
  private measureCell(cell: HTMLElement): number {
    const sandbox = this.sandbox();
    if (!sandbox) return 0;
    const clone = cell.cloneNode(true) as HTMLElement;
    // Strip any width-constraining inline styles inherited from the
    // live cell so the clone is free to grow to max-content. The grid-
    // imposed track width on the live element doesn't carry across the
    // clone (different parent), but a stray inline `width:` would.
    clone.style.width = 'max-content';
    clone.style.minWidth = '0';
    clone.style.maxWidth = 'none';
    sandbox.appendChild(clone);
    const w = clone.getBoundingClientRect().width;
    sandbox.removeChild(clone);
    return w;
  }

  /**
   * Lazily-created off-screen measurement sandbox. Sits at the
   * document.body root (so it inherits the same font / Tailwind context
   * as live cells) but is positioned out of view and ignored by layout.
   * `width: max-content` inside flexes out to whatever the cloned cell
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
    el.setAttribute('data-svc-name-col-sandbox', '');
    document.body.appendChild(el);
    this.sandboxEl = el;
    return el;
  }

  /**
   * Attach the ResizeObserver lazily (one instance for the directive's
   * lifetime) and incrementally observe the host + every cell we haven't
   * seen yet. The previous implementation re-created the observer on
   * every render — `new ResizeObserver(...).observe(el)` fires an initial
   * callback per observed element, which then scheduled another recompute,
   * which re-created the observer again, causing an infinite render
   * loop (NG0103) on zoneless change detection.
   *
   * `observedCells` tracks elements we've already wired so re-observation
   * is a no-op even though `observe()` on an already-observed element is
   * also a no-op (defence-in-depth and saves an extra observe call).
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
   * Watch the host's subtree for childList mutations — fires when rows
   * mount / unmount (filter, search, layout switch, SSE data change).
   * Schedules a single coalesced recompute via the shared rAF queue.
   * Attached once, post-first-render, and torn down with the directive.
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
