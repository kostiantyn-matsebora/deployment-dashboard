// Stats bar — Services (filtered/total), Failures, Last deploy (relative),
// Never reached PROD, and the "Showing all environments with X" hint when a
// version is hovered.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeploymentMatrixStore } from '@dd/shared';

@Component({
  selector: 'dd-stats-bar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
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
      @if (store.highlightedVersion()) {
        <div class="ml-auto text-xs text-gray-400 italic"
             data-testid="highlight-hint">
          Showing all environments with
          <span class="font-semibold text-amber-600">{{ store.highlightedVersion() }}</span>
        </div>
      }
    </div>
  `
})
export class StatsBarComponent {
  readonly store = inject(DeploymentMatrixStore);
}
