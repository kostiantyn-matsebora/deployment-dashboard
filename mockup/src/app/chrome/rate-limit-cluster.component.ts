// Hand-authored visual mirror of the rate-limit-cluster from frontend/.
// Static fixture: shows a green-band cluster with hardcoded usage data
// mirroring the SPA's cluster appearance.

import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'dd-mockup-rate-limit-cluster',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2 text-xs" data-testid="rate-limit-cluster">
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border bg-green-100 border-green-200 text-green-700"
            data-testid="rate-limit-pill">
        <span class="font-semibold">GHA</span>
        <span>1250 / 5000</span>
        <span class="text-green-600 font-bold text-[10px]">25%</span>
      </span>
      <span class="text-gray-400 text-[10px]">rate limit · green · static fixture</span>
    </div>
  `
})
export class RateLimitClusterComponent {}
