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
//   focus    — Focus chrome: per-service THREE controls (SPA DOM match):
//                btn0  row-chevron-{id}      expand to Detailed density (polyline SVG)
//                btn1  row-pin-{id}          pin (amber; thumbtack SVG — verbatim)
//                btn2  workflow-toggle-{id}  show ALL wfs vs last-active wf (chev class SVG)
//              Service label sits in a LEFT cell; wf rows in a RIGHT cell (grid layout).
//              "Expand all workflows" button toggles all btn2 states atomically.
//              Helper text bar above.
//   glance   — one row per service with mini env-pill strip;
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

// Default path index: most recently deployed.
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
  if (s === 'success') return 'border-green-300 bg-white';
  if (s === 'failure') return 'border-red-300 bg-white';
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
//   detailExpanded  — btn0: show Detailed density instead of Compact
//   pinned          — btn1: keep expanded across filters
//   allWfsExpanded  — btn2: show ALL wfs vs only the last-active wf
interface FocusState { detailExpanded: boolean; pinned: boolean; allWfsExpanded: boolean; }

@Component({
  selector: 'dd-mockup-workflow-rows-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 py-2 flex items-center gap-3 text-xs bg-white dark:bg-[#161b22] border-b border-gray-200 dark:border-gray-700">
      <span class="text-gray-400 dark:text-gray-500" data-testid="workflow-rows-total">{{ totalPaths() }} workflows</span>
    </div>

    @if (viewMode === 'glance') {
      <!-- ════════════════════════════════════════════════════════════════════
           GLANCE VIEW — one row per service with mini env-pill strip.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 py-2 space-y-1.5"
        data-testid="pipeline-matrix"
        data-view="glance"
        data-layout="workflow-rows"
      >
        @for (service of services; track service.id) {
          <div
            class="bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center gap-2"
            [attr.data-service-row]="service.id"
            [attr.data-testid]="'workflow-rows-' + service.id"
          >
            <button
              type="button"
              class="chev"
              [class.expanded]="isRowExpanded(service.id)"
              [attr.data-testid]="'row-chevron-' + service.id"
              [attr.aria-expanded]="isRowExpanded(service.id)"
              title="Expand service"
              (click)="toggleRowExpand(service.id)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 6 15 12 9 18"/>
              </svg>
            </button>
            <p
              class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap shrink-0"
              [attr.data-testid]="'service-name-' + service.id"
            >{{ service.name }}</p>
            <span class="text-[10px] text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded px-1.5 leading-tight shrink-0">
              {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
            </span>

            <div class="flex items-center flex-wrap min-w-0 gap-0 ml-2">
              @for (envId of glanceEnvsFor(service); track envId; let pIdx = $index) {
                @let slot = slotFor(service, envId);
                @if (pIdx > 0) {
                  <div class="px-1 text-gray-400 dark:text-gray-600 text-xs select-none shrink-0 leading-none">
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
                  <span class="text-[9px] font-bold text-gray-500 dark:text-gray-400 uppercase leading-none">{{ envLabel(envId) }}</span>
                  @if (slot) {
                    @if (slot.current.status === 'in-progress') {
                      <span class="spinner shrink-0" style="width:8px;height:8px;border-width:1.5px"></span>
                    } @else if (slot.current.status === 'success') {
                      <span class="text-green-500 text-[9px] leading-none">✓</span>
                    } @else {
                      <span class="text-red-500 text-[9px] leading-none">✗</span>
                    }
                    <span class="text-[9px] font-mono text-gray-700 dark:text-gray-300 leading-none">{{ shortHash(slot) }}</span>
                    @if (slot.current.status === 'in-progress' && slot.previousFailed) {
                      <span class="text-[8px] text-amber-600 leading-none" title="prev. failed">▲</span>
                    }
                  } @else {
                    <span class="text-[9px] text-gray-300 dark:text-gray-600 leading-none tracking-wider">· · ·</span>
                  }
                </div>
              }
            </div>
          </div>
        }

        @if (services.length === 0) {
          <div class="text-center py-16 text-gray-400 dark:text-gray-600" data-testid="empty-state">
            <p class="text-lg font-medium">No services</p>
          </div>
        }
      </main>

    } @else if (viewMode === 'focus') {
      <!-- ════════════════════════════════════════════════════════════════════
           FOCUS VIEW — per-service THREE-button chrome (SPA DOM match).
           Grid layout: LEFT cell = label chrome, RIGHT cell = wf rows.
           btn0  row-chevron-{id}      Expand to Detailed-density (polyline SVG)
           btn1  row-pin-{id}          Pin across filters (thumbtack SVG)
           btn2  workflow-toggle-{id}  Show all wfs vs last-active wf (chev class)
           "Expand all workflows" bulk-expands all btn2 states.
           ════════════════════════════════════════════════════════════════════ -->
      <div data-testid="pipeline-matrix" data-view="focus" data-layout="workflow-rows">

        <!-- Focus helper text bar + expand-all button -->
        <div class="mx-6 mt-3 mb-2 flex items-center gap-3">
          <div
            class="flex-1 px-3 py-1.5 rounded border border-indigo-100 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/50 text-[11px] text-indigo-600 dark:text-indigo-400 leading-snug"
            data-testid="focus-helper-bar"
          >
            Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.
          </div>
          <button
            type="button"
            class="shrink-0 text-[11px] text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 rounded px-2.5 py-1 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
            data-testid="expand-all-workflows"
            (click)="expandAllWorkflows()"
          >
            Expand all workflows
          </button>
        </div>

        <main class="px-6 pb-8 space-y-1.5">
          @for (service of services; track service.id) {
            <!-- Outer card -->
            <div
              class="focus-row bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'workflow-rows-' + service.id"
              [attr.data-expanded]="focusState(service.id).detailExpanded"
              [attr.data-pinned]="focusState(service.id).pinned"
            >
              <!-- .svc-block grid: LEFT = label column, RIGHT = wf rows -->
              <div class="svc-block">

                <!-- LEFT: label cell with three-button chrome -->
                <div class="svc-block-meta">
                  <div class="svc-block-meta-row">

                    <!-- btn0 — row-chevron: expand to Detailed density -->
                    <button
                      type="button"
                      class="chev"
                      [class.expanded]="focusState(service.id).detailExpanded"
                      [attr.data-testid]="'row-chevron-' + service.id"
                      [attr.aria-expanded]="focusState(service.id).detailExpanded"
                      title="Expand service to Detailed-size fidelity"
                      (click)="toggleDetailExpand(service.id)"
                    >
                      <!-- Polyline SVG — different from the path-based chevron; matches SPA btn2 -->
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 6 15 12 9 18"/>
                      </svg>
                    </button>

                    <!-- btn1 — row-pin: amber thumbtack -->
                    <button
                      type="button"
                      class="chev"
                      [class.pin-active]="focusState(service.id).pinned"
                      [attr.data-testid]="'row-pin-' + service.id"
                      [attr.aria-pressed]="focusState(service.id).pinned"
                      title="Pin lane to keep expanded across filters"
                      (click)="togglePin(service.id)"
                    >
                      <!-- Exact thumbtack path from SPA DOM -->
                      <svg fill="currentColor" viewBox="0 0 20 20" class="w-3.5 h-3.5">
                        <path d="M9.828 2.172a1 1 0 011.415 0l6.586 6.586a1 1 0 010 1.414l-1.415 1.415-3-3-5 5 3 3-1.414 1.414a1 1 0 01-1.415 0L2 11.414a1 1 0 010-1.414l1.414-1.414 3 3 5-5-3-3 1.414-1.414z"/>
                      </svg>
                    </button>

                    <!-- btn2 — workflow-toggle: show all wfs vs last-active wf -->
                    <button
                      type="button"
                      class="chev"
                      [class.expanded]="focusState(service.id).allWfsExpanded"
                      [attr.data-testid]="'workflow-toggle-' + service.id"
                      [attr.aria-expanded]="focusState(service.id).allWfsExpanded"
                      title="Expand all workflows"
                      (click)="toggleAllWfs(service.id)"
                    >
                      <!-- Same polyline as btn0; both use the .chev class -->
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 6 15 12 9 18"/>
                      </svg>
                    </button>

                    <!-- Service name + wf count badge -->
                    <p
                      class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap ml-1 truncate"
                      [attr.data-testid]="'service-name-' + service.id"
                      [title]="service.name"
                    >{{ service.name }}</p>
                    <span
                      class="text-[10px] text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded px-1.5 leading-tight shrink-0 ml-1"
                      [attr.data-testid]="'wf-count-' + service.id"
                    >
                      {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
                    </span>
                  </div>
                  <p class="text-[10px] text-gray-400 dark:text-gray-500 italic leading-tight">{{ topoLabel(service) }}</p>
                </div>

                <!-- RIGHT: wf rows -->
                <div class="svc-block-rows">
                  @let pathsToShow = focusState(service.id).allWfsExpanded
                    ? pathsFor(service)
                    : [pathsFor(service)[defaultPathIndexFor(service)]];

                  @for (path of pathsToShow; track $index; let wfIdx = $index) {
                    <div
                      class="wf-row"
                      [class.default-row]="wfIdx === defaultPathIndexFor(service)"
                      [attr.data-testid]="'workflow-row-' + service.id + '-' + wfIdx"
                    >
                      <div class="flex items-stretch">
                        @for (envId of path; track envId + ':' + $index; let eIdx = $index) {
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
              </div>
            </div>
          }

          @if (services.length === 0) {
            <div class="text-center py-16 text-gray-400 dark:text-gray-600" data-testid="empty-state">
              <p class="text-lg font-medium">No services</p>
            </div>
          }
        </main>
      </div>

    } @else {
      <!-- ════════════════════════════════════════════════════════════════════
           DETAILED / COMPACT VIEW — workflow rows with per-service expand.
           First service is expanded by default; all chevrons are wired.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 py-2 space-y-3"
        data-testid="pipeline-matrix"
        [attr.data-view]="viewMode"
        data-layout="workflow-rows"
      >
        @for (service of services; track service.id) {
          @if (!isRowExpanded(service.id)) {
            <!-- Collapsed row -->
            <div
              class="svc-block-collapsed bg-white dark:bg-[#161b22] rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-2"
              [attr.data-service]="service.id"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'workflow-rows-' + service.id"
              data-expanded="false"
            >
              <button
                type="button"
                class="chev"
                [attr.data-testid]="'row-chevron-' + service.id"
                [attr.aria-expanded]="false"
                title="Expand service"
                (click)="toggleRowExpand(service.id)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
              </button>
              <p
                class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap"
                [attr.data-testid]="'service-name-' + service.id"
                [title]="service.name"
              >{{ service.name }}</p>
              <span class="text-[10px] text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded px-1.5 leading-tight shrink-0"
                    [attr.data-testid]="'wf-count-' + service.id">
                {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
              </span>
              <span class="text-[10px] text-gray-400 dark:text-gray-500 italic ml-1">{{ topoLabel(service) }}</span>
            </div>
          } @else {
            <!-- Expanded row -->
            <section
              class="svc-block dark:[background:rgb(22_27_34)] dark:border-gray-700"
              [attr.data-service]="service.id"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'workflow-rows-' + service.id"
              data-expanded="true"
            >
              <div class="svc-block-meta dark:border-gray-800">
                <div class="svc-block-meta-row">
                  <button
                    type="button"
                    class="chev expanded"
                    [attr.data-testid]="'row-chevron-' + service.id"
                    [attr.aria-expanded]="true"
                    title="Collapse service"
                    (click)="toggleRowExpand(service.id)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 6 15 12 9 18"/>
                    </svg>
                  </button>
                  <p
                    class="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap ml-1"
                    style="width: max-content"
                    [attr.data-testid]="'service-name-' + service.id"
                    [title]="service.name"
                  >{{ service.name }}</p>
                  <span class="text-[10px] text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded px-1.5 leading-tight ml-1 shrink-0">
                    {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
                  </span>
                </div>
                <p class="text-[10px] text-gray-400 dark:text-gray-500 italic leading-tight">{{ topoLabel(service) }}</p>
              </div>

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
                  <div class="text-[10px] text-gray-400 dark:text-gray-500 italic px-1 py-0.5">
                    + {{ pathsFor(service).length - 1 }} more workflow{{ pathsFor(service).length > 2 ? 's' : '' }} (expand to view)
                  </div>
                }
              </div>
            </section>
          }
        }

        @if (services.length === 0) {
          <div class="text-center py-16 text-gray-400 dark:text-gray-600" data-testid="empty-state">
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

  // ── Non-Focus per-service expand state ─────────────────────────────────────
  // Default: first service expanded, rest collapsed. Shared across Detailed,
  // Compact, and Glance views (all three use the same signal so toggling is
  // consistent when the user switches density without leaving the route).
  private readonly _rowExpanded = signal<Record<string, boolean>>({});

  isRowExpanded(serviceId: string): boolean {
    const stored = this._rowExpanded()[serviceId];
    if (stored !== undefined) return stored;
    // Default: first service in the list is expanded.
    return this.services.length > 0 && this.services[0].id === serviceId;
  }

  toggleRowExpand(serviceId: string): void {
    this._rowExpanded.update(prev => ({
      ...prev,
      [serviceId]: !this.isRowExpanded(serviceId)
    }));
  }

  // ── Focus chrome state ──────────────────────────────────────────────────────
  private readonly _focusStates = signal<Record<string, FocusState>>({});

  focusState(serviceId: string): FocusState {
    return this._focusStates()[serviceId] ?? { detailExpanded: false, pinned: false, allWfsExpanded: false };
  }

  toggleDetailExpand(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), detailExpanded: !this.focusState(serviceId).detailExpanded }
    }));
  }

  togglePin(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), pinned: !this.focusState(serviceId).pinned }
    }));
  }

  toggleAllWfs(serviceId: string): void {
    this._focusStates.update(prev => ({
      ...prev,
      [serviceId]: { ...this.focusState(serviceId), allWfsExpanded: !this.focusState(serviceId).allWfsExpanded }
    }));
  }

  expandAllWorkflows(): void {
    const next: Record<string, FocusState> = {};
    for (const svc of this.services) {
      next[svc.id] = { ...this.focusState(svc.id), allWfsExpanded: true };
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
