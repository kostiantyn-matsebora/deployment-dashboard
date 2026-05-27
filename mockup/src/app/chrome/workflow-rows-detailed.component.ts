// Workflow-rows × Detailed — each service's DAG decomposed into source→sink paths.
// One ngx-graph instance per path (horizontal LR), DeploymentDetailedComponent leaves.
// Per-service chevron toggle: collapsed shows 1 path (latest), expanded shows all.

import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import { DeploymentDetailedComponent } from './deployment-detailed.component';
import {
  buildDag, enumeratePaths,
  type DdGraphNode, type DdGraphEdge
} from '../fixtures/dag-builder';
import type {
  ServiceWithDeployments, EnvironmentDescriptor, MatrixState, SlotState
} from '../fixtures/index';

interface PathGraph { nodes: DdGraphNode[]; links: DdGraphEdge[]; }

interface ServicePaths {
  service: ServiceWithDeployments;
  allPaths: PathGraph[];          // up to 8
  totalPaths: number;             // before cap
  overflowCount: number;          // total - 8 if positive
}

@Component({
  selector: 'dd-mockup-workflow-rows-detailed',
  standalone: true,
  imports: [CommonModule, NgxGraphModule, DeploymentDetailedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .ngx-graph-container { width: 100%; overflow: visible; }
    ::ng-deep .ngx-graph .edge .line { stroke: var(--dep-edge-stroke); fill: none; }
    ::ng-deep .ngx-graph .edge .line.edge-correlated { stroke-dasharray: 4 3; }
    ::ng-deep .ngx-graph .arrow-head { fill: var(--dep-arrow-fill); }
    .chev { width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 0.25rem; border: 1px solid #e5e7eb; background: #f9fafb; color: #6b7280; transition: background-color .15s, color .15s; }
    .chev.expanded { background: #2563eb; border-color: #1d4ed8; color: #fff; }
    :host-context([data-theme="dark"]) .chev { background: #161b22; border-color: #30363d; color: #7d8590; }
    :host-context([data-theme="dark"]) .chev.expanded { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  `],
  template: `
    <main class="px-6 pt-4 pb-8" data-testid="pipeline-matrix" data-view="detailed" data-layout="workflow-rows">
      <div class="px-1 pb-3 flex items-center gap-3 text-xs">
        <span class="text-gray-500" data-testid="workflow-rows-total">{{ totalWorkflows() }} workflow{{ totalWorkflows() === 1 ? '' : 's' }}</span>
        <button type="button" class="px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                title="Show every workflow row for every service"
                data-testid="workflow-rows-expand-all"
                (click)="toggleExpandAll()">
          {{ allExpanded() ? 'Collapse all workflows' : 'Expand all workflows' }}
        </button>
      </div>
      <div class="space-y-3">
        @for (sp of servicePaths(); track sp.service.id) {
          @let isExpanded = expanded().has(sp.service.id);
          @let visiblePaths = isExpanded ? sp.allPaths : (sp.allPaths.length > 0 ? [sp.allPaths[0]] : []);
          <div class="lane-row relative bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
               [attr.data-service-row]="sp.service.id" [attr.data-testid]="'workflow-rows-' + sp.service.id"
               [attr.data-row-expanded]="isExpanded">
            <div class="flex items-start gap-3">
              <div class="shrink-0 pr-2 self-stretch flex flex-col justify-center" style="min-width: 11rem">
                <div class="flex items-center gap-1.5 mb-1">
                  <button type="button" class="chev"
                          [class.expanded]="isExpanded"
                          [attr.title]="isExpanded ? 'Collapse workflows' : 'Expand all workflows'"
                          [attr.data-testid]="'workflow-toggle-' + sp.service.id"
                          (click)="toggleService(sp.service.id)">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path [attr.d]="isExpanded ? 'M2,3.5 L5,6.5 L8,3.5' : 'M3.5,2 L6.5,5 L3.5,8'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <span class="text-[11px] text-gray-400 uppercase tracking-wide">{{ sp.totalPaths }} {{ sp.totalPaths === 1 ? 'wf' : 'wfs' }}</span>
                </div>
                <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap"
                   style="width: max-content"
                   [attr.data-testid]="'service-name-' + sp.service.id" [title]="sp.service.name">{{ sp.service.name }}</p>
                @if (!isExpanded && sp.totalPaths > 1) {
                  <p class="text-[11px] text-gray-400 mt-0.5">default · 1/{{ sp.totalPaths }}</p>
                }
              </div>
              <div class="flex-1 min-w-0 space-y-2">
                @for (path of visiblePaths; track $index) {
                  <div class="ngx-graph-container" [attr.data-testid]="'workflow-row-' + sp.service.id + '-' + $index">
                    <ngx-graph
                      class="ngx-graph"
                      [view]="viewSize(path)"
                      [nodes]="path.nodes"
                      [links]="path.links"
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
                        <svg:marker [attr.id]="'wrd-arrow-' + sp.service.id + '-' + $index" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                          <svg:path d="M0,0 L10,5 L0,10 Z" class="arrow-head" />
                        </svg:marker>
                      </ng-template>
                      <ng-template #nodeTemplate let-node>
                        <svg:g class="node" ddDepDetailed
                               [slot]="slotFor(sp.service.id, node.data?.envId)"
                               [envLabel]="node.data?.envLabel ?? ''"
                               [width]="180"
                               [height]="150"></svg:g>
                      </ng-template>
                      <ng-template #linkTemplate let-link>
                        <svg:g class="edge">
                          <svg:path class="line" stroke-width="1.5" [attr.marker-end]="'url(#wrd-arrow-' + sp.service.id + '-' + $index + ')'" [class.edge-correlated]="link.data?.source === 'correlated'" />
                        </svg:g>
                      </ng-template>
                    </ngx-graph>
                  </div>
                }
                @if (isExpanded && sp.overflowCount > 0) {
                  <div class="text-xs text-gray-400 italic mt-1">+{{ sp.overflowCount }} more workflow{{ sp.overflowCount === 1 ? '' : 's' }}</div>
                }
              </div>
            </div>
          </div>
        }
      </div>
    </main>
  `
})
export class WorkflowRowsDetailedComponent {
  @Input({ required: true }) servicesWithDeployments!: readonly ServiceWithDeployments[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;

  readonly expanded = signal<Set<string>>(new Set());

  toggleService(svcId: string): void {
    const next = new Set(this.expanded());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.expanded.set(next);
  }

  allExpanded(): boolean {
    const all = this.servicesWithDeployments;
    if (all.length === 0) return false;
    const e = this.expanded();
    return all.every(svc => e.has(svc.id));
  }

  toggleExpandAll(): void {
    if (this.allExpanded()) {
      this.expanded.set(new Set());
    } else {
      this.expanded.set(new Set(this.servicesWithDeployments.map(s => s.id)));
    }
  }

  totalWorkflows(): number {
    return this.servicePaths().reduce((s, sp) => s + sp.totalPaths, 0);
  }

  servicePaths(): ServicePaths[] {
    return this.servicesWithDeployments.map(svc => {
      const dag = buildDag(svc.id, svc.deployments);
      const enumeration = enumeratePaths(dag.nodes, dag.edges, 8);
      const nodeById = new Map(dag.nodes.map(n => [n.id, n]));
      const allPaths: PathGraph[] = enumeration.paths.map(pathIds => {
        const nodes = pathIds.map(id => nodeById.get(id)!).filter(Boolean).map(n => ({
          ...n,
          dimension: { width: 180, height: 150 }
        }));
        const links: DdGraphEdge[] = [];
        for (let i = 0; i < pathIds.length - 1; i++) {
          const original = dag.edges.find(e => e.source === pathIds[i] && e.target === pathIds[i + 1]);
          if (original) links.push(original);
        }
        return { nodes, links };
      });
      return {
        service: svc,
        allPaths,
        totalPaths: enumeration.totalCount,
        overflowCount: enumeration.overflowCount
      };
    });
  }

  viewSize(path: PathGraph): [number, number] {
    const n = path.nodes.length;
    const width  = n * 180 + (n - 1) * 40 + 80;
    const height = 150 + 40;
    return [width, height];
  }

  slotFor(serviceId: string, envId: string | undefined): SlotState | null {
    if (!envId) return null;
    return this.matrix[serviceId]?.[envId] ?? null;
  }
}
