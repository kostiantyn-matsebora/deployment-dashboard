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
// Re-measurement triggers (the same shape every other geometric recompute
// in this codebase uses):
//   - `afterEveryRender` (DOM-write phase) — covers all Angular-driven
//     mutations (data load, filter, view / layout switch, focus expand /
//     collapse, drawer open / close).
//   - `ResizeObserver` on the host AND every measured cell — covers
//     non-Angular triggers (font load, browser zoom, viewport resize,
//     content reflow inside the cell).
//   - window `resize` listener — belt-and-braces against viewport-driven
//     reflow that the ResizeObserver path may miss on some platforms.

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
  private readonly observedCells = new WeakSet<Element>();
  private readonly resizeHandler = (): void => this.recompute();
  /** Last written px value — short-circuit identical writes. */
  private lastPx = -1;
  /** rAF coalesce flag for ResizeObserver-driven recomputes. */
  private roScheduled = false;

  constructor() {
    // One-shot initial measure after the first paint. Subsequent updates
    // are driven entirely by the `ResizeObserver` attached inside
    // `recompute()` (host + per-cell observation), which catches both
    // Angular-driven mutations (new cells, content edits — they resize the
    // host) and non-Angular triggers (font load, browser zoom, viewport).
    // We deliberately do NOT use `afterEveryRender` here: it would re-fire
    // during every CD pass alongside the layout components' own
    // signal-writing afterRender hooks, and stacking the two trips
    // Angular's zoneless NG0103 infinite-render guard even though no
    // single hook is itself unstable.
    afterNextRender({
      mixedReadWrite: () => this.recompute()
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', this.resizeHandler);
      }
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
   * Measure the cell's intrinsic content width. The service-name <p>s
   * already use `width: max-content` per NFR-09 #6, so scrollWidth on the
   * children reflects the unclipped content width. We sum every direct
   * visible child + the cell's column-gap + horizontal padding so the
   * computed value matches the box the grid would reserve to fit ALL
   * content without truncation. Hidden children (display:none /
   * visibility:hidden) are skipped — Focus-only chevron/pin shouldn't
   * inflate the column when Focus isn't active.
   */
  private measureCell(cell: HTMLElement): number {
    const cs = window.getComputedStyle(cell);
    const padX =
      parseFloat(cs.paddingLeft || '0') +
      parseFloat(cs.paddingRight || '0');
    const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
    const children = Array.from(cell.children).filter(c => {
      const ccs = window.getComputedStyle(c);
      return ccs.display !== 'none' && ccs.visibility !== 'hidden';
    });
    let row = 0;
    for (const c of children) {
      row += (c as HTMLElement).scrollWidth;
    }
    if (children.length > 1 && gap > 0) row += gap * (children.length - 1);
    return row + padX;
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
      this.resizeObserver = new ResizeObserver(() => {
        if (this.roScheduled) return;
        this.roScheduled = true;
        queueMicrotask(() => requestAnimationFrame(() => {
          this.roScheduled = false;
          this.recompute();
        }));
      });
      this.resizeObserver.observe(host);
      this.observedCells.add(host);
    }
    for (const c of cells) {
      if (this.observedCells.has(c)) continue;
      this.resizeObserver.observe(c);
      this.observedCells.add(c);
    }
  }
}
