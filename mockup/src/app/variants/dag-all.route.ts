// Stage 1 — graph-definition verification only.
// Uses dag-builder.ts to map MOCKUP_SERVICES_WITH_DEPLOYMENTS → ngx-graph nodes/links.
// NO custom templates. NO styling. Just default ngx-graph rendering per service.
// Goal: prove the data-to-graph mapping is correct independently of any visual chrome.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import { MOCKUP_SERVICES_WITH_DEPLOYMENTS, type ServiceWithDeployments } from '../fixtures/index';
import { buildDag } from '../fixtures/dag-builder';

@Component({
  selector: 'dd-mockup-dag-all',
  standalone: true,
  imports: [NgxGraphModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="padding: 24px;">
      <h2>Stage 1 — dag-builder output, ngx-graph rendering with rectangles + arrows</h2>
      <p>One ngx-graph per service. Minimal rectangle node template + arrow marker. No styling beyond what's needed to read the graph.</p>
      @for (svc of services; track svc.id) {
        @let dag = dagFor(svc);
        <div style="margin: 16px 0; border: 1px solid #ccc; padding: 8px;">
          <h3 style="margin: 0 0 4px 0;">{{ svc.name }} ({{ dag.nodes.length }} nodes, {{ dag.edges.length }} edges)</h3>
          <div style="width: 1200px; height: 240px;">
            <ngx-graph
              [nodes]="dag.nodes"
              [links]="dag.edges"
              [layout]="'dagre'"
              [layoutSettings]="settings"
              [autoCenter]="true"
              [autoZoom]="true"
              [animate]="false"
            >
              <ng-template #defsTemplate>
                <svg:marker
                  id="arrow"
                  viewBox="0 -5 10 10"
                  refX="8"
                  refY="0"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <svg:path d="M0,-5L10,0L0,5" fill="#666" />
                </svg:marker>
              </ng-template>

              <ng-template #nodeTemplate let-node>
                <svg:g>
                  <svg:rect
                    [attr.width]="node.dimension.width"
                    [attr.height]="node.dimension.height"
                    fill="#f3f4f6"
                    stroke="#9ca3af"
                    stroke-width="1"
                    rx="4"
                  />
                  <svg:text
                    [attr.x]="node.dimension.width / 2"
                    [attr.y]="node.dimension.height / 2"
                    text-anchor="middle"
                    dominant-baseline="central"
                    font-family="sans-serif"
                    font-size="13"
                    fill="#374151"
                  >{{ node.data?.envLabel ?? node.label }}</svg:text>
                </svg:g>
              </ng-template>

              <ng-template #linkTemplate let-link>
                <svg:path
                  class="edge"
                  [attr.d]="link.line"
                  stroke="#666"
                  stroke-width="1.5"
                  fill="none"
                  marker-end="url(#arrow)"
                />
              </ng-template>
            </ngx-graph>
          </div>
        </div>
      }
    </div>
  `
})
export class DagAllRouteComponent {
  readonly services = MOCKUP_SERVICES_WITH_DEPLOYMENTS;
  readonly settings = { rankdir: 'LR', nodeSep: 40, rankSep: 80 };

  dagFor(svc: ServiceWithDeployments) {
    return buildDag(svc.id, svc.deployments);
  }
}
