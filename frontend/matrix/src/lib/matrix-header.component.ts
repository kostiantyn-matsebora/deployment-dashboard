// Environment column headers — rendered above the pipeline rows. Width and
// spacing match the active view's row dimensions from the mockup.

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { EnvironmentDescriptor, ViewId } from '@dd/shared';

@Component({
  selector: 'dd-matrix-header',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 pt-4 pb-2" [attr.data-view]="view()">
      <div class="flex items-center">
        <div class="shrink-0" [class]="labelColClass()"></div>
        <div class="flex items-center overflow-x-auto" [class.gap-1\\.5]="view() === 'glance'">
          @for (env of environments(); track env.id; let idx = $index) {
            <div class="flex items-center">
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
