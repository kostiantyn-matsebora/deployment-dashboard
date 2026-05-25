// Hand-authored visual mirror of <dd-swim-lane-layout> from frontend/matrix/src/lib/.
//
// Mockup simplification vs SPA:
//   - No store signals; all data via @Input().
//   - No afterEveryRender / ResizeObserver / getBoundingClientRect.
//   - SVG edge overlay rendered statically.
//   - Topology depth-bucket algorithm hand-authored locally.
//   - OnPush change detection.
//
// viewMode rendering:
//   detailed — full 5-row stage-box via layout-leaf
//   compact  — condensed 3-row box via layout-leaf (viewMode='compact')
//   focus    — same as compact (Focus treated as Compact density in mockup)
//   glance   — one row per service: service-name + horizontal mini env-pill strip;
//              each pill: env-label + status icon + 7-char hash inline;
//              greyed placeholder for empty slots; arrow connectors between pills

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LayoutLeafComponent } from './layout-leaf.component';
import type {
  ServiceDescriptor, EnvironmentDescriptor, MatrixState, TopologyState, SlotState, Topology
} from '../fixtures/index';
import type { ViewMode } from '../view-mode.service';

// Depth-bucket BFS — mirrors topology-utils.ts depthBuckets().
function depthBuckets(
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
      });
    return populated.length > 0 ? [populated.map(e => e.id)] : [environments.map(e => e.id)];
  }
  const inDegree: Record<string, number> = {};
  const children: Record<string, string[]> = {};
  const allNodes = new Set<string>();
  for (const e of edges) {
    allNodes.add(e.from);
    allNodes.add(e.to);
    inDegree[e.to] = (inDegree[e.to] ?? 0) + 1;
    (children[e.from] ??= []).push(e.to);
  }
  const roots = [...allNodes].filter(n => !inDegree[n]);
  const depth: Record<string, number> = {};
  const queue = [...roots];
  for (const r of roots) depth[r] = 0;
  while (queue.length) {
    const node = queue.shift()!;
    for (const child of (children[node] ?? [])) {
      depth[child] = Math.max(depth[child] ?? 0, (depth[node] ?? 0) + 1);
      queue.push(child);
    }
  }
  const maxDepth = Math.max(...Object.values(depth), 0);
  const buckets: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const envId of Object.keys(depth)) {
    buckets[depth[envId]].push(envId);
  }
  const unplaced = environments.map(e => e.id).filter(id => !(id in depth));
  if (unplaced.length > 0) buckets.push(unplaced);
  return buckets.filter(b => b.length > 0);
}

// Flatten buckets into ordered env-id sequence for glance pill strip.
function flatEnvOrder(
  topology: Topology,
  service: ServiceDescriptor,
  environments: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): readonly string[] {
  return depthBuckets(topology, service, environments, matrix).flatMap(b => b);
}

// Glance pill border class.
function glancePillClass(slot: SlotState | null): string {
  if (!slot) return 'border-gray-200 bg-gray-50';
  const s = slot.current.status;
  if (s === 'success')     return 'border-green-300 bg-white';
  if (s === 'failure')     return 'border-red-300 bg-white';
  return 'border-orange-400 bg-white';
}

// 7-char hash helper for glance pills.
function shortHash(slot: SlotState): string {
  if (slot.current.sha) return slot.current.sha.slice(0, 7);
  const id = slot.current.deploymentId;
  const digits = id.replace(/\D/g, '');
  if (digits) return parseInt(digits, 10).toString(16).padStart(7, '0').slice(0, 7);
  return id.slice(0, 7);
}

@Component({
  selector: 'dd-mockup-swim-lane-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (viewMode === 'glance') {
      <!-- ════════════════════════════════════════════════════════════════════
           GLANCE VIEW — one row per service; horizontal env-pill strip.
           Matches spa-swim_lane-glance.png.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 pt-4 pb-8 space-y-1.5"
        data-testid="pipeline-matrix"
        data-view="glance"
        data-layout="swim-lane"
      >
        @for (service of services; track service.id) {
          <div
            class="bg-white rounded-lg border border-gray-200 px-3 py-2 flex items-center gap-3"
            [attr.data-service-row]="service.id"
            [attr.data-testid]="'swim-lane-row-' + service.id"
          >
            <!-- Service name column (fixed width) -->
            <div class="shrink-0" style="min-width: 11rem">
              <p class="text-sm font-semibold text-gray-800 whitespace-nowrap truncate"
                 [attr.data-testid]="'service-name-' + service.id"
                 [title]="service.name"
              >{{ service.name }}</p>
              <p class="text-[10px] text-gray-400 italic leading-tight">{{ topoLabel(service) }}</p>
            </div>

            <!-- Pill strip with connectors -->
            <div class="flex items-center flex-wrap min-w-0 gap-0">
              @for (envId of glanceEnvOrder(service); track envId; let pIdx = $index) {
                @let slot = slotFor(service, envId);

                @if (pIdx > 0) {
                  <!-- Arrow connector; dashed style when current env is in-progress -->
                  <div class="px-1 text-gray-400 text-xs select-none shrink-0 leading-none">
                    @if (slot?.current?.status === 'in-progress') {
                      <span class="tracking-tighter opacity-60">- - &rsaquo;</span>
                    } @else {
                      <span>&rarr;</span>
                    }
                  </div>
                }

                <!-- Glance pill: env label + status icon + 7-char hash -->
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
    } @else {
      <!-- ════════════════════════════════════════════════════════════════════
           DETAILED / COMPACT / FOCUS VIEW — depth-bucket swim lanes.
           viewMode threaded to layout-leaf for compact/focus condensed boxes.
           ════════════════════════════════════════════════════════════════════ -->
      <main
        class="px-6 pt-4 pb-8"
        data-testid="pipeline-matrix"
        [attr.data-view]="viewMode"
        data-layout="swim-lane"
      >
        <div class="space-y-2">
          @for (service of services; track service.id) {
            <div
              class="lane-row relative bg-white rounded-lg border border-gray-200 px-3 py-2"
              [attr.data-service-row]="service.id"
              [attr.data-testid]="'swim-lane-row-' + service.id"
            >
              <div class="flex items-start gap-3">
                <!-- Service label column -->
                <div
                  class="shrink-0 pr-2 self-stretch flex flex-col justify-center lane-label"
                  style="min-width: 11rem"
                >
                  <p
                    class="text-sm font-semibold text-gray-800 whitespace-nowrap"
                    style="width: max-content"
                    [attr.data-testid]="'service-name-' + service.id"
                    [title]="service.name"
                  >{{ service.name }}</p>
                  <p class="text-[10px] text-gray-400 italic mt-0.5 leading-tight">{{ topoLabel(service) }}</p>
                </div>

                <!-- Depth columns -->
                <div
                  class="flex-1 min-w-0 flex items-stretch"
                  style="column-gap: clamp(8px, 1.5vw, 28px); gap: clamp(8px, 1.5vw, 28px)"
                  [attr.data-depth-columns]="bucketsFor(service).length"
                >
                  @for (bucket of bucketsFor(service); track $index) {
                    <div class="depth-slot flex flex-col gap-2 min-w-0">
                      @if (bucket.length === 0) {
                        <div class="text-[10px] text-gray-300 text-center italic">—</div>
                      } @else {
                        @for (envId of bucket; track envId) {
                          <div
                            class="leaf-pair relative"
                            [attr.data-env]="envId"
                          >
                            <span class="env-tag">{{ envLabel(envId) }}</span>
                            <dd-mockup-layout-leaf
                              [service]="service"
                              [env]="envFor(envId)"
                              [slot]="slotFor(service, envId)"
                              [viewMode]="viewMode"
                            ></dd-mockup-layout-leaf>
                          </div>
                        }
                      }
                    </div>
                  }
                </div>
              </div>

              @if (hasEdges(service)) {
                <div class="absolute top-2 right-2 text-[9px] text-gray-300 italic">
                  {{ edgeCount(service) }} edge{{ edgeCount(service) === 1 ? '' : 's' }}
                </div>
              }
            </div>
          }

          @if (services.length === 0) {
            <div class="text-center py-16 text-gray-400" data-testid="empty-state">
              <p class="text-lg font-medium">No services</p>
            </div>
          }
        </div>
      </main>
    }
  `
})
export class SwimLaneLayoutComponent {
  @Input({ required: true }) services!: readonly ServiceDescriptor[];
  @Input({ required: true }) environments!: readonly EnvironmentDescriptor[];
  @Input({ required: true }) matrix!: MatrixState;
  @Input({ required: true }) topology!: TopologyState;
  @Input() viewMode: ViewMode = 'detailed';

  bucketsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return depthBuckets(
      this.topology[service.id] ?? { edges: [] },
      service,
      this.environments,
      this.matrix
    );
  }

  glanceEnvOrder(service: ServiceDescriptor): readonly string[] {
    return flatEnvOrder(
      this.topology[service.id] ?? { edges: [] },
      service,
      this.environments,
      this.matrix
    );
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

  hasEdges(service: ServiceDescriptor): boolean {
    return (this.topology[service.id]?.edges.length ?? 0) > 0;
  }

  edgeCount(service: ServiceDescriptor): number {
    return this.topology[service.id]?.edges.length ?? 0;
  }

  topoLabel(service: ServiceDescriptor): string {
    const edges = this.topology[service.id]?.edges ?? [];
    const outDeg: Record<string, number> = {};
    const inDeg: Record<string, number> = {};
    for (const e of edges) {
      outDeg[e.from] = (outDeg[e.from] ?? 0) + 1;
      inDeg[e.to]    = (inDeg[e.to]    ?? 0) + 1;
    }
    const hasFork  = Object.values(outDeg).some(d => d > 1);
    const hasMerge = Object.values(inDeg).some(d => d > 1);
    const slots = Object.values(this.matrix[service.id] ?? {});
    const hasFailure = slots.some(s => s?.current.status === 'failure');
    const hasRunning = slots.some(s => s?.current.status === 'in-progress');
    if (hasFork && hasMerge) return 'branching + merging';
    if (hasFork)    return 'branching';
    if (hasFailure) return 'has failures';
    if (hasRunning) return 'deploying…';
    return 'All green';
  }

  readonly glancePillClass = glancePillClass;
  readonly shortHash = shortHash;
}
