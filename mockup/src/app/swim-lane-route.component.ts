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
        [serviceCount]="services.length"
        [failureCount]="failureCount"
        [runningCount]="runningCount"
        [lastDeployAgo]="lastDeployAgo"
        [neverReachedProd]="neverReachedProd"
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

  get lastDeployAgo(): string {
    // Most recent deployedAt across all slots in the canonical fixture.
    let latestMs = 0;
    for (const svc of Object.values(this.matrix)) {
      for (const slot of Object.values(svc)) {
        if (slot) {
          const t = new Date(slot.current.deployedAt).getTime();
          if (t > latestMs) latestMs = t;
        }
      }
    }
    if (!latestMs) return 'never';
    const diffMs = Date.now() - latestMs;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  get neverReachedProd(): number {
    const prodId = 'prod';
    let n = 0;
    for (const svcId of Object.keys(this.matrix)) {
      if (this.matrix[svcId]?.[prodId] == null) n++;
    }
    return n;
  }
}
