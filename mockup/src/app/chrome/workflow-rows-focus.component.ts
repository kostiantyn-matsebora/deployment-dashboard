// Workflow-rows × Focus — per-service THREE controls + N path rows.
//   row-chevron-<svc>     : toggle leaf density (Compact 140×90 ↔ Detailed 180×150)
//   row-pin-<svc>         : sticky expanded across filters (amber when pinned)
//   workflow-toggle-<svc> : show 1 path (latest) vs all paths
// Helper bar at top + top "Expand all workflows" button (toggles workflow-toggle for all).

import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import { DeploymentCompactComponent } from './deployment-compact.component';
import { DeploymentDetailedComponent } from './deployment-detailed.component';
import {
  buildDag, enumeratePaths,
  type DdGraphNode, type DdGraphEdge
} from '../fixtures/dag-builder';
import type {
  ServiceWithDeployments, EnvironmentDescriptor, MatrixState, SlotState
} from '../fixtures/index';

interface PathGraph { nodes: DdGraphNode[]; links: DdGraphEdge[]; }
interface ServicePaths { service: ServiceWithDeployments; allPaths: PathGraph[]; totalPaths: number; overflowCount: number; }

@Component({
  selector: 'dd-mockup-workflow-rows-focus',
  standalone: true,
  imports: [CommonModule, NgxGraphModule, DeploymentCompactComponent, DeploymentDetailedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .ngx-graph-container { width: 100%; overflow: visible; }
    ::ng-deep .ngx-graph .edge .line { stroke: var(--dep-edge-stroke); fill: none; }
    ::ng-deep .ngx-graph .edge .line.edge-correlated { stroke-dasharray: 4 3; }
    ::ng-deep .ngx-graph .arrow-head { fill: var(--dep-arrow-fill); }
    .icon-btn { width: 1.25rem; height: 1.25rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 0.25rem; border: 1px solid; transition: background-color .15s, color .15s; }
    .icon-btn.chevron-default { background: #eff6ff; border-color: #bfdbfe; color: #2563eb; }
    .icon-btn.chevron-expanded { background: #2563eb; border-color: #1d4ed8; color: #ffffff; }
    .icon-btn.pin-default { background: #f9fafb; border-color: #e5e7eb; color: #6b7280; }
    .icon-btn.pin-pinned { background: #fef3c7; border-color: #fcd34d; color: #92400e; }
    .icon-btn.wf-default { background: #f9fafb; border-color: #e5e7eb; color: #6b7280; }
    .icon-btn.wf-expanded { background: #2563eb; border-color: #1d4ed8; color: #ffffff; }
    :host-context([data-theme="dark"]) .icon-btn.chevron-default { background: #1c2233; border-color: #3a4a6b; color: #58a6ff; }
    :host-context([data-theme="dark"]) .icon-btn.chevron-expanded { background: #1f6feb; border-color: #1f6feb; color: #ffffff; }
    :host-context([data-theme="dark"]) .icon-btn.pin-default,
    :host-context([data-theme="dark"]) .icon-btn.wf-default { background: #161b22; border-color: #30363d; color: #7d8590; }
    :host-context([data-theme="dark"]) .icon-btn.pin-pinned { background: #2a1f0a; border-color: #92400e; color: #fcd34d; }
    :host-context([data-theme="dark"]) .icon-btn.wf-expanded { background: #1f6feb; border-color: #1f6feb; color: #ffffff; }
  `],
  template: `
    <main class="px-6 pt-4 pb-8" data-testid="pipeline-matrix" data-view="focus" data-layout="workflow-rows">
      <div class="text-xs text-gray-500 mb-3 flex items-center gap-2">
        <span aria-hidden="true">›</span>
        <span>Chevron drills into Detailed-size fidelity. Pin keeps it expanded across filters. Right-arrow toggle shows all workflow paths.</span>
      </div>
      <div class="px-1 pb-3 flex items-center gap-3 text-xs">
        <span class="text-gray-500" data-testid="workflow-rows-total">{{ totalWorkflows() }} workflow{{ totalWorkflows() === 1 ? '' : 's' }}</span>
        <button type="button" class="px-2 py-1 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                title="Show every workflow row for every service"
                data-testid="workflow-rows-expand-all"
                (click)="toggleExpandAllWfs()">
          {{ allWfsExpanded() ? 'Collapse all workflows' : 'Expand all workflows' }}
        </button>
      </div>
      <div class="space-y-3">
        @for (sp of servicePaths(); track sp.service.id) {
          @let isDense = chevronExpanded().has(sp.service.id) || pinned().has(sp.service.id);
          @let isWfsExpanded = wfsExpanded().has(sp.service.id);
          @let visiblePaths = isWfsExpanded ? sp.allPaths : (sp.allPaths.length > 0 ? [sp.allPaths[0]] : []);
          <div class="lane-row relative bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
               [attr.data-service-row]="sp.service.id" [attr.data-testid]="'workflow-rows-' + sp.service.id"
               [attr.data-lane-expanded]="isDense" [attr.data-wfs-expanded]="isWfsExpanded">
            <div class="flex items-start gap-3">
              <div class="shrink-0 pr-2 self-stretch flex flex-col justify-center" style="min-width: 11rem">
                <div class="flex items-center gap-1.5 mb-1">
                  <button type="button" class="icon-btn"
                          [class.chevron-default]="!isDense"
                          [class.chevron-expanded]="isDense"
                          [attr.title]="isDense ? 'Collapse lane' : 'Expand lane to full detail'"
                          [attr.data-testid]="'row-chevron-' + sp.service.id"
                          (click)="toggleChevron(sp.service.id)">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path [attr.d]="isDense ? 'M2,3.5 L5,6.5 L8,3.5' : 'M3.5,2 L6.5,5 L3.5,8'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button type="button" class="icon-btn"
                          [class.pin-default]="!pinned().has(sp.service.id)"
                          [class.pin-pinned]="pinned().has(sp.service.id)"
                          [attr.title]="pinned().has(sp.service.id) ? 'Unpin lane' : 'Pin lane (stays expanded across filters)'"
                          [attr.data-testid]="'row-pin-' + sp.service.id"
                          (click)="togglePin(sp.service.id)">
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8,1 L10,1 L10,6 L12,6 L12,8 L9,8 L9,14 L8,14 L7,8 L4,8 L4,6 L6,6 L6,1 Z" fill="currentColor"/>
                    </svg>
                  </button>
                  <button type="button" class="icon-btn"
                          [class.wf-default]="!isWfsExpanded"
                          [class.wf-expanded]="isWfsExpanded"
                          [attr.title]="isWfsExpanded ? 'Show last-active workflow only' : 'Show all workflow paths'"
                          [attr.data-testid]="'workflow-toggle-' + sp.service.id"
                          (click)="toggleWfs(sp.service.id)">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path [attr.d]="isWfsExpanded ? 'M2,3.5 L5,6.5 L8,3.5' : 'M3.5,2 L6.5,5 L3.5,8'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <span class="text-[11px] text-gray-400 uppercase tracking-wide">{{ sp.totalPaths }} {{ sp.totalPaths === 1 ? 'wf' : 'wfs' }}</span>
                </div>
                <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap"
                   style="width: max-content"
                   [attr.data-testid]="'service-name-' + sp.service.id" [title]="sp.service.name">{{ sp.service.name }}</p>
                @if (!isWfsExpanded && sp.totalPaths > 1) {
                  <p class="text-[11px] text-gray-400 mt-0.5">default · 1/{{ sp.totalPaths }}</p>
                }
              </div>
              <div class="flex-1 min-w-0 space-y-2">
                @for (path of visiblePaths; track $index) {
                  @let scaledPath = scalePathDimensions(path, isDense);
                  <div class="ngx-graph-container" [attr.data-testid]="'workflow-row-' + sp.service.id + '-' + $index">
                    @if (isDense) {
                      <ngx-graph
                        class="ngx-graph"
                        [view]="viewSize(path, true)"
                        [nodes]="scaledPath.nodes"
                        [links]="scaledPath.links"
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
                          <svg:marker [attr.id]="'wrf-exp-arrow-' + sp.service.id + '-' + $index" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
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
                            <svg:path class="line" stroke-width="1.5" [attr.marker-end]="'url(#wrf-exp-arrow-' + sp.service.id + '-' + $index + ')'" [class.edge-correlated]="link.data?.source === 'correlated'" />
                          </svg:g>
                        </ng-template>
                      </ngx-graph>
                    } @else {
                      <ngx-graph
                        class="ngx-graph"
                        [view]="viewSize(path, false)"
                        [nodes]="scaledPath.nodes"
                        [links]="scaledPath.links"
                        [layout]="'dagre'"
                        [layoutSettings]="{ orientation: 'LR', nodePadding: 12, rankPadding: 40, edgePadding: 20, ranker: 'tight-tree' }"
                        [nodeWidth]="140"
                        [nodeHeight]="90"
                        [animate]="false"
                        [autoZoom]="false"
                        [autoCenter]="false"
                        [enableZoom]="false"
                        [panOnZoom]="false"
                      >
                        <ng-template #defsTemplate>
                          <svg:marker [attr.id]="'wrf-col-arrow-' + sp.service.id + '-' + $index" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                            <svg:path d="M0,0 L10,5 L0,10 Z" class="arrow-head" />
                          </svg:marker>
                        </ng-template>
                        <ng-template #nodeTemplate let-node>
                          <svg:g class="node" ddDepCompact
                                 [slot]="slotFor(sp.service.id, node.data?.envId)"
                                 [envLabel]="node.data?.envLabel ?? ''"
                                 [width]="140"
                                 [height]="90"></svg:g>
                        </ng-template>
                        <ng-template #linkTemplate let-link>
                          <svg:g class="edge">
                            <svg:path class="line" stroke-width="1.5" [attr.marker-end]="'url(#wrf-col-arrow-' + sp.service.id + '-' + $index + ')'" [class.edge-correlated]="link.data?.source === 'correlated'" />
                          </svg:g>
                        </ng-template>
                      </ngx-graph>
                    }
                  </div>
                }
                @if (isWfsExpanded && sp.overflowCount > 0) {
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
export class WorkflowRowsFocusComponent {
  @Input({ required: true }) servicesWithDeployments!: readonly ServiceWithDeployments[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;

  readonly chevronExpanded = signal<Set<string>>(new Set());
  readonly pinned = signal<Set<string>>(new Set());
  readonly wfsExpanded = signal<Set<string>>(new Set());

  toggleChevron(svcId: string): void {
    const next = new Set(this.chevronExpanded());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.chevronExpanded.set(next);
  }

  togglePin(svcId: string): void {
    const next = new Set(this.pinned());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.pinned.set(next);
  }

  toggleWfs(svcId: string): void {
    const next = new Set(this.wfsExpanded());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.wfsExpanded.set(next);
  }

  allWfsExpanded(): boolean {
    const all = this.servicesWithDeployments;
    if (all.length === 0) return false;
    const e = this.wfsExpanded();
    return all.every(svc => e.has(svc.id));
  }

  toggleExpandAllWfs(): void {
    if (this.allWfsExpanded()) this.wfsExpanded.set(new Set());
    else this.wfsExpanded.set(new Set(this.servicesWithDeployments.map(s => s.id)));
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
        const nodes = pathIds.map(id => nodeById.get(id)!).filter(Boolean);
        const links: DdGraphEdge[] = [];
        for (let i = 0; i < pathIds.length - 1; i++) {
          const original = dag.edges.find(e => e.source === pathIds[i] && e.target === pathIds[i + 1]);
          if (original) links.push(original);
        }
        return { nodes, links };
      });
      return { service: svc, allPaths, totalPaths: enumeration.totalCount, overflowCount: enumeration.overflowCount };
    });
  }

  scalePathDimensions(path: PathGraph, isDense: boolean): PathGraph {
    const w = isDense ? 180 : 140;
    const h = isDense ? 150 : 90;
    return {
      nodes: path.nodes.map(n => ({ ...n, dimension: { width: w, height: h } })),
      links: path.links
    };
  }

  viewSize(path: PathGraph, isDense: boolean): [number, number] {
    const n = path.nodes.length;
    const nodeW = isDense ? 180 : 140;
    const nodeH = isDense ? 150 : 90;
    const width  = n * nodeW + (n - 1) * 40 + 80;
    const height = nodeH + 40;
    return [width, height];
  }

  slotFor(serviceId: string, envId: string | undefined): SlotState | null {
    if (!envId) return null;
    return this.matrix[serviceId]?.[envId] ?? null;
  }
}
