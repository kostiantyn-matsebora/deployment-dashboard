// Pipeline matrix — picks one of the four per-view row renderers based on
// the active view (FR-12) and renders one row per service in the filtered
// set. Plus the environment column header (Detailed / Compact / Focus) and
// the empty state.
//
// View-specific dimensions for the header come from the mockup
// (docs/deployment-dashboard.html).

import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  type EnvironmentDescriptor,
  type ServiceDescriptor
} from '@dd/shared';
import { MatrixHeaderComponent } from './matrix-header.component';
import { DetailedRowComponent } from './detailed-row.component';
import { CompactRowComponent } from './compact-row.component';
import { GlanceRowComponent } from './glance-row.component';
import { FocusRowComponent } from './focus-row.component';

@Component({
  selector: 'dd-pipeline-matrix',
  standalone: true,
  imports: [
    CommonModule,
    MatrixHeaderComponent,
    DetailedRowComponent,
    CompactRowComponent,
    GlanceRowComponent,
    FocusRowComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dd-matrix-header
      [environments]="store.environments()"
      [view]="store.view()"
    ></dd-matrix-header>

    <main
      class="px-6 pb-8"
      [class.space-y-3]="store.view() === 'detailed'"
      [class.space-y-1]="store.view() === 'compact' || store.view() === 'focus'"
      [class.space-y-0\\.5]="store.view() === 'glance'"
      [class.mr-\\[26rem\\]]="store.drawerOpen()"
      style="transition: margin-right 0.2s ease"
      data-testid="pipeline-matrix"
      [attr.data-view]="store.view()"
      [attr.data-layout]="store.layout()"
    >
      @for (service of store.filteredServices(); track service.id) {
        @switch (store.view()) {
          @case ('detailed') {
            <dd-detailed-row
              [service]="service"
              [envs]="store.environments()"
              (opened)="openSlot.emit($event)"
            ></dd-detailed-row>
          }
          @case ('compact') {
            <dd-compact-row
              [service]="service"
              [envs]="store.environments()"
              (opened)="openSlot.emit($event)"
            ></dd-compact-row>
          }
          @case ('glance') {
            <dd-glance-row
              [service]="service"
              [envs]="store.environments()"
              (opened)="openSlot.emit($event)"
            ></dd-glance-row>
          }
          @case ('focus') {
            <dd-focus-row
              [service]="service"
              [envs]="store.environments()"
              (opened)="openSlot.emit($event)"
            ></dd-focus-row>
          }
        }
      }

      @if (store.filteredServices().length === 0) {
        <div class="text-center py-16 text-gray-400"
             data-testid="empty-state">
          <p class="text-lg font-medium">No services match your filters</p>
          <p class="text-sm mt-1">Try clearing the search or disabling "Failures only"</p>
        </div>
      }
    </main>
  `
})
export class PipelineMatrixComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly openSlot = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();
}
