// Hand-authored visual mirror of <dd-workflow-rows-layout> from frontend/matrix/src/lib/.
//
// Mockup simplification vs SPA:
//   - No store signals; all data via @Input().
//   - No afterEveryRender / ResizeObserver / connector geometry computation.
//   - Renders only the default path per service (no expand/collapse toggle for MVP mockup).
//   - Arrow gaps are rendered statically (no CSS custom property geometry).
//   - OnPush change detection.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutLeafComponent } from './layout-leaf.component';
import type {
  ServiceDescriptor, EnvironmentDescriptor, MatrixState, TopologyState, SlotState, Topology
} from '../fixtures/index';

// Root-to-leaf paths — mirrors topology-utils.ts rootToLeafPaths().
function rootToLeafPaths(
  topology: Topology,
  service: ServiceDescriptor,
  environments: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): readonly (readonly string[])[] {
  const edges = topology.edges;
  if (edges.length === 0) {
    const populated = environments
      .filter(e => matrix[service.id]?.[e.id] != null)
      .sort((a, b) => {
        const ta = new Date(matrix[service.id]?.[a.id]?.current.deployedAt ?? 0).getTime();
        const tb = new Date(matrix[service.id]?.[b.id]?.current.deployedAt ?? 0).getTime();
        return ta - tb;
      })
      .map(e => e.id);
    return [populated];
  }

  const children: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.from);
    allNodes.add(e.to);
    (children[e.from] ??= []).push(e.to);
    inDegree[e.to] = (inDegree[e.to] ?? 0) + 1;
  }
  const roots = [...allNodes].filter(n => !inDegree[n]);

  const paths: string[][] = [];
  function dfs(node: string, path: string[]): void {
    const next = path.concat(node);
    const kids = children[node] ?? [];
    if (kids.length === 0) { paths.push(next); return; }
    for (const c of kids) dfs(c, next);
  }
  for (const r of roots) dfs(r, []);
  return paths.length > 0 ? paths : [[...allNodes]];
}

// Default path: the path containing the most recent current.deployedAt event.
function defaultPathIndex(
  paths: readonly (readonly string[])[],
  service: ServiceDescriptor,
  matrix: MatrixState
): number {
  let best = 0;
  let bestTime = -Infinity;
  paths.forEach((path, idx) => {
    for (const envId of path) {
      const t = new Date(matrix[service.id]?.[envId]?.current.deployedAt ?? 0).getTime();
      if (t > bestTime) { bestTime = t; best = idx; }
    }
  });
  return best;
}

@Component({
  selector: 'dd-mockup-workflow-rows-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 py-2 flex items-center gap-3 text-xs bg-white border-b border-gray-200">
      <span class="text-gray-400" data-testid="workflow-rows-total">{{ totalPaths() }} workflows</span>
    </div>

    <main
      class="px-6 py-2 space-y-3"
      data-testid="pipeline-matrix"
      data-view="detailed"
      data-layout="workflow-rows"
    >
      @for (service of services; track service.id; let idx = $index) {
        <!-- Collapsed row (default state — matches SPA default before expand).
             First service is shown expanded so both states are visible in one capture. -->
        @if (idx > 0) {
          <!-- Collapsed: chevron + name + wf-count badge + topo label -->
          <div
            class="svc-block-collapsed bg-white rounded-lg border border-gray-200 px-4 py-2 flex items-center gap-2 cursor-default"
            [attr.data-service]="service.id"
            [attr.data-service-row]="service.id"
            [attr.data-testid]="'workflow-rows-' + service.id"
            data-expanded="false"
          >
            <!-- Chevron -->
            <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            <!-- Service name -->
            <p
              class="text-sm font-semibold text-gray-800 whitespace-nowrap"
              [attr.data-testid]="'service-name-' + service.id"
              [title]="service.name"
            >{{ service.name }}</p>
            <!-- Wf count badge -->
            <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight shrink-0"
                  [attr.data-testid]="'wf-count-' + service.id">
              {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
            </span>
            <!-- Topo label -->
            <span class="text-[10px] text-gray-400 italic ml-1">{{ topoLabel(service) }}</span>
          </div>
        } @else {
          <!-- Expanded: full svc-block with workflow rows (first service only) -->
          <section
            class="svc-block"
            [attr.data-service]="service.id"
            [attr.data-service-row]="service.id"
            [attr.data-testid]="'workflow-rows-' + service.id"
            data-expanded="true"
          >
            <!-- Meta column -->
            <div class="svc-block-meta">
              <div class="svc-block-meta-row">
                <!-- Chevron (expanded state — rotated down) -->
                <svg class="w-3.5 h-3.5 text-gray-500 shrink-0 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
                <p
                  class="text-sm font-semibold text-gray-800 whitespace-nowrap ml-1"
                  style="width: max-content"
                  [attr.data-testid]="'service-name-' + service.id"
                  [title]="service.name"
                >{{ service.name }}</p>
                <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight ml-1 shrink-0">
                  {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
                </span>
              </div>
              <p class="text-[10px] text-gray-400 italic leading-tight">{{ topoLabel(service) }}</p>
            </div>

            <!-- Workflow rows (default path) -->
            <div class="svc-block-rows">
              <div
                class="wf-row default-row"
                [attr.data-service-row]="service.id"
                [attr.data-testid]="'workflow-row-' + service.id + '-0'"
                data-expanded="true"
                data-active="true"
              >
                <div class="flex items-stretch">
                  @for (envId of defaultPathFor(service); track envId + ':' + $index; let eIdx = $index) {
                    <div class="flex items-stretch">
                      <div
                        class="leaf-pair relative"
                        [attr.data-env]="envId"
                        [attr.data-env-position]="eIdx"
                      >
                        <span class="env-tag">{{ envLabel(envId) }}</span>
                        <dd-mockup-layout-leaf
                          [service]="service"
                          [env]="envFor(envId)"
                          [slot]="slotFor(service, envId)"
                        ></dd-mockup-layout-leaf>
                      </div>

                      @if (eIdx < defaultPathFor(service).length - 1) {
                        <div class="arrow-gap">
                          <div class="arrow-line"></div>
                        </div>
                      }
                    </div>
                  }

                  @if (pathsFor(service).length > 1) {
                    <div class="flex items-center pl-3">
                      <span class="default-tag" data-testid="workflow-default-tag">default</span>
                    </div>
                  }
                </div>
              </div>

              @if (pathsFor(service).length > 1) {
                <div class="text-[10px] text-gray-400 italic px-1 py-0.5">
                  + {{ pathsFor(service).length - 1 }} more workflow{{ pathsFor(service).length > 2 ? 's' : '' }} (expand to view)
                </div>
              }
            </div>
          </section>
        }
      }

      @if (services.length === 0) {
        <div class="text-center py-16 text-gray-400" data-testid="empty-state">
          <p class="text-lg font-medium">No services</p>
        </div>
      }
    </main>
  `
})
export class WorkflowRowsLayoutComponent {
  @Input({ required: true }) services!: readonly ServiceDescriptor[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;
  @Input({ required: true }) topology!: TopologyState;

  pathsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return rootToLeafPaths(
      this.topology[service.id] ?? { edges: [] },
      service,
      this.environments,
      this.matrix
    );
  }

  defaultPathFor(service: ServiceDescriptor): readonly string[] {
    const paths = this.pathsFor(service);
    if (paths.length === 0) return [];
    return paths[defaultPathIndex(paths, service, this.matrix)];
  }

  envLabel(envId: string): string {
    return this.environments.find(e => e.id === envId)?.label ?? envId.toUpperCase();
  }

  envFor(envId: string): EnvironmentDescriptor {
    return this.environments.find(e => e.id === envId) ?? { id: envId, label: envId.toUpperCase() };
  }

  slotFor(service: ServiceDescriptor, envId: string): SlotState | null {
    return this.matrix[service.id]?.[envId] ?? null;
  }

  topoLabel(service: ServiceDescriptor): string {
    const edges = this.topology[service.id]?.edges ?? [];
    if (edges.length === 0) return 'linear';
    const outDeg: Record<string, number> = {};
    const inDeg: Record<string, number> = {};
    for (const e of edges) {
      outDeg[e.from] = (outDeg[e.from] ?? 0) + 1;
      inDeg[e.to]    = (inDeg[e.to]    ?? 0) + 1;
    }
    const hasFork   = Object.values(outDeg).some(d => d > 1);
    const hasMerge  = Object.values(inDeg).some(d => d > 1);
    // Check if any slot in the current path has a failure
    const slots = Object.values(this.matrix[service.id] ?? {});
    const hasFailure = slots.some(s => s?.current.status === 'failure');
    const hasRunning = slots.some(s => s?.current.status === 'in-progress');
    if (hasFork && hasMerge) return 'branching + merging';
    if (hasFork)  return 'branching';
    if (hasFailure) return 'has failures';
    if (hasRunning) return 'deploying…';
    return 'All green';
  }

  totalPaths(): number {
    return this.services.reduce((n, s) => n + this.pathsFor(s).length, 0);
  }
}
