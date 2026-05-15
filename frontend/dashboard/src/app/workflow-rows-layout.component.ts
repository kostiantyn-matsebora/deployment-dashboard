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
  type SlotState
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
        <section
          class="svc-block"
          [attr.data-service]="service.id"
          [attr.data-testid]="'workflow-rows-' + service.id"
        >
          <!-- Meta column. -->
          <div class="svc-block-meta">
            <div class="svc-block-meta-row">
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
              <p
                class="text-sm font-semibold text-gray-800 truncate"
                [attr.data-testid]="'service-name-' + service.id"
                [title]="service.name"
              >{{ service.name }}</p>
              <span class="text-[10px] text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-1.5 leading-tight ml-1">
                {{ pathsFor(service).length }} wf{{ pathsFor(service).length === 1 ? '' : 's' }}
              </span>
            </div>
            @if (showServiceMeta()) {
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
