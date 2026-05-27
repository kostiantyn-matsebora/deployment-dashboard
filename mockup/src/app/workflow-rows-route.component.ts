// Canonical workflow-rows route — dispatches to per-view-mode components.
// No workflow-rows-layout monolith; each (workflow-rows × viewMode) combination is its own component.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { WorkflowRowsDetailedComponent } from './chrome/workflow-rows-detailed.component';
import { WorkflowRowsCompactComponent } from './chrome/workflow-rows-compact.component';
import { WorkflowRowsGlanceComponent } from './chrome/workflow-rows-glance.component';
import { WorkflowRowsFocusComponent } from './chrome/workflow-rows-focus.component';
import { StatsBarComponent } from './chrome/stats-bar.component';
import { ViewModeService } from './view-mode.service';
import {
  MOCKUP_SERVICES_WITH_DEPLOYMENTS,
  MOCKUP_ENVIRONMENTS,
  MOCKUP_MATRIX
} from './fixtures/index';

@Component({
  selector: 'dd-mockup-workflow-rows-route',
  standalone: true,
  imports: [
    WorkflowRowsDetailedComponent,
    WorkflowRowsCompactComponent,
    WorkflowRowsGlanceComponent,
    WorkflowRowsFocusComponent,
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
        @case ('compact') {
          <dd-mockup-workflow-rows-compact
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-workflow-rows-compact>
        }
        @case ('glance') {
          <dd-mockup-workflow-rows-glance
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-workflow-rows-glance>
        }
        @case ('focus') {
          <dd-mockup-workflow-rows-focus
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-workflow-rows-focus>
        }
        @default {
          <dd-mockup-workflow-rows-detailed
            [servicesWithDeployments]="servicesWithDeployments"
            [environments]="environments"
            [matrix]="matrix"
          ></dd-mockup-workflow-rows-detailed>
        }
      }
    </div>
  `
})
export class WorkflowRowsRouteComponent {
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
