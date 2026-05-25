// Variant route — disconnected topology.
// Renders the swim-lane view with MOCKUP_TOPOLOGY_DISCONNECTED: two
// independent sub-DAGs (alpha: dev→qa→uat→prod; beta: dev→staging) plus
// an orphan service (gamma: prod only, no edges).

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SwimLaneLayoutComponent } from '../chrome/swim-lane-layout.component';
import { StatsBarComponent } from '../chrome/stats-bar.component';
import {
  DISCONNECTED_ENVIRONMENTS,
  DISCONNECTED_SERVICES,
  MOCKUP_MATRIX_DISCONNECTED,
  MOCKUP_TOPOLOGY_DISCONNECTED
} from '../fixtures/variants/disconnected';

@Component({
  selector: 'dd-mockup-disconnected-route',
  standalone: true,
  imports: [SwimLaneLayoutComponent, StatsBarComponent],
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
      <dd-mockup-swim-lane-layout
        [services]="services"
        [environments]="environments"
        [matrix]="matrix"
        [topology]="topology"
      ></dd-mockup-swim-lane-layout>
    </div>
  `
})
export class DisconnectedRouteComponent {
  readonly services = DISCONNECTED_SERVICES;
  readonly environments = DISCONNECTED_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX_DISCONNECTED;
  readonly topology = MOCKUP_TOPOLOGY_DISCONNECTED;

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
