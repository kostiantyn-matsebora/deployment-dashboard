// FR-13 Workflow-rows layout.
//
// One row per root-to-leaf path through each service's DAG. Collapsed mode
// (default) shows only the "default path" — whichever root-to-leaf path
// holds the latest deployment event. When a new event lands on a different
// path, the default switches and the row reactively swaps in (with an
// Angular fade transition; the mockup uses Alpine `x-transition`).
//
// Expand toggle: per-service chevron in the meta column shows every path.
// "Expand all workflows" / "Collapse all workflows" lives at the top of
// the layout.
//
// Empty-topology fallback: single root chain ordered by `current.deployed_at`,
// rendered as one path (same as Swim-lane).
//
// Re-measurement (NFR-09): the connector geometry is recomputed via
// `ResizeObserver` + the connector `--target-half` / `--target-line-width`
// CSS vars, the same model used by the matrix's existing arrow-line.

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
import {
  defaultPathIndex,
  rootToLeafPaths,
  topologyShape
} from './topology-utils';

@Component({
  selector: 'dd-workflow-rows-layout',
  standalone: true,
  imports: [CommonModule, LayoutLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.view() === 'focus') {
      <!-- Focus toolbar — discoverability hint, pinned count, collapse-all.
           Mirrors mockup lines 2385-2397 (above workflow-rows Focus). -->
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

    <div class="px-6 py-2 flex items-center gap-3 text-xs bg-white border-b border-gray-200">
      <button
        type="button"
        class="text-xs border border-gray-200 rounded-md px-2.5 py-1 bg-white text-gray-700 hover:bg-gray-50"
        [title]="allExpanded() ? 'Collapse every workflow to its default path' : 'Show every workflow row for every service'"
        data-testid="workflow-rows-expand-all"
        (click)="toggleAllExpanded()"
      >{{ allExpanded() ? 'Collapse all workflows' : 'Expand all workflows' }}</button>
      <span class="text-gray-400" data-testid="workflow-rows-total">{{ store.totalWorkflowPaths() }} workflows</span>
    </div>

    <main
      #root
      class="px-6 py-2 space-y-3"
      [class.mr-\\[26rem\\]]="store.drawerOpen()"
      style="transition: margin-right 0.2s ease"
      data-testid="pipeline-matrix"
      [attr.data-view]="store.view()"
      [attr.data-layout]="store.layout()"
    >
      @for (service of store.filteredServices(); track service.id) {
        <!-- When this service is Focus-expanded, override --leaf-width on
             the .svc-block so every .wf-row in the stack widens in lock-step.
             Mirrors mockup lines 2427-2428. -->
        <section
          class="svc-block"
          [class.focus-row]="store.view() === 'focus'"
          [class.row-expanded]="store.view() === 'focus' && isFocusExpanded(service.id)"
          [attr.data-service]="service.id"
          [attr.data-service-row]="service.id"
          [attr.data-testid]="serviceBlockTestid(service)"
          [attr.data-expanded]="store.view() === 'focus' && isFocusExpanded(service.id) ? 'true' : 'false'"
          [attr.data-pinned]="store.view() === 'focus' && isPinned(service.id) ? 'true' : 'false'"
          [attr.style]="serviceBlockStyle(service.id)"
        >
          <!-- Legacy testid alias — older specs address the section via
               workflow-rows-{id}; Focus view repurposes the primary
               testid for row-expanded-/row-collapsed-, so this hidden
               marker keeps the legacy selector resolvable. -->
          @if (store.view() === 'focus') {
            <span class="sr-only" [attr.data-testid]="'workflow-rows-' + service.id"></span>
          }
          <!-- Meta column. -->
          <div class="svc-block-meta">
            <div class="svc-block-meta-row">
              @if (store.view() === 'focus') {
                <span class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border transition-colors"
                    [class.bg-blue-100]="isFocusExpanded(service.id)"
                    [class.border-blue-300]="isFocusExpanded(service.id)"
                    [class.text-blue-700]="isFocusExpanded(service.id)"
                    [class.hover:bg-blue-200]="isFocusExpanded(service.id)"
                    [class.bg-blue-50]="!isFocusExpanded(service.id)"
                    [class.border-blue-200]="!isFocusExpanded(service.id)"
                    [class.text-blue-600]="!isFocusExpanded(service.id)"
                    [class.hover:bg-blue-100]="!isFocusExpanded(service.id)"
                    [attr.aria-expanded]="isFocusExpanded(service.id)"
                    [attr.aria-label]="isFocusExpanded(service.id) ? 'Collapse service' : 'Expand service to full detail'"
                    [title]="isFocusExpanded(service.id) ? 'Collapse service (Detailed)' : 'Expand service to Detailed-size fidelity'"
                    [attr.data-testid]="'row-chevron-' + service.id"
                    (click)="store.toggleExpand(service.id)"
                  >
                    <svg class="w-3.5 h-3.5 transition-transform" [class.rotate-90]="isFocusExpanded(service.id)" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                    [attr.aria-label]="isPinned(service.id) ? 'Unpin service' : 'Pin service to keep expanded across filters'"
                    [title]="isPinned(service.id) ? 'Unpin (stays expanded)' : 'Pin service (stays expanded across filters)'"
                    [attr.data-testid]="'row-pin-' + service.id"
                    (click)="store.togglePin(service.id)"
                  >
                    <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.828 2.172a1 1 0 011.415 0l6.586 6.586a1 1 0 010 1.414l-1.415 1.415-3-3-5 5 3 3-1.414 1.414a1 1 0 01-1.415 0L2 11.414a1 1 0 010-1.414l1.414-1.414 3 3 5-5-3-3 1.414-1.414z" />
                    </svg>
                  </button>
                </span>
              }
              <button
                type="button"
                class="chev"
                [class.disabled]="pathsFor(service).length < 2"
                [class.expanded]="isExpanded(service.id)"
                [title]="pathsFor(service).length < 2 ? 'Only one workflow' : (isExpanded(service.id) ? 'Collapse' : 'Expand all workflows')"
                [attr.data-testid]="'workflow-toggle-' + service.id"
                [disabled]="pathsFor(service).length < 2"
                (click)="store.toggleWorkflowExpand(service.id)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 6 15 12 9 18"></polyline>
                </svg>
              </button>
              <!-- NFR-09 #6 — single-line at intrinsic width. whitespace-nowrap
                   + inline width:max-content content-size the p so
                   scrollWidth equals clientWidth by construction. The parent
                   .svc-block grid column AUTOSIZES via
                   minmax(176px, max-content) (see styles.css .svc-block) —
                   long names + workflow-count badge push the column wider
                   rather than overflowing into the first env-stage column.
                   The former flex-1 min-w-0 (which forced flex shrinking and
                   activated truncate-like overflow:hidden on ancestors) is
                   dropped — content-driven width is the source of truth. -->
              <p
                class="text-sm font-semibold text-gray-800 whitespace-nowrap"
                style="width: max-content"
                [attr.data-testid]="'service-name-' + service.id"
                [title]="service.name"
              >{{ service.name }}</p>
              <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight ml-1 shrink-0">
                {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
              </span>
            </div>
            @if (showServiceMeta() || (store.view() === 'focus' && isFocusExpanded(service.id))) {
              <p class="text-[10px] text-gray-400 truncate">{{ failureLabel(service) }}</p>
              <p class="text-[10px] text-gray-400 italic leading-tight truncate">{{ topoLabel(service) }}</p>
              @if (!isExpanded(service.id) && pathsFor(service).length > 1) {
                <p class="text-[10px] text-gray-500 italic leading-tight"
                   [attr.data-testid]="'workflow-default-hint-' + service.id"
                >default · 1/{{ pathsFor(service).length }}</p>
              }
            }
          </div>

          <!-- Workflow stack. -->
          <div class="svc-block-rows">
            @for (path of visiblePathsFor(service); track path.join('>'); let pIdx = $index) {
              <div
                class="wf-row"
                [class.default-row]="isDefaultPath(service, pIdx)"
                [attr.data-service-row]="service.id"
                [attr.data-testid]="'workflow-row-' + service.id + '-' + pIdx"
                [attr.data-expanded]="isRowExpanded(service.id, pIdx)"
                [attr.data-active]="isDefaultPath(service, pIdx)"
                (click)="toggleRowExpanded(service.id, pIdx)"
              >
                <div class="flex items-stretch">
                  @for (envId of path; track envId + ':' + $index; let idx = $index) {
                    <div class="flex items-stretch">
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

                      @if (idx < path.length - 1) {
                        <!-- data-arrow-source + data-arrow-target carry the
                             source / target stage-box testids so
                             recomputeConnectorTops() can anchor the line
                             between BOX rects (NFR-09 (b)). Anchoring on
                             the leaf-pair WRAPPER would leave the line
                             short by env-tag width + grid gap on the
                             source side AND by the leaf-pair reserved-but-
                             empty space on the right (Detailed view has
                             --leaf-width 200 px but the inner stage-box is
                             only w-40 = 160 px). -->
                        <div
                          class="arrow-gap"
                          [attr.data-arrow-source]="'stage-box-' + service.id + '-' + envId"
                          [attr.data-arrow-target]="'stage-box-' + service.id + '-' + path[idx + 1]"
                        >
                          <div class="arrow-line"></div>
                        </div>
                      }
                    </div>
                  }

                  @if (isDefaultPath(service, pIdx) && pathsFor(service).length > 1) {
                    <div class="flex items-center pl-3">
                      <span class="default-tag" data-testid="workflow-default-tag">default</span>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }

      @if (store.filteredServices().length === 0) {
        <div class="text-center py-16 text-gray-400" data-testid="empty-state">
          <p class="text-lg font-medium">No services match your filters</p>
        </div>
      }
    </main>
  `
})
export class WorkflowRowsLayoutComponent {
  readonly store = inject(DeploymentMatrixStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly openSlot = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  @ViewChild('root', { static: true }) private rootEl!: ElementRef<HTMLElement>;

  private resizeObserver: ResizeObserver | null = null;
  private resizeHandler = () => this.scheduleRecompute();

  /**
   * Per-row expansion state keyed by `serviceId|pathIndex`. Independent of
   * the service-level "show all paths" toggle: clicking a single workflow
   * row emphasises that row without changing which paths are visible.
   * Exposed via `data-expanded` on each row (e2e contract).
   */
  private readonly expandedRowKeys = signal<ReadonlySet<string>>(new Set());

  /** Per SAD §"Visual layout" 12-cell rule (Workflow-rows). */
  readonly showServiceMeta = computed(() =>
    this.store.view() === 'detailed' && this.store.layout() === 'workflow-rows'
  );

  /** True when every multi-path service is currently expanded. */
  readonly allExpanded = computed(() => {
    const services = this.store.services();
    for (const s of services) {
      if (this.pathsFor(s).length < 2) continue;
      if (!this.store.expandedWorkflowServices().has(s.id)) return false;
    }
    return true;
  });

  /** True when at least one service is currently Focus-expanded. */
  readonly hasExpanded = computed(() => this.store.expandedServices().size > 0);

  /** Number of services with the pin set — surfaced in the Focus toolbar. */
  readonly pinnedCount = computed(() => this.store.pinnedServices().size);

  /**
   * Focus-view expansion check (drill-into-Detailed-size). Distinct from
   * the workflow-rows-only path expansion (`isExpanded`) which controls
   * "show all paths" vs "default path only".
   */
  isFocusExpanded(serviceId: string): boolean {
    return this.store.expandedServices().has(serviceId);
  }

  /** Per-service pin check (Focus view; layout-agnostic state). */
  isPinned(serviceId: string): boolean {
    return this.store.pinnedServices().has(serviceId);
  }

  /**
   * Service-block testid — Focus view uses the layout-agnostic
   * `row-expanded-{id}` / `row-collapsed-{id}`; other views keep the
   * existing `workflow-rows-{id}` shape.
   */
  serviceBlockTestid(service: ServiceDescriptor): string {
    if (this.store.view() === 'focus') {
      return (this.isFocusExpanded(service.id) ? 'row-expanded-' : 'row-collapsed-') + service.id;
    }
    return 'workflow-rows-' + service.id;
  }

  /**
   * Inline style for the .svc-block. When (view=focus AND focus-expanded)
   * override --leaf-width so every .wf-row stack member grows in lock-step.
   * Mirrors mockup lines 2427-2428.
   *
   * NFR-09 (b) is preserved because the existing `recomputeConnectorTops`
   * runs on every render and re-measures the BOX rects after the leaf
   * width flip lands.
   */
  serviceBlockStyle(serviceId: string): string {
    if (this.store.view() === 'focus' && this.isFocusExpanded(serviceId)) {
      return '--leaf-width-expanded: 200px; --leaf-width: var(--leaf-width-expanded);';
    }
    return '--leaf-width-expanded: 200px;';
  }

  /**
   * Leaf view-override for the LayoutLeafComponent. In Focus + expanded
   * the leaf renders as Detailed (full-fidelity); collapsed Focus uses
   * the Compact / Focus-collapsed branch.
   */
  leafViewOverride(serviceId: string): ViewId | null {
    if (this.store.view() === 'focus') {
      return this.isFocusExpanded(serviceId) ? 'detailed' : 'compact';
    }
    return null;
  }

  /** Force all attributes when the service is Focus-expanded. */
  forceAllAttrsFor(serviceId: string): boolean {
    return this.store.view() === 'focus' && this.isFocusExpanded(serviceId);
  }

  constructor() {
    // NFR-09 (c) re-measurement: `afterEveryRender` runs after every Angular
    // render cycle, AFTER @for children mount. The connector geometry needs
    // post-render DOM measurements; the previous `effect()` -> queueMicrotask
    // -> rAF chain raced the @for child mount on cold paint.
    //
    // The ResizeObserver + window-resize listener cover non-Angular triggers:
    // drawer transition, window resize, fonts loading.
    afterEveryRender({
      // Pure DOM mutation (writes CSS custom properties); no signal writes.
      write: () => this.recomputeConnectorTops()
    });
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

  pathsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    return rootToLeafPaths(
      this.store.topologyFor(service.id),
      service,
      this.store.environments(),
      this.store.matrix()
    );
  }

  visiblePathsFor(service: ServiceDescriptor): readonly (readonly string[])[] {
    const paths = this.pathsFor(service);
    if (paths.length === 0) return [];
    if (this.store.expandedWorkflowServices().has(service.id)) return paths;
    return [paths[this.defaultIdx(service)]];
  }

  isDefaultPath(service: ServiceDescriptor, pIdx: number): boolean {
    return pIdx === this.defaultIdx(service);
  }

  private defaultIdx(service: ServiceDescriptor): number {
    return defaultPathIndex(this.pathsFor(service), service, this.store.matrix());
  }

  pathKey(serviceId: string, path: readonly string[]): string {
    return serviceId + '|' + path.join('>');
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

  isExpanded(serviceId: string): boolean {
    return this.store.expandedWorkflowServices().has(serviceId);
  }

  toggleAllExpanded(): void {
    const allOn = this.allExpanded();
    const multi = this.store
      .services()
      .filter(s => this.pathsFor(s).length > 1)
      .map(s => s.id);
    this.store.toggleAllWorkflowExpand(multi, allOn);
  }

  /**
   * True if the given workflow row is in its per-row "expanded" state.
   * Independent of the service-level `expandedWorkflowServices` set:
   * clicking a single row toggles only that row's visual emphasis. Exposed
   * via `data-expanded` for the e2e contract
   * (`workflow-rows-expand-row.spec.ts`).
   */
  isRowExpanded(serviceId: string, pathIdx: number): boolean {
    return this.expandedRowKeys().has(this.rowKey(serviceId, pathIdx));
  }

  toggleRowExpanded(serviceId: string, pathIdx: number): void {
    const key = this.rowKey(serviceId, pathIdx);
    const next = new Set(this.expandedRowKeys());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.expandedRowKeys.set(next);
  }

  private rowKey(serviceId: string, pathIdx: number): string {
    return `${serviceId}|${pathIdx}`;
  }

  // ----- connector geometry (NFR-09) ---------------------------------------

  private scheduled = false;
  private scheduleRecompute(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => requestAnimationFrame(() => {
      this.scheduled = false;
      this.recomputeConnectorTops();
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

  /**
   * Walk every `.arrow-gap[data-arrow-target]`, look up the source AND
   * target stage boxes, and write three CSS custom properties:
   *   --target-half       — half the target's height (px, rounded). The
   *                          arrow-line uses this as margin-top so its y
   *                          centres on the target box.
   *   --source-offset     — signed left margin applied to the arrow-line
   *                          so its LEFT edge sits flush with the source
   *                          box's right edge. The leaf-pair grid reserves
   *                          `--leaf-width` (200 px for Detailed) but the
   *                          inner box is only `w-40` (160 px), so the
   *                          source box's right edge is to the LEFT of the
   *                          arrow-gap's left edge by up to 40 px —
   *                          negative `--source-offset` slides the line
   *                          back to start at the box (NFR-09 (b)).
   *   --target-line-width — distance from source.right to target.left
   *                          minus the 6 px arrowhead protrusion, so
   *                          `line.right + 6 == target.left` by construction.
   *
   * Both anchors come from the BOX rects (the inner `.stage-box`, `.pill`,
   * or `.pill-empty` carrying the `stage-box-...` testid), never the
   * leaf-pair wrapper — anchoring on the wrapper is what caused the
   * "connector lines hanging in mid-air" bug.
   */
  private recomputeConnectorTops(): void {
    const root = this.rootEl?.nativeElement;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>('[data-service-row]');
    if (rows.length === 0) {
      // @for children haven't materialised yet — next render will retry.
      return;
    }
    rows.forEach(row => {
      row.querySelectorAll<HTMLElement>('[data-arrow-target]').forEach(col => {
        const targetTestid = col.getAttribute('data-arrow-target');
        const sourceTestid = col.getAttribute('data-arrow-source');
        const target = targetTestid
          ? row.querySelector<HTMLElement>(`[data-testid="${targetTestid}"]`)
          : null;
        const source = sourceTestid
          ? row.querySelector<HTMLElement>(`[data-testid="${sourceTestid}"]`)
          : null;
        if (!target) {
          col.style.setProperty('--target-half', '0px');
          col.style.setProperty('--target-line-width', '0px');
          col.style.setProperty('--source-offset', '0px');
          return;
        }
        const h = Math.round(target.offsetHeight / 2);
        col.style.setProperty('--target-half', `${h}px`);
        const colRect = col.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        // Source-side anchor — the box's right edge. Falls back to the
        // gap's left edge when the source testid is missing or the source
        // box hasn't materialised yet, which degrades to the legacy
        // wrapper-anchored geometry rather than breaking the layout.
        const sourceRight = source
          ? source.getBoundingClientRect().right
          : colRect.left;
        const sourceOffset = sourceRight - colRect.left;
        col.style.setProperty('--source-offset', `${sourceOffset}px`);
        const lineWidth = Math.max(0, targetRect.left - sourceRight - 6);
        col.style.setProperty('--target-line-width', `${lineWidth}px`);
      });
    });
    // Re-attach observer so new rows (filter / topology change) are watched.
    this.attachObserver();
  }
}
