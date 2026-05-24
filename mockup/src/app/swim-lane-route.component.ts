// Canonical swim-lane route — binds MOCKUP_* fixtures to the swim-lane layout chrome.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SwimLaneLayoutComponent } from './chrome/swim-lane-layout.component';
import { StatsBarComponent } from './chrome/stats-bar.component';
import {
  MOCKUP_SERVICES,
  MOCKUP_ENVIRONMENTS,
  MOCKUP_MATRIX,
  MOCKUP_TOPOLOGY
} from './fixtures/index';

@Component({
  selector: 'dd-mockup-swim-lane-route',
  standalone: true,
  imports: [SwimLaneLayoutComponent, StatsBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div>
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
export class SwimLaneRouteComponent {
  readonly services = MOCKUP_SERVICES;
  readonly environments = MOCKUP_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX;
  readonly topology = MOCKUP_TOPOLOGY;

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
