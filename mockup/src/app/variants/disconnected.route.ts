// Variant route — disconnected topology.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SwimLaneGlanceComponent } from '../chrome/swim-lane-glance.component';
import { SwimLaneCompactComponent } from '../chrome/swim-lane-compact.component';
import { SwimLaneDetailedComponent } from '../chrome/swim-lane-detailed.component';
import { SwimLaneFocusComponent } from '../chrome/swim-lane-focus.component';
import { StatsBarComponent } from '../chrome/stats-bar.component';
import { ViewModeService } from '../view-mode.service';
import {
  DISCONNECTED_ENVIRONMENTS,
  DISCONNECTED_SERVICES_WITH_DEPLOYMENTS,
  MOCKUP_MATRIX_DISCONNECTED
} from '../fixtures/variants/disconnected';

@Component({
  selector: 'dd-mockup-disconnected-route',
  standalone: true,
  imports: [
    SwimLaneGlanceComponent,
    SwimLaneCompactComponent,
    SwimLaneDetailedComponent,
    SwimLaneFocusComponent,
    StatsBarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="px-6 py-2 text-xs text-gray-500 bg-white border-b border-gray-100">
        Variant: <strong class="text-gray-700">Disconnected topology</strong>
        — two independent sub-DAGs + an orphan service (no edges)
      </div>
      <dd-mockup-stats-bar
        [failureCount]="failureCount"
        [runningCount]="runningCount"
      ></dd-mockup-stats-bar>
      @switch (viewModeService.mode()) {
        @case ('glance') {
          <dd-mockup-swim-lane-glance
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-swim-lane-glance>
        }
        @case ('compact') {
          <dd-mockup-swim-lane-compact
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-swim-lane-compact>
        }
        @case ('focus') {
          <dd-mockup-swim-lane-focus
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-swim-lane-focus>
        }
        @default {
          <dd-mockup-swim-lane-detailed
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-swim-lane-detailed>
        }
      }
    </div>
  `
})
export class DisconnectedRouteComponent {
  readonly viewModeService = inject(ViewModeService);
  readonly servicesWithDeployments = DISCONNECTED_SERVICES_WITH_DEPLOYMENTS;
  readonly environments = DISCONNECTED_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX_DISCONNECTED;

  get failureCount(): number {
    let n = 0;
    for (const svc of Object.values(this.matrix)) {
      for (const slot of Object.values(svc)) {
        if (slot?.current.status === 'failure') n++;
      }
    }
    return n;
  }

  get runningCount(): number {
    let n = 0;
    for (const svc of Object.values(this.matrix)) {
      for (const slot of Object.values(svc)) {
        if (slot?.current.status === 'in-progress') n++;
      }
    }
    return n;
  }
}
