// Stats bar — Services (filtered/total), Failures, Last deploy (relative),
// Never reached PROD, plus:
//   - The "Showing all environments with X" highlight-hint when a version
//     is hovered.
//   - The right-aligned rate-limit cluster (CR-0011 § 3d) — sibling to the
//     left-cluster wrapper.
//
// Layout reconciliation per Phase 3 design decision D7 — the highlight-hint
// stacks VERTICALLY above the cluster row when `highlightedVersion()` is
// non-null (both visible). The right-side wrapper is `flex-col` so the hint
// becomes row 1 and the cluster row 2. Mirrors the mockup at
// `docs/ui/deployment-dashboard.html` lines 1418–1521.
//
// QA-engineer data-* requests (Phase 2e):
//   - `data-testid="stats-bar"` on the outer strip
//   - `data-testid="stats-strip-left-cluster"` on the left wrapper — drives
//     the rate-limit cluster's collapse-threshold measurement (D8 / mockup
//     `recomputeCollapse`).
//   - `data-testid="rate-limit-cluster"` on the cluster root (rendered by
//     `RateLimitClusterComponent`).

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeploymentMatrixStore } from '@dd/shared';
import { RateLimitClusterComponent } from './rate-limit-cluster.component';

@Component({
  selector: 'dd-stats-bar',
  standalone: true,
  imports: [CommonModule, RateLimitClusterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white border-b border-gray-200 px-6 py-3 flex items-start gap-6"
         data-testid="stats-bar">

      <!-- Left cluster — Services / Failures / Last deploy / Never reached PROD.
           self-center keeps it vertically centred when the right wrapper
           grows to two rows during a version-hover (D7). -->
      <div class="flex items-center gap-6 self-center"
           data-testid="stats-strip-left-cluster">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-gray-500">Services</span>
          <span class="text-sm font-bold text-gray-900"
                data-testid="stat-services"
          >{{ store.filteredServices().length }} / {{ store.services().length }}</span>
        </div>
        <div class="w-px h-4 bg-gray-200"></div>
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
          <span class="text-sm font-medium text-gray-500">Failures</span>
          <span class="text-sm font-bold"
                [class.text-red-600]="store.failureCount() > 0"
                [class.text-gray-900]="store.failureCount() === 0"
                data-testid="stat-failures"
          >{{ store.failureCount() }}</span>
        </div>
        <div class="w-px h-4 bg-gray-200"></div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-gray-500">Last deploy</span>
          <span class="text-sm font-bold text-gray-900"
                data-testid="stat-last-deploy"
          >{{ store.lastDeployRelative() }}</span>
        </div>
        <div class="w-px h-4 bg-gray-200"></div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-gray-500">Never reached PROD</span>
          <span class="text-sm font-bold text-gray-900"
                data-testid="stat-never-prod"
          >{{ store.neverProdCount() }}</span>
        </div>
      </div>

      <!-- Right wrapper — flex-column so the highlight-hint can stack ABOVE
           the rate-limit cluster (D7). Both children right-align via the
           wrapper ml-auto. -->
      <div class="ml-auto flex flex-col items-end gap-1">
        @if (store.highlightedVersion()) {
          <div class="text-xs text-gray-400 italic"
               data-testid="highlight-hint">
            Showing all environments with
            <span class="font-semibold text-amber-600">{{ store.highlightedVersion() }}</span>
          </div>
        }
        <dd-rate-limit-cluster></dd-rate-limit-cluster>
      </div>
    </div>
  `
})
export class StatsBarComponent {
  readonly store = inject(DeploymentMatrixStore);
}
