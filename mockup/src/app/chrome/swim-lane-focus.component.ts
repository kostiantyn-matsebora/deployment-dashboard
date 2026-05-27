// Swim-lane × Focus — copy of swim-lane-detailed with per-service expand + pin chrome.
// Collapsed lane renders Compact (140×90); expanded lane renders Detailed (180×150).
// Per-service state lives in this component (no shared store) per mockup convention.

import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxGraphModule } from '@swimlane/ngx-graph';
import { DeploymentCompactComponent } from './deployment-compact.component';
import { DeploymentDetailedComponent } from './deployment-detailed.component';
import { buildDag, type DdGraphNode, type DdGraphEdge } from '../fixtures/dag-builder';
import type {
  ServiceWithDeployments, EnvironmentDescriptor, MatrixState, SlotState
} from '../fixtures/index';

interface ServiceGraph { nodes: DdGraphNode[]; links: DdGraphEdge[]; }

@Component({
  selector: 'dd-mockup-swim-lane-focus',
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
    :host-context([data-theme="dark"]) .icon-btn.chevron-default { background: #1c2233; border-color: #3a4a6b; color: #58a6ff; }
    :host-context([data-theme="dark"]) .icon-btn.chevron-expanded { background: #1f6feb; border-color: #1f6feb; color: #ffffff; }
    :host-context([data-theme="dark"]) .icon-btn.pin-default { background: #161b22; border-color: #30363d; color: #7d8590; }
    :host-context([data-theme="dark"]) .icon-btn.pin-pinned { background: #2a1f0a; border-color: #92400e; color: #fcd34d; }
  `],
  template: `
    <main class="px-6 pt-4 pb-8" data-testid="pipeline-matrix" data-view="focus" data-layout="swim-lane">
      <!-- Helper bar -->
      <div class="text-xs text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
        <span aria-hidden="true">›</span>
        <span>Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.</span>
      </div>
      <div class="space-y-2">
        @for (svc of servicesWithDeployments; track svc.id) {
          @let isExpanded = expanded().has(svc.id) || pinned().has(svc.id);
          <div class="lane-row relative bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
               [attr.data-service-row]="svc.id" [attr.data-testid]="'swim-lane-row-' + svc.id"
               [attr.data-lane-expanded]="isExpanded">
            <div class="flex items-start gap-3">
              <div class="shrink-0 pr-2 self-stretch flex flex-col justify-center" style="min-width: 11rem">
                <div class="flex items-center gap-1.5 mb-1">
                  <button type="button" class="icon-btn"
                          [class.chevron-default]="!isExpanded"
                          [class.chevron-expanded]="isExpanded"
                          [attr.aria-label]="isExpanded ? 'Collapse lane' : 'Expand lane to full detail'"
                          [attr.title]="isExpanded ? 'Collapse lane' : 'Expand lane to full detail'"
                          [attr.data-testid]="'row-chevron-' + svc.id"
                          (click)="toggleExpand(svc.id)">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path [attr.d]="isExpanded ? 'M2,3.5 L5,6.5 L8,3.5' : 'M3.5,2 L6.5,5 L3.5,8'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button type="button" class="icon-btn"
                          [class.pin-default]="!pinned().has(svc.id)"
                          [class.pin-pinned]="pinned().has(svc.id)"
                          [attr.aria-label]="pinned().has(svc.id) ? 'Unpin lane' : 'Pin lane to keep expanded across filters'"
                          [attr.title]="pinned().has(svc.id) ? 'Unpin lane' : 'Pin lane (stays expanded across filters)'"
                          [attr.data-testid]="'row-pin-' + svc.id"
                          (click)="togglePin(svc.id)">
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M8,1 L10,1 L10,6 L12,6 L12,8 L9,8 L9,14 L8,14 L7,8 L4,8 L4,6 L6,6 L6,1 Z" fill="currentColor"/>
                    </svg>
                  </button>
                </div>
                <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap"
                   style="width: max-content"
                   [attr.data-testid]="'service-name-' + svc.id" [title]="svc.name">{{ svc.name }}</p>
              </div>
              <div class="flex-1 min-w-0">
                @let sg = graphFor(svc, isExpanded);
                <div class="ngx-graph-container">
                  @if (isExpanded) {
                    <ngx-graph
                      class="ngx-graph"
                      [view]="viewSize(svc, true)"
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
                        <svg:marker id="focus-exp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
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
                          <svg:path class="line" stroke-width="1.5" marker-end="url(#focus-exp-arrow)" [class.edge-correlated]="link.data?.source === 'correlated'" />
                        </svg:g>
                      </ng-template>
                    </ngx-graph>
                  } @else {
                    <ngx-graph
                      class="ngx-graph"
                      [view]="viewSize(svc, false)"
                      [nodes]="sg.nodes"
                      [links]="sg.links"
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
                        <svg:marker id="focus-col-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                          <svg:path d="M0,0 L10,5 L0,10 Z" class="arrow-head" />
                        </svg:marker>
                      </ng-template>
                      <ng-template #nodeTemplate let-node>
                        <svg:g class="node" ddDepCompact
                               [slot]="slotFor(svc.id, node.data?.envId)"
                               [envLabel]="node.data?.envLabel ?? ''"
                               [width]="140"
                               [height]="90"></svg:g>
                      </ng-template>
                      <ng-template #linkTemplate let-link>
                        <svg:g class="edge">
                          <svg:path class="line" stroke-width="1.5" marker-end="url(#focus-col-arrow)" [class.edge-correlated]="link.data?.source === 'correlated'" />
                        </svg:g>
                      </ng-template>
                    </ngx-graph>
                  }
                </div>
              </div>
            </div>
          </div>
        }
      </div>
    </main>
  `
})
export class SwimLaneFocusComponent {
  @Input({ required: true }) servicesWithDeployments!: readonly ServiceWithDeployments[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;

  readonly expanded = signal<Set<string>>(new Set());
  readonly pinned = signal<Set<string>>(new Set());

  toggleExpand(svcId: string): void {
    const next = new Set(this.expanded());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.expanded.set(next);
  }

  togglePin(svcId: string): void {
    const next = new Set(this.pinned());
    if (next.has(svcId)) next.delete(svcId); else next.add(svcId);
    this.pinned.set(next);
  }

  graphFor(svc: ServiceWithDeployments, isExpanded: boolean): ServiceGraph {
    const dag = buildDag(svc.id, svc.deployments);
    const w = isExpanded ? 180 : 140;
    const h = isExpanded ? 150 : 90;
    return {
      nodes: dag.nodes.map(n => ({ ...n, dimension: { width: w, height: h } })),
      links: dag.edges
    };
  }

  viewSize(svc: ServiceWithDeployments, isExpanded: boolean): [number, number] {
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
    const nodeW = isExpanded ? 180 : 140;
    const nodeH = isExpanded ? 150 : 90;
    const width  = (maxRankIndex + 1) * nodeW + maxRankIndex * nodeW + 80;
    const height = maxPerRank * nodeH + (maxPerRank - 1) * 12 + 40;
    return [width, height];
  }

  slotFor(serviceId: string, envId: string | undefined): SlotState | null {
    if (!envId) return null;
    return this.matrix[serviceId]?.[envId] ?? null;
  }
}
