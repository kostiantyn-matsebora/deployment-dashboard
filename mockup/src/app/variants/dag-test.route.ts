// Minimal ngx-graph diagnostic — default templates, no styling.
// Service C topology: dev → qa → uat → prod, dev → qahotfix.
// Goal: verify dagre layout is correct before any styling.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgxGraphModule } from '@swimlane/ngx-graph';

@Component({
  selector: 'dd-mockup-dag-test',
  standalone: true,
  imports: [NgxGraphModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="padding: 24px;">
      <h2>ngx-graph diagnostic — Service C DAG with default templates</h2>
      <p>5 nodes, 4 edges. No custom node/link templates. Pure dagre LR.</p>
      <div style="border: 1px solid #ccc; width: 1200px; height: 600px;">
        <ngx-graph
          [nodes]="nodes"
          [links]="links"
          [layout]="'dagre'"
          [layoutSettings]="settings"
          [autoCenter]="true"
          [autoZoom]="true"
          [animate]="false"
        ></ngx-graph>
      </div>
    </div>
  `
})
export class DagTestRouteComponent {
  readonly settings = { rankdir: 'LR', nodeSep: 40, rankSep: 80 };

  readonly nodes = [
    { id: 'dev',      label: 'DEV',      dimension: { width: 100, height: 50 } },
    { id: 'qa',       label: 'QA',       dimension: { width: 100, height: 50 } },
    { id: 'qahotfix', label: 'QAHOTFIX', dimension: { width: 100, height: 50 } },
    { id: 'uat',      label: 'UAT',      dimension: { width: 100, height: 50 } },
    { id: 'prod',     label: 'PROD',     dimension: { width: 100, height: 50 } }
  ];

  readonly links = [
    { id: 'e1', source: 'dev',  target: 'qa',       label: '' },
    { id: 'e2', source: 'qa',   target: 'uat',      label: '' },
    { id: 'e3', source: 'uat',  target: 'prod',     label: '' },
    { id: 'e4', source: 'dev',  target: 'qahotfix', label: '' }
  ];
}
