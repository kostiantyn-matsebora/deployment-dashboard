// Swim-lane × Detailed — own component, no shared state.
// 180×150 nodes via ddDepDetailed.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import { DeploymentDetailedComponent } from './deployment-detailed.component';
import { buildDag, type DdGraphNode, type DdGraphEdge } from '../fixtures/dag-builder';
import type {
  ServiceWithDeployments, EnvironmentDescriptor, MatrixState, SlotState
} from '../fixtures/index';

interface ServiceGraph { nodes: DdGraphNode[]; links: DdGraphEdge[]; }

@Component({
  selector: 'dd-mockup-swim-lane-detailed',
  standalone: true,
  imports: [CommonModule, NgxGraphModule, DeploymentDetailedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .ngx-graph-container { width: 100%; overflow: visible; }
    ::ng-deep .ngx-graph .edge .line { stroke: var(--dep-edge-stroke); fill: none; }
    ::ng-deep .ngx-graph .edge .line.edge-correlated { stroke-dasharray: 4 3; }
    ::ng-deep .ngx-graph .arrow-head { fill: var(--dep-arrow-fill); }
  `],
  template: `
    <main class="px-6 pt-4 pb-8" data-testid="pipeline-matrix" data-view="detailed" data-layout="swim-lane">
      <div class="space-y-2">
        @for (svc of servicesWithDeployments; track svc.id) {
          <div class="lane-row relative bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
               [attr.data-service-row]="svc.id" [attr.data-testid]="'swim-lane-row-' + svc.id">
            <div class="flex items-start gap-3">
              <div class="shrink-0 pr-2 self-stretch flex flex-col justify-center" style="min-width: 11rem">
                <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap"
                   style="width: max-content"
                   [attr.data-testid]="'service-name-' + svc.id" [title]="svc.name">{{ svc.name }}</p>
              </div>
              <div class="flex-1 min-w-0">
                @let sg = graphFor(svc);
                <div class="ngx-graph-container">
                  <ngx-graph
                    class="ngx-graph"
                    [view]="viewSize(svc)"
                    [nodes]="sg.nodes"
                    [links]="sg.links"
                    [layout]="'dagre'"
                    [layoutSettings]="{ orientation: 'LR', nodePadding: 12, rankPadding: 40, edgePadding: 20, ranker: 'tight-tree' }"
                    [nodeWidth]="180"
                    [nodeHeight]="150"
                    [animate]="false"
                    [autoZoom]="false"
                    [autoCenter]="false"
                    [enableZoom]="false"
                    [panOnZoom]="false"
                  >
                    <ng-template #defsTemplate>
                      <svg:marker id="detailed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                        <svg:path d="M0,0 L10,5 L0,10 Z" class="arrow-head" />
                      </svg:marker>
                    </ng-template>
                    <ng-template #nodeTemplate let-node>
                      <svg:g class="node" ddDepDetailed
                             [slot]="slotFor(svc.id, node.data?.envId)"
                             [envLabel]="node.data?.envLabel ?? ''"
                             [width]="180"
                             [height]="150"></svg:g>
                    </ng-template>
                    <ng-template #linkTemplate let-link>
                      <svg:g class="edge">
                        <svg:path class="line" stroke-width="1.5" marker-end="url(#detailed-arrow)" [class.edge-correlated]="link.data?.source === 'correlated'" />
                      </svg:g>
                    </ng-template>
                  </ngx-graph>
                </div>
              </div>
            </div>
          </div>
        }
      </div>
    </main>
  `
})
export class SwimLaneDetailedComponent {
  @Input({ required: true }) servicesWithDeployments!: readonly ServiceWithDeployments[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;

  graphFor(svc: ServiceWithDeployments): ServiceGraph {
    const dag = buildDag(svc.id, svc.deployments);
    return {
      nodes: dag.nodes.map(n => ({ ...n, dimension: { width: 180, height: 150 } })),
      links: dag.edges
    };
  }

  viewSize(svc: ServiceWithDeployments): [number, number] {
    const dag = buildDag(svc.id, svc.deployments);
    const inDeg = new Map<string, number>();
    const adj   = new Map<string, string[]>();
    for (const n of dag.nodes) { inDeg.set(n.id, 0); adj.set(n.id, []); }
    for (const e of dag.edges) {
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
      adj.get(e.source)?.push(e.target);
    }
    const topoRank = new Map<string, number>();
    const queue = dag.nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0).map(n => n.id);
    for (const id of queue) topoRank.set(id, 0);
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const ur = topoRank.get(u) ?? 0;
      for (const v of adj.get(u) ?? []) {
        const newRank = ur + 1;
        if (newRank > (topoRank.get(v) ?? -1)) { topoRank.set(v, newRank); queue.push(v); }
      }
    }
    const perRank = new Map<number, number>();
    let maxRankIndex = 0;
    for (const n of dag.nodes) {
      const r = topoRank.get(n.id) ?? 0;
      perRank.set(r, (perRank.get(r) ?? 0) + 1);
      if (r > maxRankIndex) maxRankIndex = r;
    }
    const maxPerRank = Math.max(1, ...perRank.values());
    const width  = (maxRankIndex + 1) * 180 + maxRankIndex * 180 + 80;
    // Sum of node heights in tallest column + sum of gaps + small bottom margin.
    // Gap = nodePadding (12) from layoutSettings.
    const height = maxPerRank * 150 + (maxPerRank - 1) * 12 + 40;
    return [width, height];
  }

  slotFor(serviceId: string, envId: string | undefined): SlotState | null {
    if (!envId) return null;
    return this.matrix[serviceId]?.[envId] ?? null;
  }
}
