// FR-13 Swim-lane layout.
//
// One horizontal lane per filtered service. Inside each lane envs are
// grouped into topological-depth columns (parents to the left of children).
// Edges are drawn as SVG paths over the lane; anchors come from live
// `getBoundingClientRect()` of each `.node` / `.pill` (NFR-09 (b)).
//
// Empty-topology fallback: when `topology.edges` is empty, the lane renders
// as a single root chain (one node per env, ordered by `current.deployed_at`).
//
// Re-measurement triggers (NFR-09 (c)):
//   - `ResizeObserver` on every lane row
//   - window `resize` listener
//   - any store change that mutates layout / view / filters / matrix /
//     topology (effect at the top of the component)
//
// Glance exception (NFR-09 Glance only): the env-tag renders inside the
// pill; the outside-pill env-tag is suppressed and `.leaf-pair` collapses
// to one column. Same DOM as the Matrix-layout Glance pill.

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  afterEveryRender,
  computed,
  inject,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotState,
  type ViewId
} from '@dd/shared';
import { LayoutLeafComponent } from '@dd/matrix';
import { depthBuckets, topologyShape } from './topology-utils';

interface EdgePath {
  d: string;
  source: 'explicit' | 'correlated';
}

@Component({
  selector: 'dd-swim-lane-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.view() === 'focus') {
      <!-- Focus toolbar — discoverability hint, pinned count, collapse-all.
           Mirrors mockup lines 1997-2009 (above swim-lane Focus). -->
      <div class="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-4 text-xs">
        <span class="inline-flex items-center gap-1.5 text-gray-600" data-testid="focus-toolbar-hint">
          <svg class="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          <span>Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.</span>
        </span>
        @if (pinnedCount() > 0) {
          <span class="text-amber-600 font-semibold" data-testid="pinned-count">
            <span>{{ pinnedCount() }}</span> pinned
          </span>
        }
        @if (hasExpanded()) {
          <button
            type="button"
            class="ml-auto text-gray-600 hover:text-gray-900 underline"
            data-testid="collapse-all"
            (click)="store.collapseAll()"
          >Collapse all</button>
        }
      </div>
    }

    <main
      #root
      class="px-6 pt-4 pb-8"
      [class.mr-\\[26rem\\]]="store.drawerOpen()"
      style="transition: margin-right 0.2s ease"
      data-testid="pipeline-matrix"
      [attr.data-view]="store.view()"
      [attr.data-layout]="store.layout()"
    >
      <div class="space-y-2">
        @for (service of store.filteredServices(); track service.id) {
          <!-- When this lane is Focus-expanded, the inline --leaf-width
               override widens every leaf-pair in lock-step (Option A). -->
          <div
            class="lane-row relative bg-white rounded-lg border border-gray-200 px-3 py-2"
            [class.focus-row]="store.view() === 'focus'"
            [class.row-expanded]="store.view() === 'focus' && isExpanded(service.id)"
            [class.border-blue-200]="store.view() === 'focus' && isExpanded(service.id)"
            [attr.data-testid]="laneRowTestid(service)"
            [attr.data-service-row]="service.id"
            [attr.data-expanded]="store.view() === 'focus' && isExpanded(service.id) ? 'true' : 'false'"
            [attr.data-pinned]="store.view() === 'focus' && isPinned(service.id) ? 'true' : 'false'"
            [attr.style]="laneStyle(service.id)"
          >
            <!-- Legacy testid alias — older specs address the lane via
                 swim-lane-row-{id}; Focus view repurposes the primary
                 testid for row-expanded-/row-collapsed-, so this hidden
                 marker keeps the legacy selector resolvable. -->
            @if (store.view() === 'focus') {
              <span class="sr-only" [attr.data-testid]="'swim-lane-row-' + service.id"></span>
            }
            <div class="flex items-start gap-3">
              <!-- Service label column — same 176 px footprint as Matrix. -->
              <div class="w-44 shrink-0 pr-2 self-stretch flex flex-col justify-center min-w-0 lane-label">
                @if (store.view() === 'focus') {
                  <div class="flex items-center gap-1 mb-1">
                    <button
                      type="button"
                      class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border transition-colors"
                      [class.bg-blue-100]="isExpanded(service.id)"
                      [class.border-blue-300]="isExpanded(service.id)"
                      [class.text-blue-700]="isExpanded(service.id)"
                      [class.hover:bg-blue-200]="isExpanded(service.id)"
                      [class.bg-blue-50]="!isExpanded(service.id)"
                      [class.border-blue-200]="!isExpanded(service.id)"
                      [class.text-blue-600]="!isExpanded(service.id)"
                      [class.hover:bg-blue-100]="!isExpanded(service.id)"
                      [attr.aria-expanded]="isExpanded(service.id)"
                      [attr.aria-label]="isExpanded(service.id) ? 'Collapse lane' : 'Expand lane to full detail'"
                      [title]="isExpanded(service.id) ? 'Collapse lane' : 'Expand lane to full detail'"
                      [attr.data-testid]="'row-chevron-' + service.id"
                      (click)="store.toggleExpand(service.id)"
                    >
                      <svg class="w-3.5 h-3.5 transition-transform" [class.rotate-90]="isExpanded(service.id)" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border transition-colors"
                      [class.pin-active]="isPinned(service.id)"
                      [class.bg-amber-100]="isPinned(service.id)"
                      [class.border-amber-300]="isPinned(service.id)"
                      [class.hover:bg-amber-200]="isPinned(service.id)"
                      [class.bg-gray-50]="!isPinned(service.id)"
                      [class.border-gray-200]="!isPinned(service.id)"
                      [class.text-gray-400]="!isPinned(service.id)"
                      [class.hover:bg-amber-50]="!isPinned(service.id)"
                      [class.hover:text-amber-600]="!isPinned(service.id)"
                      [class.hover:border-amber-200]="!isPinned(service.id)"
                      [attr.aria-pressed]="isPinned(service.id)"
                      [attr.aria-label]="isPinned(service.id) ? 'Unpin lane' : 'Pin lane to keep expanded across filters'"
                      [title]="isPinned(service.id) ? 'Unpin (stays expanded)' : 'Pin lane (stays expanded across filters)'"
                      [attr.data-testid]="'row-pin-' + service.id"
                      (click)="store.togglePin(service.id)"
                    >
                      <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.828 2.172a1 1 0 011.415 0l6.586 6.586a1 1 0 010 1.414l-1.415 1.415-3-3-5 5 3 3-1.414 1.414a1 1 0 01-1.415 0L2 11.414a1 1 0 010-1.414l1.414-1.414 3 3 5-5-3-3 1.414-1.414z" />
                      </svg>
                    </button>
                  </div>
                }
                <!-- NFR-09 #6 — single-line at intrinsic width. The <p>
                     auto-sizes via whitespace-nowrap + inline
                     width:max-content. The .lane-label cell stays at
                     its 176 px grid width; long names overflow visually
                     without clipping (scrollWidth equals clientWidth). -->
                <p
                  class="text-sm font-semibold text-gray-800 whitespace-nowrap"
                  style="width: max-content"
                  [attr.data-testid]="'service-name-' + service.id"
                  [title]="service.name"
                >{{ service.name }}</p>
                @if (showServiceMeta() || (store.view() === 'focus' && isExpanded(service.id))) {
                  <p class="text-[11px] text-gray-400 leading-tight">{{ failureLabel(service) }}</p>
                  <p class="text-[10px] text-gray-400 italic mt-0.5 leading-tight">{{ topoLabel(service) }}</p>
                }
              </div>

              <!-- Depth columns + leaf pairs. -->
              <div class="flex-1 min-w-0 flex items-stretch gap-7" [attr.data-depth-columns]="bucketsFor(service).length">
                @for (bucket of bucketsFor(service); track $index; let depthIdx = $index) {
                  <div class="depth-slot flex flex-col gap-2 min-w-0">
                    @if (bucket.length === 0) {
                      <div class="text-[10px] text-gray-300 text-center italic">—</div>
                    } @else {
                      @for (envId of bucket; track envId) {
                        <div
                          class="leaf-pair relative"
                          [class.leaf-pair-glance]="store.view() === 'glance'"
                          [attr.data-env]="envId"
                        >
                          @if (store.view() !== 'glance') {
                            <span class="env-tag">{{ envLabel(envId) }}</span>
                          }
                          <dd-layout-leaf
                            [service]="service"
                            [env]="envFor(envId)"
                            [slot]="slotFor(service, envId)"
                            [viewOverride]="leafViewOverride(service.id)"
                            [forceAllAttrs]="forceAllAttrsFor(service.id)"
                            (opened)="openSlot.emit($event)"
                          ></dd-layout-leaf>
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            </div>

            <!-- SVG edge overlay. Anchors recomputed on every relevant change. -->
            <svg
              class="edge-overlay"
              [attr.data-edges-for]="service.id"
              [attr.width]="svgSize()[service.id]?.width || 0"
              [attr.height]="svgSize()[service.id]?.height || 0"
            >
              <defs>
                <marker
                  [attr.id]="'arrowhead-' + service.id"
                  viewBox="0 0 10 10"
                  refX="9" refY="5"
                  markerWidth="6" markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af" />
                </marker>
              </defs>
              @for (p of edgePathsFor(service.id); track $index) {
                <path
                  class="edge"
                  [class.edge-correlated]="p.source === 'correlated'"
                  [attr.d]="p.d"
                  [attr.marker-end]="'url(#arrowhead-' + service.id + ')'"
                ></path>
              }
            </svg>
          </div>
        }

        @if (store.filteredServices().length === 0) {
          <div class="text-center py-16 text-gray-400" data-testid="empty-state">
            <p class="text-lg font-medium">No services match your filters</p>
          </div>
        }
      </div>
    </main>
  `
})
export class SwimLaneLayoutComponent {
  readonly store = inject(DeploymentMatrixStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly openSlot = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  @ViewChild('root', { static: true }) private rootEl!: ElementRef<HTMLElement>;

  /** Per-service measured SVG size. Mirrors the mockup's `svgSize` map. */
  readonly svgSize = signal<Record<string, { width: number; height: number }>>({});
  /** Per-service computed edge path strings + their source classification. */
  readonly edgePaths = signal<Record<string, readonly EdgePath[]>>({});

  private resizeObserver: ResizeObserver | null = null;
  private resizeHandler = () => this.scheduleRecompute();
  /** Last computed geometry signature — short-circuits `afterEveryRender`
   *  so writing identical paths back into the signals doesn't re-trigger
   *  CD and loop us forever. */
  private lastGeometryHash = '';

  /** Per FR-13 / NFR-09 + mockup `showServiceMeta` 12-cell rule (Swim-lane). */
  readonly showServiceMeta = computed(() =>
    this.store.view() === 'detailed' && this.store.layout() === 'swim-lane'
  );

  /** True when at least one service is currently Focus-expanded. */
  readonly hasExpanded = computed(() => this.store.expandedServices().size > 0);

  /** Number of services with the pin set — surfaced in the Focus toolbar. */
  readonly pinnedCount = computed(() => this.store.pinnedServices().size);

  /** Per-service expansion check (Focus view; layout-agnostic state). */
  isExpanded(serviceId: string): boolean {
    return this.store.expandedServices().has(serviceId);
  }

  /** Per-service pin check (Focus view; layout-agnostic state). */
  isPinned(serviceId: string): boolean {
    return this.store.pinnedServices().has(serviceId);
  }

  /**
   * Lane row testid — Focus view uses the layout-agnostic
   * `row-expanded-{id}` / `row-collapsed-{id}`; other views keep the
   * existing `swim-lane-row-{id}` shape (existing e2e tests + the
   * filter-resilience spec rely on the legacy testid).
   */
  laneRowTestid(service: ServiceDescriptor): string {
    if (this.store.view() === 'focus') {
      return (this.isExpanded(service.id) ? 'row-expanded-' : 'row-collapsed-') + service.id;
    }
    return 'swim-lane-row-' + service.id;
  }

  /**
   * Inline style for the lane-row. Writes the expanded `--leaf-width`
   * override on the lane when (view=focus AND expanded[id]). Mirrors mockup
   * lines 2025-2027 — the per-lane override widens every leaf-pair in the
   * lane without touching siblings. NFR-09 (b) connectors are reflown by
   * the existing `afterEveryRender` chain.
   */
  laneStyle(serviceId: string): string {
    if (this.store.view() === 'focus' && this.isExpanded(serviceId)) {
      return '--leaf-width-expanded: 200px; --leaf-width: var(--leaf-width-expanded);';
    }
    return '--leaf-width-expanded: 200px;';
  }

  /**
   * Leaf view-override for the LayoutLeafComponent. In Focus + expanded
   * the leaf renders as Detailed (full-fidelity); collapsed Focus uses
   * the Compact / Focus-collapsed branch (Option A — only Detailed +
   * Compact branches participate in the Focus expand/collapse flip).
   */
  leafViewOverride(serviceId: string): ViewId | null {
    if (this.store.view() === 'focus') {
      return this.isExpanded(serviceId) ? 'detailed' : 'compact';
    }
    return null;
  }

  /** Force all attributes when the lane is Focus-expanded. */
  forceAllAttrsFor(serviceId: string): boolean {
    return this.store.view() === 'focus' && this.isExpanded(serviceId);
  }

  constructor() {
    // NFR-09 (c) re-measurement: `afterEveryRender({ read })` runs after every
    // Angular render cycle, AFTER the @for has materialised its children. This
    // replaces the previous `effect()` -> queueMicrotask -> rAF chain which
    // raced the @for child mount on cold paint (paths never appeared because
    // `getBoundingClientRect()` of `.node` returned 0).
    //
    // The ResizeObserver + window-resize listener (set up below) still cover
    // non-Angular triggers: drawer transition, window resize, fonts loading.
    afterEveryRender({
      // `mixedReadWrite` rather than `read`: we read DOM geometry AND write
      // results back into `svgSize` / `edgePaths` signals. The signals'
      // ref-equality on Records would otherwise loop us — `lastGeometryHash`
      // guards that.
      mixedReadWrite: () => this.recomputeAllEdges()
    });

    // Initial observer attachment + window listener. Done in constructor so
    // teardown is symmetrical with destroyRef.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.resizeHandler);
    }
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', this.resizeHandler);
      }
    });
  }

  // ----- template helpers --------------------------------------------------

  bucketsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return depthBuckets(
      this.store.topologyFor(service.id),
      service,
      this.store.environments(),
      this.store.matrix()
    );
  }

  edgePathsFor(serviceId: string): readonly EdgePath[] {
    return this.edgePaths()[serviceId] ?? [];
  }

  envLabel(envId: string): string {
    return this.store.environments().find(e => e.id === envId)?.label
        ?? envId.toUpperCase();
  }

  envFor(envId: string): EnvironmentDescriptor {
    return this.store.environments().find(e => e.id === envId)
        ?? { id: envId, label: envId.toUpperCase() };
  }

  slotFor(service: ServiceDescriptor, envId: string): SlotState | null {
    return this.store.matrix()[service.id]?.[envId] ?? null;
  }

  failureLabel(service: ServiceDescriptor): string {
    const envs = this.store.matrix()[service.id] ?? {};
    const n = Object.values(envs).filter(s => s?.current.status === 'failure').length;
    return n > 0 ? `${n} failure(s)` : 'All green';
  }

  topoLabel(service: ServiceDescriptor): string {
    return topologyShape(this.store.topologyFor(service.id));
  }

  // ----- edge geometry recomputation (NFR-09) ------------------------------

  private scheduled = false;
  private scheduleRecompute(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => requestAnimationFrame(() => {
      this.scheduled = false;
      this.recomputeAllEdges();
      this.attachObserver();
    }));
  }

  private attachObserver(): void {
    const root = this.rootEl?.nativeElement;
    if (!root || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.scheduleRecompute());
    root.querySelectorAll('[data-service-row]').forEach(el =>
      this.resizeObserver!.observe(el as Element)
    );
  }

  private recomputeAllEdges(): void {
    const root = this.rootEl?.nativeElement;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>('[data-service-row]');
    // Cold-paint guard: if rows haven't materialised yet, bail. `afterEveryRender`
    // will re-fire on the next render once the @for children mount.
    if (rows.length === 0) return;

    const sizes: Record<string, { width: number; height: number }> = {};
    const paths: Record<string, EdgePath[]> = {};
    rows.forEach(row => {
      const serviceId = row.getAttribute('data-service-row');
      if (!serviceId) return;
      const rowRect = row.getBoundingClientRect();
      // If the row itself hasn't been laid out yet (width/height 0), skip —
      // the next render's `afterEveryRender` will retry.
      if (rowRect.width === 0 || rowRect.height === 0) return;
      sizes[serviceId] = { width: rowRect.width, height: rowRect.height };

      // Anchor on the inner box (.node / .pill / .pill-empty / dd-stage-box),
      // never the env-tag wrapper. Mirrors the mockup invariant (b).
      const anchors: Record<string, {
        left: number; right: number; top: number; bottom: number; cy: number;
      }> = {};
      row.querySelectorAll<HTMLElement>('[data-env]').forEach(wrapper => {
        const envId = wrapper.getAttribute('data-env')!;
        const inner =
          wrapper.querySelector<HTMLElement>(
            '.pill, .pill-empty, [data-testid^="stage-box-"]'
          ) ?? wrapper;
        const r = inner.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        anchors[envId] = {
          left: r.left - rowRect.left,
          right: r.right - rowRect.left,
          top: r.top - rowRect.top,
          bottom: r.bottom - rowRect.top,
          cy: (r.top + r.bottom) / 2 - rowRect.top
        };
      });

      const topology = this.store.topologyFor(serviceId);
      const edges: EdgePath[] = [];
      for (const e of topology.edges) {
        const p = anchors[e.from];
        const c = anchors[e.to];
        if (!p || !c) continue;
        const x1 = p.right;
        const y1 = p.cy;
        const x2 = c.left;
        const y2 = c.cy;
        const xBend = p.right + 4;
        const d = Math.abs(y1 - y2) < 0.5
          ? `M ${x1} ${y1} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${xBend} ${y1} L ${xBend} ${y2} L ${x2} ${y2}`;
        edges.push({ d, source: e.source });
      }
      paths[serviceId] = edges;
    });

    // Short-circuit: writing identical geometry back into the signals would
    // trigger CD which would re-trigger `afterEveryRender` which would call
    // us again — fine as long as we bail here before re-setting the signals.
    const hash = this.hashGeometry(sizes, paths);
    if (hash === this.lastGeometryHash) {
      // Geometry stable. Just re-attach observers in case rows mounted/unmounted
      // since the last run; ResizeObserver.observe is idempotent on the same node.
      this.attachObserver();
      return;
    }
    this.lastGeometryHash = hash;
    this.svgSize.set(sizes);
    this.edgePaths.set(paths);
    this.attachObserver();
  }

  private hashGeometry(
    sizes: Record<string, { width: number; height: number }>,
    paths: Record<string, EdgePath[]>
  ): string {
    const parts: string[] = [];
    for (const id of Object.keys(sizes).sort()) {
      parts.push(`${id}:${sizes[id].width.toFixed(1)}x${sizes[id].height.toFixed(1)}`);
    }
    for (const id of Object.keys(paths).sort()) {
      const ds = paths[id].map(p => p.d + '|' + p.source).join(';');
      parts.push(`${id}=${ds}`);
    }
    return parts.join('||');
  }
}
