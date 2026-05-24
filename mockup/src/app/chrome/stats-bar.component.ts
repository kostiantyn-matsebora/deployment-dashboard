// Hand-authored visual mirror of the stats-bar from frontend/dashboard/.
// Static: hardcoded counts mirroring the canonical fixture set (4 services, 5 envs, 20 slots).

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { MatrixState, ServiceDescriptor } from '../fixtures/index';

@Component({
  selector: 'dd-mockup-stats-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white border-b border-gray-100 px-6 py-1.5 flex items-center gap-6 text-xs text-gray-500"
         data-testid="stats-bar-left">
      <span><strong class="text-gray-700">{{ serviceCount }}</strong> services</span>
      <span><strong class="text-gray-700">{{ envCount }}</strong> environments</span>
      <span
        class="text-red-600 font-medium"
        [class.hidden]="failureCount === 0"
      ><strong>{{ failureCount }}</strong> failure{{ failureCount === 1 ? '' : 's' }}</span>
      <span
        class="text-orange-600"
        [class.hidden]="runningCount === 0"
      ><strong>{{ runningCount }}</strong> running</span>
      <span class="ml-auto text-gray-400 italic">Mockup · static fixtures</span>
    </div>
  `
})
export class StatsBarComponent {
  @Input() serviceCount = 4;
  @Input() envCount = 5;
  @Input() failureCount = 2;
  @Input() runningCount = 3;
}
