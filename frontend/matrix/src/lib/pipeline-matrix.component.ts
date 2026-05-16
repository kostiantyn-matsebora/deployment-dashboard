// Pipeline matrix — picks one of the four per-view row renderers based on
// the active view (FR-12) and renders one row per service in the filtered
// set. Plus the environment column header (Detailed / Compact / Focus) and
// the empty state.
//
// View-specific dimensions for the header come from the mockup
// (docs/deployment-dashboard.html).
//
// NFR-09 sibling invariant #7 — env-header column alignment under Matrix
// Focus expand. The Focus view wraps its env-header + rows in a SINGLE
// container that carries the `--leaf-width` CSS custom property. When ANY
// service in the matrix is Focus-expanded the wrapper switches to
// `--leaf-width: 200px`; env-header cells and every row's stage-box read
// the same variable, so column widths track in lock-step. The mockup's
// "Option b" wiring (docs/deployment-dashboard.html lines 1681-1741).

import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
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
    @if (store.view() === 'focus') {
      <!-- Focus toolbar — discoverability hint visible whenever View=Focus,
           BEFORE any row has been expanded (otherwise the collapsed Focus
           matrix looks identical to Compact). Mirrors mockup lines 1707-1718. -->
      <div class="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4 text-xs">
        <span class="inline-flex items-center gap-1.5 text-gray-600" data-testid="focus-toolbar-hint">
          <svg class="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          <span>Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.</span>
        </span>
        @if (pinnedCount() > 0) {
          <span class="text-amber-600 font-semibold" data-testid="pinned-count">
            <span>{{ pinnedCount() }}</span> pinned
          </span>
        }
        @if (hasExpanded()) {
          <button
            type="button"
            class="ml-auto text-gray-600 hover:text-gray-900 underline"
            data-testid="collapse-all"
            (click)="store.collapseAll()"
          >Collapse all</button>
        }
      </div>

      <!-- Page-level Focus wrapper — owns --leaf-width and --focus-arrow-gap.
           Env-header + rows + arrow gaps all read these variables.

           CSS-specificity note: frontend/dashboard/src/styles.css sets
           [data-view="focus"] { --leaf-width: 160px; }. Both the matrix
           header and the main element here bind data-view="focus", so the
           CSS rule fires LOCALLY on each, shadowing the inline value the
           wrapper writes (inheritance loses to a same-element rule). To
           win on those elements we also write focusVars() inline on
           them — inline specificity (1,0,0,0) beats the attribute
           selector (0,0,1,0). Focus-row no longer carries data-view, so
           the row inherits from main. Header receives the same inline
           style via the focusStyle input. -->
      <div [attr.style]="focusVars()">
        <dd-matrix-header
          [environments]="store.environments()"
          [view]="store.view()"
          [hasExpanded]="hasExpanded()"
          [focusStyle]="focusVars()"
        ></dd-matrix-header>
        <main
          class="px-6 pb-8 space-y-1"
          [class.mr-\\[26rem\\]]="store.drawerOpen()"
          [attr.style]="mainFocusStyle()"
          data-testid="pipeline-matrix"
          [attr.data-view]="store.view()"
          [attr.data-layout]="store.layout()"
        >
          @for (service of store.filteredServices(); track service.id) {
            <dd-focus-row
              [service]="service"
              [envs]="store.environments()"
              (opened)="openSlot.emit($event)"
            ></dd-focus-row>
          }
          @if (store.filteredServices().length === 0) {
            <div class="text-center py-16 text-gray-400"
                 data-testid="empty-state">
              <p class="text-lg font-medium">No services match your filters</p>
              <p class="text-sm mt-1">Try clearing the search or disabling "Failures only"</p>
            </div>
          }
        </main>
      </div>
    } @else {
      <dd-matrix-header
        [environments]="store.environments()"
        [view]="store.view()"
      ></dd-matrix-header>
      <main
        class="px-6 pb-8"
        [class.space-y-3]="store.view() === 'detailed'"
        [class.space-y-1]="store.view() === 'compact'"
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
    }
  `
})
export class PipelineMatrixComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly openSlot = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  /** True when at least one service is currently Focus-expanded. */
  readonly hasExpanded = computed(() => this.store.expandedServices().size > 0);

  /** Number of services with the pin set — surfaced in the Focus toolbar. */
  readonly pinnedCount = computed(() => this.store.pinnedServices().size);

  /**
   * Inline style for the page-level Focus wrapper. Writes BOTH custom
   * properties on the same node so the env-header strip and every row
   * resolve the same value (NFR-09 sibling invariant #7).
   */
  readonly focusVars = computed(() => {
    const expanded = this.hasExpanded();
    const leaf = expanded ? '200px' : '160px';
    const gap = expanded ? '2.5rem' : '0.875rem';
    return `--leaf-width: ${leaf}; --leaf-width-expanded: 200px; --focus-arrow-gap: ${gap};`;
  });

  /**
   * Inline style for the `<main>` element in the Focus branch. Combines
   * `focusVars()` (so inline-style specificity beats the
   * `[data-view="focus"]` CSS rule on this element) with the existing
   * `transition: margin-right` rule the drawer animation depends on.
   * `[attr.style]` replaces the entire style attribute, so the transition
   * must live in the same string.
   */
  readonly mainFocusStyle = computed(
    () => `${this.focusVars()} transition: margin-right 0.2s ease;`
  );
}
