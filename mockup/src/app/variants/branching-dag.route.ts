// Variant route — branching DAG topology.
// Renders the swim-lane view with MOCKUP_TOPOLOGY_BRANCHING (dev forks to
// qa AND qahotfix; both converge to uat; uat → prod) per issue #54 fixture.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SwimLaneLayoutComponent } from '../chrome/swim-lane-layout.component';
import { StatsBarComponent } from '../chrome/stats-bar.component';
import {
  BRANCHING_ENVIRONMENTS,
  BRANCHING_SERVICES,
  MOCKUP_MATRIX_BRANCHING,
  MOCKUP_TOPOLOGY_BRANCHING
} from '../fixtures/variants/branching';

@Component({
  selector: 'dd-mockup-branching-dag-route',
  standalone: true,
  imports: [SwimLaneLayoutComponent, StatsBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
      <div class="px-6 py-2 text-xs text-gray-500 bg-white border-b border-gray-100">
        Variant: <strong class="text-gray-700">Branching DAG</strong>
        — dev forks to qa + qahotfix; both converge to uat; uat &rarr; prod
        (issue #54 reporter topology)
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
export class BranchingDagRouteComponent {
  readonly services = BRANCHING_SERVICES;
  readonly environments = BRANCHING_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX_BRANCHING;
  readonly topology = MOCKUP_TOPOLOGY_BRANCHING;

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
