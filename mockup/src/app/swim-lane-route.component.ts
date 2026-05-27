// Canonical swim-lane route — dispatches to per-view-mode components.
// No swim-lane-layout monolith; each (swim-lane × viewMode) combination is its own component.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SwimLaneGlanceComponent } from './chrome/swim-lane-glance.component';
import { SwimLaneCompactComponent } from './chrome/swim-lane-compact.component';
import { SwimLaneDetailedComponent } from './chrome/swim-lane-detailed.component';
import { SwimLaneFocusComponent } from './chrome/swim-lane-focus.component';
import { StatsBarComponent } from './chrome/stats-bar.component';
import { ViewModeService } from './view-mode.service';
import {
  MOCKUP_SERVICES_WITH_DEPLOYMENTS,
  MOCKUP_ENVIRONMENTS,
  MOCKUP_MATRIX
} from './fixtures/index';

@Component({
  selector: 'dd-mockup-swim-lane-route',
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
      <dd-mockup-stats-bar
        [serviceCount]="servicesWithDeployments.length"
        [failureCount]="failureCount"
        [runningCount]="runningCount"
        [lastDeployAgo]="lastDeployAgo"
        [neverReachedProd]="neverReachedProd"
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
export class SwimLaneRouteComponent {
  readonly viewModeService = inject(ViewModeService);
  readonly servicesWithDeployments = MOCKUP_SERVICES_WITH_DEPLOYMENTS;
  readonly environments = MOCKUP_ENVIRONMENTS;
  readonly matrix = MOCKUP_MATRIX;

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
