// Hand-authored visual mirror of the stats-bar from frontend/dashboard/.
// Pass 1 chrome parity — restructured to widget shape matching the SPA:
//   Left cluster:  Services N/N · Failures N (red dot) · Last deploy X ago · Never reached PROD N
//   Right cluster: Rate-limit cluster pill (static green, 0% used · N sources)

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

        <!-- Services widget -->
        <span class="flex items-center gap-1.5" data-testid="stats-services">
          <span class="font-semibold text-gray-700">{{ serviceCount }}/{{ serviceCount }}</span>
          <span class="text-gray-400">services</span>
        </span>

        <!-- Failures widget -->
        <span class="flex items-center gap-1.5" data-testid="stats-failures">
          @if (failureCount > 0) {
            <span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
          } @else {
            <span class="w-2 h-2 rounded-full bg-gray-200 shrink-0"></span>
          }
          <span
            [class.font-semibold]="failureCount > 0"
            [class.text-red-600]="failureCount > 0"
            [class.text-gray-700]="failureCount === 0"
          >{{ failureCount }}</span>
          <span class="text-gray-400">failure{{ failureCount === 1 ? '' : 's' }}</span>
        </span>

        <!-- Running widget -->
        @if (runningCount > 0) {
          <span class="flex items-center gap-1.5" data-testid="stats-running">
            <span class="relative flex h-2 w-2 shrink-0">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
            <span class="font-semibold text-orange-600">{{ runningCount }}</span>
            <span class="text-gray-400">running</span>
          </span>
        }

        <!-- Last deploy widget -->
        <span class="flex items-center gap-1.5" data-testid="stats-last-deploy">
          <span class="text-gray-400">Last deploy</span>
          <span class="font-semibold text-gray-700">{{ lastDeployAgo }}</span>
        </span>

        <!-- Never reached PROD widget -->
        <span class="flex items-center gap-1.5" data-testid="stats-never-prod">
          <span class="text-gray-400">Never reached PROD</span>
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
          <span>0% used</span>
          <span class="text-green-600">·</span>
          <span>{{ serviceCount }} sources</span>
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
