// Hand-authored visual mirror of the stats-bar from frontend/dashboard/.
// Pass 2 chrome parity — label-first format matching SPA:
//   Services N/N · Failures N · Last deploy X ago · Never reached PROD N
// Running count folded into Services widget as small orange pulse dot
// when in-flight deployments exist (not a standalone column).

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'dd-mockup-stats-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white border-b border-gray-100 px-6 py-1.5 flex items-center justify-between gap-6 text-xs text-gray-500"
      data-testid="stats-bar"
    >
      <!-- Left cluster -->
      <div class="flex items-center gap-5" data-testid="stats-bar-left">

        <!-- Services N/N (with optional orange pulse dot when deployments in-flight) -->
        <span class="flex items-center gap-1.5" data-testid="stats-services">
          <span class="text-gray-500">Services</span>
          <span class="font-semibold text-gray-700">{{ serviceCount }}/{{ serviceCount }}</span>
          @if (runningCount > 0) {
            <span class="relative flex h-1.5 w-1.5 ml-0.5" [title]="runningCount + ' running'">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
            </span>
          }
        </span>

        <!-- Failures N -->
        <span class="flex items-center gap-1.5" data-testid="stats-failures">
          <span class="text-gray-500">Failures</span>
          <span
            class="font-semibold"
            [class.text-red-600]="failureCount > 0"
            [class.text-gray-700]="failureCount === 0"
          >{{ failureCount }}</span>
        </span>

        <!-- Last deploy X ago -->
        <span class="flex items-center gap-1.5" data-testid="stats-last-deploy">
          <span class="text-gray-500">Last deploy</span>
          <span class="font-semibold text-gray-700">{{ lastDeployAgo }}</span>
        </span>

        <!-- Never reached PROD N -->
        <span class="flex items-center gap-1.5" data-testid="stats-never-prod">
          <span class="text-gray-500">Never reached PROD</span>
          <span class="font-semibold text-gray-700">{{ neverReachedProd }}</span>
        </span>
      </div>

      <!-- Right cluster — rate-limit pill (static green, mockup) -->
      <div class="flex items-center gap-2" data-testid="rate-limit-cluster">
        <div
          class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px] font-medium"
          data-testid="rate-limit-pill"
        >
          <span class="relative flex h-1.5 w-1.5">
            <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
          </span>
          <span>0% used · {{ serviceCount }} sources</span>
        </div>
      </div>
    </div>
  `
})
export class StatsBarComponent {
  @Input() serviceCount = 4;
  @Input() envCount = 5;
  @Input() failureCount = 0;
  @Input() runningCount = 0;
  @Input() lastDeployAgo = 'just now';
  @Input() neverReachedProd = 0;
}
