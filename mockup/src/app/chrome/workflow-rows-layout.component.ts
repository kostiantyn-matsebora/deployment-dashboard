// Hand-authored visual mirror of <dd-workflow-rows-layout> from frontend/matrix/src/lib/.
//
// Mockup simplification vs SPA:
//   - No store signals; all data via @Input().
//   - No afterEveryRender / ResizeObserver / connector geometry computation.
//   - OnPush change detection.
//
// viewMode rendering:
//   detailed — full 5-row stage-box via layout-leaf; first service expanded,
//              subsequent services collapsed (chevron + name + wf-count badge)
//   compact  — condensed 3-row box via layout-leaf; same collapsed-default layout
//   focus    — Focus chrome: helper text bar + per-service THREE controls
//              (chevron-1 expand workflows + pin + chevron-2 expand to Detailed density)
//              + service name + N wfs badge; "Expand all workflows" button at top.
//              Expanded rows show Compact-density boxes with arrow connectors.
//   glance   — one row per service with mini env-pill strip (same shape as swim-lane glance);
//              all services collapsed (chevron + name + badge on left, pill strip on right)

import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutLeafComponent } from './layout-leaf.component';
import type {
  ServiceDescriptor, EnvironmentDescriptor, MatrixState, TopologyState, SlotState, Topology
} from '../fixtures/index';
import type { ViewMode } from '../view-mode.service';

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

// Default path: the one containing the most recent deployedAt.
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

// Glance pill border class.
function glancePillClass(slot: SlotState | null): string {
  if (!slot) return 'border-gray-200 bg-gray-50';
  const s = slot.current.status;
  if (s === 'success')     return 'border-green-300 bg-white';
  if (s === 'failure')     return 'border-red-300 bg-white';
  return 'border-orange-400 bg-white';
}

// 7-char hash helper.
function shortHash(slot: SlotState): string {
  if (slot.current.sha) return slot.current.sha.slice(0, 7);
  const id = slot.current.deploymentId;
  const digits = id.replace(/\D/g, '');
  if (digits) return parseInt(digits, 10).toString(16).padStart(7, '0').slice(0, 7);
  return id.slice(0, 7);
}

// Per-service Focus state.
interface FocusState { wfExpanded: boolean; pinned: boolean; detailExpanded: boolean; }

@Component({
  selector: 'dd-mockup-workflow-rows-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .focus-chevron {
      transition: transform 0.15s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #9ca3af;
    }
    .focus-chevron:hover { color: #6b7280; }
    .focus-chevron.expanded { transform: rotate(90deg); }
    .focus-pin {
      cursor: pointer;
      color: #9ca3af;
      opacity: 0.6;
      transition: color 0.15s, opacity 0.15s;
    }
    .focus-pin:hover { color: #6366f1; opacity: 1; }
    .focus-pin.pinned { color: #6366f1; opacity: 1; }
  `],
  template: `
    <div class="px-6 py-2 flex items-center gap-3 text-xs bg-white border-b border-gray-200">
      <span class="text-gray-400" data-testid="workflow-rows-total">{{ totalPaths() }} workflows</span>
    </div>

    @if (viewMode === 'glance') {
      <!-- ════════════════════════════════════════════════════════════════════
           GLANCE VIEW — one row per service with mini env-pill strip.
           All services shown as collapsed row (chevron + name + wf-count + pills).
           Matches spa-workflow_rows-glance.png.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 py-2 space-y-1.5"
        data-testid="pipeline-matrix"
        data-view="glance"
        data-layout="workflow-rows"
      >
        @for (service of services; track service.id) {
          <div
            class="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center gap-2"
            [attr.data-service-row]="service.id"
            [attr.data-testid]="'workflow-rows-' + service.id"
          >
            <!-- Chevron (collapsed) -->
            <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            <!-- Service name -->
            <p
              class="text-sm font-semibold text-gray-800 whitespace-nowrap shrink-0"
              [attr.data-testid]="'service-name-' + service.id"
            >{{ service.name }}</p>
            <!-- Wf count badge -->
            <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight shrink-0">
              {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
            </span>

            <!-- Pill strip (default-path envs) -->
            <div class="flex items-center flex-wrap min-w-0 gap-0 ml-2">
              @for (envId of glanceEnvsFor(service); track envId; let pIdx = $index) {
                @let slot = slotFor(service, envId);

                @if (pIdx > 0) {
                  <div class="px-1 text-gray-400 text-xs select-none shrink-0 leading-none">
                    @if (slot?.current?.status === 'in-progress') {
                      <span class="tracking-tighter opacity-60">- - &rsaquo;</span>
                    } @else {
                      <span>&rarr;</span>
                    }
                  </div>
                }

                <div
                  class="glance-pill flex items-center gap-1 rounded border px-2 py-1 shrink-0"
                  [ngClass]="glancePillClass(slot)"
                  [attr.data-testid]="'glance-pill-' + service.id + '-' + envId"
                  [attr.data-env]="envId"
                >
                  <span class="text-[9px] font-bold text-gray-500 uppercase leading-none">{{ envLabel(envId) }}</span>
                  @if (slot) {
                    @if (slot.current.status === 'in-progress') {
                      <span class="spinner shrink-0" style="width:8px;height:8px;border-width:1.5px"></span>
                    } @else if (slot.current.status === 'success') {
                      <span class="text-green-500 text-[9px] leading-none">✓</span>
                    } @else {
                      <span class="text-red-500 text-[9px] leading-none">✗</span>
                    }
                    <span class="text-[9px] font-mono text-gray-700 leading-none">{{ shortHash(slot) }}</span>
                    @if (slot.current.status === 'in-progress' && slot.previousFailed) {
                      <span class="text-[8px] text-amber-600 leading-none" title="prev. failed">▲</span>
                    }
                  } @else {
                    <span class="text-[9px] text-gray-300 leading-none tracking-wider">· · ·</span>
                  }
                </div>
              }
            </div>
          </div>
        }

        @if (services.length === 0) {
          <div class="text-center py-16 text-gray-400" data-testid="empty-state">
            <p class="text-lg font-medium">No services</p>
          </div>
        }
      </main>

    } @else if (viewMode === 'focus') {
      <!-- ════════════════════════════════════════════════════════════════════
           FOCUS VIEW — Focus chrome:
             - Helper text bar (same text as swim-lane Focus).
             - "Expand all workflows" button at top-right.
             - Each service row: chevron-1 (expand workflow children) +
               pin + chevron-2 (expand to Detailed density) + service name +
               N wfs badge.
             - Clicks toggle local signal state for each control.
           Matches spa-workflow_rows-focus.png.
           ════════════════════════════════════════════════════════════════════ -->
      <div data-testid="pipeline-matrix" data-view="focus" data-layout="workflow-rows">

        <!-- Focus helper text bar + expand-all button -->
        <div class="mx-6 mt-3 mb-2 flex items-center gap-3">
          <div
            class="flex-1 px-3 py-1.5 rounded border border-indigo-100 bg-indigo-50 text-[11px] text-indigo-600 leading-snug"
            data-testid="focus-helper-bar"
          >
            Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.
          </div>
          <button
            type="button"
            class="shrink-0 text-[11px] text-indigo-600 border border-indigo-200 bg-indigo-50 rounded px-2.5 py-1 hover:bg-indigo-100 transition-colors"
            data-testid="expand-all-workflows"
            (click)="expandAllWorkflows()"
          >
            Expand all workflows
          </button>
        </div>

        <main class="px-6 pb-8 space-y-1.5">
          @for (service of services; track service.id) {
            <div
              class="focus-row bg-white rounded-lg border border-gray-200"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'workflow-rows-' + service.id"
              [attr.data-expanded]="focusState(service.id).wfExpanded"
              [attr.data-pinned]="focusState(service.id).pinned"
            >
              <!-- Focus chrome header row: chevron-1 + pin + chevron-2 + name + badge -->
              <div class="flex items-center gap-2 px-3 py-2">

                <!-- Chevron-1: expand/collapse workflow children -->
                <button
                  type="button"
                  class="focus-chevron w-5 h-5 shrink-0"
                  [class.expanded]="focusState(service.id).wfExpanded"
                  [attr.data-testid]="'focus-wf-chevron-' + service.id"
                  [attr.aria-expanded]="focusState(service.id).wfExpanded"
                  [attr.aria-label]="'Expand workflows for ' + service.name"
                  (click)="toggleWfExpand(service.id)"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <!-- Pin icon -->
                <button
                  type="button"
                  class="focus-pin w-4 h-4 shrink-0"
                  [class.pinned]="focusState(service.id).pinned"
                  [attr.data-testid]="'focus-pin-' + service.id"
                  [attr.aria-pressed]="focusState(service.id).pinned"
                  [attr.aria-label]="'Pin ' + service.name"
                  (click)="togglePin(service.id)"
                  title="Pin to keep expanded across filters"
                >
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    @if (focusState(service.id).pinned) {
                      <path fill="currentColor" stroke="none" d="M12 2l3 6h5l-4 4 1.5 6.5L12 15l-5.5 3.5L8 12 4 8h5z" />
                    } @else {
                      <line x1="12" y1="17" x2="12" y2="22" />
                      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                    }
                  </svg>
                </button>

                <!-- Chevron-2: expand to Detailed density -->
                <button
                  type="button"
                  class="focus-chevron w-5 h-5 shrink-0"
                  [class.expanded]="focusState(service.id).detailExpanded"
                  [attr.data-testid]="'focus-detail-chevron-' + service.id"
                  [attr.aria-expanded]="focusState(service.id).detailExpanded"
                  [attr.aria-label]="'Expand detail for ' + service.name"
                  (click)="toggleDetailExpand(service.id)"
                >
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <!-- Service name + wf badge + topo label -->
                <p
                  class="text-sm font-semibold text-gray-800 whitespace-nowrap truncate flex-1 min-w-0"
                  [attr.data-testid]="'service-name-' + service.id"
                  [title]="service.name"
                >{{ service.name }}</p>
                <span
                  class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight shrink-0"
                  [attr.data-testid]="'wf-count-' + service.id"
                >
                  {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
                </span>
                <span class="text-[10px] text-gray-400 italic ml-1 shrink-0">{{ topoLabel(service) }}</span>
              </div>

              <!-- Expanded workflows content -->
              @if (focusState(service.id).wfExpanded) {
                <div class="px-3 pb-2 space-y-1.5">
                  @for (path of pathsFor(service); track $index; let wfIdx = $index) {
                    <div
                      class="wf-row"
                      [attr.data-testid]="'workflow-row-' + service.id + '-' + wfIdx"
                    >
                      <div class="flex items-stretch">
                        @for (envId of path; track envId + ':' + $index; let eIdx = $index) {
                          <div class="flex items-stretch">
                            <div
                              class="leaf-pair relative"
                              [attr.data-env]="envId"
                            >
                              <span class="env-tag">{{ envLabel(envId) }}</span>
                              <dd-mockup-layout-leaf
                                [service]="service"
                                [env]="envFor(envId)"
                                [slot]="slotFor(service, envId)"
                                [viewMode]="focusState(service.id).detailExpanded ? 'detailed' : 'compact'"
                              ></dd-mockup-layout-leaf>
                            </div>

                            @if (eIdx < path.length - 1) {
                              <div class="arrow-gap">
                                <div class="arrow-line"></div>
                              </div>
                            }
                          </div>
                        }

                        @if (pathsFor(service).length > 1 && wfIdx === defaultPathIndexFor(service)) {
                          <div class="flex items-center pl-3">
                            <span class="default-tag" data-testid="workflow-default-tag">default</span>
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }

          @if (services.length === 0) {
            <div class="text-center py-16 text-gray-400" data-testid="empty-state">
              <p class="text-lg font-medium">No services</p>
            </div>
          }
        </main>
      </div>

    } @else {
      <!-- ════════════════════════════════════════════════════════════════════
           DETAILED / COMPACT VIEW — workflow rows with collapsed-default.
           First service rendered expanded (boxes visible); rest collapsed
           (chevron + name + badge row only — matches SPA collapsed default).
           viewMode threaded to layout-leaf for compact/focus density.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 py-2 space-y-3"
        data-testid="pipeline-matrix"
        [attr.data-view]="viewMode"
        data-layout="workflow-rows"
      >
        @for (service of services; track service.id; let idx = $index) {
          @if (idx > 0) {
            <!-- Collapsed: chevron + name + wf-count badge + topo label -->
            <div
              class="svc-block-collapsed bg-white rounded-lg border border-gray-200 px-4 py-2 flex items-center gap-2 cursor-default"
              [attr.data-service]="service.id"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'workflow-rows-' + service.id"
              data-expanded="false"
            >
              <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <p
                class="text-sm font-semibold text-gray-800 whitespace-nowrap"
                [attr.data-testid]="'service-name-' + service.id"
                [title]="service.name"
              >{{ service.name }}</p>
              <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight shrink-0"
                    [attr.data-testid]="'wf-count-' + service.id">
                {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
              </span>
              <span class="text-[10px] text-gray-400 italic ml-1">{{ topoLabel(service) }}</span>
            </div>
          } @else {
            <!-- Expanded: full svc-block with default-path workflow row (first service) -->
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
                            [viewMode]="viewMode"
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
    }
  `
})
export class WorkflowRowsLayoutComponent {
  @Input({ required: true }) services!: readonly ServiceDescriptor[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;
  @Input({ required: true }) topology!: TopologyState;
  @Input() viewMode: ViewMode = 'detailed';

  // ── Focus chrome state ──────────────────────────────────────────────────────
  private readonly _focusStates = signal<Record<string, FocusState>>({});

  focusState(serviceId: string): FocusState {
    return this._focusStates()[serviceId] ?? { wfExpanded: false, pinned: false, detailExpanded: false };
  }

  toggleWfExpand(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), wfExpanded: !this.focusState(serviceId).wfExpanded }
    }));
  }

  togglePin(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), pinned: !this.focusState(serviceId).pinned }
    }));
  }

  toggleDetailExpand(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), detailExpanded: !this.focusState(serviceId).detailExpanded }
    }));
  }

  expandAllWorkflows(): void {
    const next: Record<string, FocusState> = {};
    for (const svc of this.services) {
      next[svc.id] = { ...this.focusState(svc.id), wfExpanded: true };
    }
    this._focusStates.set(next);
  }

  // ── Data helpers ────────────────────────────────────────────────────────────
  pathsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return rootToLeafPaths(
      this.topology[service.id] ?? { edges: [] },
      service,
      this.environments,
      this.matrix
    );
  }

  defaultPathIndexFor(service: ServiceDescriptor): number {
    return defaultPathIndex(this.pathsFor(service), service, this.matrix);
  }

  defaultPathFor(service: ServiceDescriptor): readonly string[] {
    const paths = this.pathsFor(service);
    if (paths.length === 0) return [];
    return paths[defaultPathIndex(paths, service, this.matrix)];
  }

  glanceEnvsFor(service: ServiceDescriptor): readonly string[] {
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

  readonly glancePillClass = glancePillClass;
  readonly shortHash = shortHash;
}
