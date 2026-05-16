// Environment column headers — rendered above the pipeline rows. Width and
// spacing match the active view's row dimensions from the mockup.
//
// NFR-09 sibling invariant #7 — env-header column alignment under Matrix
// Focus expand. In Focus view, every header cell consumes
// `style="width: var(--leaf-width)"` and every connector consumes
// `style="width: var(--focus-arrow-gap)"`. Both variables are written on
// the parent Focus wrapper by `dd-pipeline-matrix` and flip to the
// expanded values when ANY service is expanded — so header + rows widen
// in lock-step. Mirrors mockup lines 1720-1741.
//
// Two horizontal-alignment subtleties resolved here:
//
//  1. CSS-specificity shadowing. `frontend/dashboard/src/styles.css` carries
//     `[data-view="focus"] { --leaf-width: 160px; }` to seed the per-view
//     default. The outer `<div>` here binds `[attr.data-view]="view()"` —
//     so when view==='focus' the CSS rule fires LOCALLY on this element
//     and sets `--leaf-width: 160px` on it, shadowing the parent Focus
//     wrapper's inline `--leaf-width: 200px`. Result: header cells stayed
//     at 160 px after expand. Fix: in Focus view bind the parent wrapper's
//     focusStyle inline on this SAME element (input `focusStyle`); inline
//     style specificity (1,0,0,0) beats the attribute selector (0,0,1,0)
//     so the wrapper's value wins on this element AND inherits down to
//     every header cell.
//
//  2. 13-px left-inset mismatch between header and rows. Each focus-row
//     carries `bg-white rounded-md border px-3 py-1.5` chrome — a 1 px
//     border + 12 px left padding pushes the row's `w-44` label column
//     and its leaf cells 13 px right of where the un-chromed header sat.
//     Fix: in Focus view the inner flex container adds `pl-[13px]` so the
//     header's `w-44` label spacer + leaf cells start at the same x as
//     each row's. Geometry is now: header(left) === row(left) for every
//     cell, regardless of expand state.

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { EnvironmentDescriptor, ViewId } from '@dd/shared';

@Component({
  selector: 'dd-matrix-header',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="px-6 pt-4 pb-2"
      [attr.data-view]="view()"
      [attr.style]="view() === 'focus' ? focusStyle() : null"
    >
      <div
        class="flex items-center"
        [attr.style]="view() === 'focus' ? 'padding-left: 13px' : null"
      >
        <div class="shrink-0" [class]="labelColClass()"></div>
        <div class="flex items-center overflow-x-auto" [class.gap-1\\.5]="view() === 'glance'">
          @for (env of environments(); track env.id; let idx = $index) {
            <div class="flex items-center">
              @if (view() === 'focus') {
                <div class="text-center" style="width: var(--leaf-width)">
                  <span
                    class="text-[10px] font-semibold uppercase tracking-widest text-gray-400"
                    [attr.data-testid]="'env-header-' + env.id"
                  >{{ env.label }}</span>
                </div>
                @if (idx < environments().length - 1) {
                  <div style="width: var(--focus-arrow-gap)"></div>
                }
              } @else {
                <div class="text-center" [class]="cellClass()">
                  <span
                    class="font-semibold uppercase tracking-widest text-gray-400"
                    [class.text-xs]="view() === 'detailed'"
                    [class.text-\\[10px\\]]="view() !== 'detailed'"
                    [attr.data-testid]="'env-header-' + env.id"
                  >{{ env.label }}</span>
                </div>
                @if (idx < environments().length - 1 && view() !== 'glance') {
                  <div [class]="connectorClass()"></div>
                }
              }
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class MatrixHeaderComponent {
  readonly environments = input.required<readonly EnvironmentDescriptor[]>();
  readonly view = input<ViewId>('detailed');
  /**
   * Focus-view only — surfaced for consumers that want to render
   * additional chrome (e.g. test markers) when expanded. The actual width
   * resolution happens via the shared `--leaf-width` CSS variable.
   */
  readonly hasExpanded = input<boolean>(false);
  /**
   * Focus-view only — inline-style string written by `<dd-pipeline-matrix>`
   * that carries `--leaf-width` / `--leaf-width-expanded` /
   * `--focus-arrow-gap`. Applied on the same element that owns
   * `data-view="focus"` so inline-style specificity beats the
   * `[data-view="focus"]` CSS rule in styles.css (which would otherwise
   * shadow the parent wrapper's `--leaf-width` on this element).
   */
  readonly focusStyle = input<string>('');

  readonly labelColClass = computed(() => {
    switch (this.view()) {
      case 'detailed': return 'w-44';
      case 'compact':  return 'w-36';
      case 'glance':   return 'w-40';
      case 'focus':    return 'w-44';
    }
  });

  readonly cellClass = computed(() => {
    switch (this.view()) {
      case 'detailed': return 'w-40';
      case 'compact':  return 'w-[120px]';
      case 'glance':   return 'w-[110px]';
      case 'focus':    return 'w-[120px]';
    }
  });

  readonly connectorClass = computed(() => {
    switch (this.view()) {
      case 'detailed': return 'w-10';
      case 'compact':  return 'w-3.5';
      case 'focus':    return 'w-3.5';
      default:         return 'w-0';
    }
  });
}
