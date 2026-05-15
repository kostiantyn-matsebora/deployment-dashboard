// Header — title, "Failures only" toggle, "Focus on last event" toggle,
// search input, view switcher, layout switcher (FR-13), attribute picker,
// topology correlation picker (FR-13), live indicator.

import { ChangeDetectionStrategy, Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeploymentMatrixStore, type CorrelationAttribute } from '@dd/shared';
import {
  AttributePickerComponent,
  LayoutSwitcherComponent,
  TopologyPickerComponent,
  ViewSwitcherComponent
} from '@dd/matrix';

@Component({
  selector: 'dd-header',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ViewSwitcherComponent,
    LayoutSwitcherComponent,
    AttributePickerComponent,
    TopologyPickerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div class="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div>
            <h1 class="text-base font-semibold text-gray-900 leading-tight">Deployment Dashboard</h1>
            <p class="text-xs text-gray-400 leading-tight" data-testid="header-subtitle">
              {{ store.services().length }} services ·
              {{ store.environments().length }} environments
            </p>
          </div>
        </div>

        <div class="flex items-center gap-4 flex-wrap">
          <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              data-testid="failures-only-toggle"
              [ngModel]="store.showFailuresOnly()"
              (ngModelChange)="store.setShowFailuresOnly($event)"
              class="rounded border-gray-300 text-red-500 focus:ring-red-400"
            />
            <span>Failures only</span>
          </label>

          <!-- Focus on last event — mockup header toggle. When ON (default),
               an incoming SSE slot-update scrolls the affected row into view
               and pulses; when OFF, only already-visible rows pulse and no
               scroll happens. -->
          <label
            class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none"
            title="When on, an incoming event scrolls the affected element into view; when off, only events on already-visible elements animate"
          >
            <input
              type="checkbox"
              data-testid="focus-on-last-event-toggle"
              [ngModel]="store.focusOnLastEvent()"
              (ngModelChange)="store.setFocusOnLastEvent($event)"
              class="rounded border-gray-300 text-indigo-500 focus:ring-indigo-400"
            />
            <span>Focus on last event</span>
          </label>

          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                 fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              data-testid="search-input"
              placeholder="Filter services…"
              [ngModel]="store.search()"
              (ngModelChange)="store.setSearch($event)"
              class="text-sm border border-gray-200 rounded-md pl-8 pr-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <dd-view-switcher></dd-view-switcher>
          <dd-layout-switcher></dd-layout-switcher>
          <dd-attribute-picker></dd-attribute-picker>
          <dd-topology-picker
            (pickChanged)="correlationPickChanged.emit($event)"
          ></dd-topology-picker>

          <span class="text-xs text-gray-400 border-l border-gray-200 pl-4" data-testid="live-indicator">
            Live · updated just now
          </span>
        </div>
      </div>
    </header>
  `
})
export class DashboardHeaderComponent {
  readonly store = inject(DeploymentMatrixStore);

  /**
   * Re-emits the topology picker's `pickChanged` event up to the app
   * component, which is responsible for triggering a matrix refresh with
   * the new query parameter (SAD §10 Decision #7).
   */
  @Output() readonly correlationPickChanged = new EventEmitter<CorrelationAttribute | undefined>();
}
