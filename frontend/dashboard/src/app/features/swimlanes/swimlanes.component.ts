import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Subject } from 'rxjs';
import { NgxGraphModule, Node as NgxNode, Edge as NgxEdge, NgxGraphStates } from '@swimlane/ngx-graph';

import { AppStateService } from '../../core/services/app-state.service';
import {
  CorrelationPredicate,
  DeploymentEvent,
  MatrixSlot,
  SwimlaneField,
  TIME_WINDOWS,
  TimeWindow,
  isContextStatus,
} from '../../core/models/deployment.model';
import { CardDims, VisCardComponent } from './vis-card/vis-card.component';
import { InspectorPanelComponent } from './inspector-panel/inspector-panel.component';

/** Time-window string → milliseconds. */
const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '5 min':  5 * 60_000,
  '1 hr':   60 * 60_000,
  '1 day':  24 * 60 * 60_000,
  '7 days': 7 * 24 * 60 * 60_000,
};

/**
 * dagre layout settings handed verbatim to ngx-graph. We do NOT compute any
 * positions/sizes ourselves — ngx-graph + dagre own layout and edge routing.
 *   - orientation LR  → left-to-right rank flow.
 *   - align 'UL'      → nodes align to the upper-left of their rank, so roots
 *                       and same-rank cards line up by their left edge instead
 *                       of being centre-justified (ragged) within the column.
 */
const DAGRE_SETTINGS = {
  orientation: 'LR',
  align: 'UL',
  rankPadding: 60,
  nodePadding: 12,
  edgePadding: 8,
  multigraph: true,
  // Pin the layout to the (0,0) origin so the content has no leading offset;
  // the view is then exactly the content size (see GRAPH_DIMS_PAD below).
  marginX: 0,
  marginY: 0,
};

/**
 * ngx-graph pads its reported `graphDims` by 100px on EVERY side (for minimap /
 * zoom room) — see GraphComponent.updateGraphDims. `graphDims` is therefore
 * `content + 200` in each axis, not the drawable size. We strip that padding to
 * recover the true content box and use it as the [view].
 */
const GRAPH_DIMS_PAD = 100;

/** Seed size for a node before its card has been measured (avoids 0×0 layout). */
const SEED_DIMS = { width: 200, height: 70 };

/**
 * Measured card sizes, keyed by node id, persisted for the whole app session
 * (module scope — survives view switches, so returning to Swimlanes seeds nodes
 * at their real size and the first layout is already correct → no re-measure
 * churn). Cleared only on a full page reload.
 */
const DIM_CACHE = new Map<string, { width: number; height: number }>();

/**
 * One independent deployment chain (connected component) within a service.
 * Each renders as its own ngx-graph so disconnected chains are laid out
 * independently and every chain's root sits flush at the left (the mockup's
 * per-DAG model) — instead of dagre centre-justifying unrelated roots.
 */
export interface SwimDag {
  id: string;
  nodes: NgxNode[];
  links: NgxEdge[];
}

export interface SwimLane {
  service: string;
  dags: SwimDag[];
  /** Node ids in the newest-event vector (root→tip chain). */
  vectorIds: Set<string>;
  /** Node id of the vector tip (newest event in the service). */
  tipId: string | null;
}

/**
 * SwimlanesComponent — per-service DAG visualisation shell (Phase 3).
 *
 * Pure presentation component. Data arrives via AppStateService.matrixData
 * which is loaded once and kept live by the root App component.
 * No HTTP calls here — the App shell owns the matrix load + SSE stream.
 *
 * Events are extracted from each matrix slot's `current` field only —
 * `last_successful` drives box-state in the matrix view and is not a swimlane
 * node. The DAG is derived client-side via the correlation predicate.
 *
 * Spec: docs/design/views.md §Swimlanes View Layout
 */
@Component({
  selector: 'app-swimlanes',
  standalone: true,
  imports: [NgxGraphModule, VisCardComponent, InspectorPanelComponent],
  templateUrl: './swimlanes.component.html',
  styleUrl: './swimlanes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwimlanesComponent {
  protected readonly state = inject(AppStateService);
  private   readonly host  = inject(ElementRef<HTMLElement>);

  protected readonly dagreSettings = DAGRE_SETTINGS;
  protected readonly timeWindows   = TIME_WINDOWS;

  // ── Update trigger for ngx-graph relayout ─────────────────
  private  readonly _update$ = new Subject<void>();
  readonly updateTrigger$    = this._update$.asObservable();

  /**
   * Set of card node ids that are currently flashing (change-emphasis).
   * Each id is added on SSE update, removed after 600 ms by a cleanup timeout.
   */
  protected readonly flashingIds = signal<Set<string>>(new Set());

  /**
   * Per-DAG content size as reported by ngx-graph's own `graphDims` after each
   * layout (keyed by dag id). Drives each graph's `[view]`. We read ngx-graph's
   * output here — we never compute graph geometry ourselves.
   */
  private readonly dagContent = signal<Map<string, { width: number; height: number }>>(new Map());

  /**
   * Uniform stage width = the widest laid-out chain across ALL lanes (mockup
   * parity: one shared stage, narrower chains get uniform right-hand whitespace
   * rather than ragged widths). Height stays per-chain.
   */
  protected readonly stageW = computed<number>(() => {
    const sizes = [...this.dagContent().values()];
    return sizes.length ? Math.max(...sizes.map((s) => s.width)) : SEED_DIMS.width;
  });

  constructor() {
    // Relayout whenever the rendered lane set changes (matrix update / view switch / collapse toggle).
    effect(() => {
      this.lanesView(); // track
      queueMicrotask(() => this._update$.next());
    });

    // Evict stale dagContent entries whenever collapse state changes (#309).
    //
    // Problem: dagContent caches per-dag {width, height} measured by ngx-graph
    // after layout. When a lane is collapsed, ngx-graph measures only the vector
    // nodes → small height stored. When the lane is expanded, viewFor() still
    // returns the old cached height, constraining the SVG viewport so the extra
    // nodes are invisible. Fix: on every collapsedLanes change, drop dagContent
    // entries for ALL dags so ngx-graph re-measures at the new node set.
    //
    // Use untracked() for the dagContent write to avoid triggering stageW
    // (which reads dagContent) as a dependency of this effect.
    effect(() => {
      this.state.collapsedLanes(); // track collapse state changes
      const allLanes = untracked(() => this.lanes());
      if (!allLanes.length) return;
      untracked(() => {
        // Drop all cached heights; ngx-graph will re-report them via onStateChange.
        this.dagContent.set(new Map());
      });
    });

    // Default new lanes to collapsed when matrix data loads (#309).
    // initDefaultCollapsed is idempotent: it only acts on services not yet in
    // the persisted "known" set, so expand/collapse choices are never overridden.
    effect(() => {
      const lanes = this.lanes();
      if (lanes.length > 0) {
        this.state.initDefaultCollapsed(lanes.map(l => l.service));
      }
    });

    /**
     * Live change emphasis + auto-scroll (#309).
     *
     * Reacts to `lastEffectiveEvent` — set only by `applyDeploymentEvent` for
     * non-context statuses (success / in-progress / failure). Context-only events
     * (pending / queued / waiting / cancelled / rejected) do NOT update this
     * signal, so they cannot trigger flash or scroll here. This is the structural
     * guard: the filter lives in AppStateService, not in a template check.
     *
     * `onSseChange` reads several reactive signals (lanesView, collapsedLanes,
     * autoScrollOnChange) and writes `flashingIds` via `flashCard`.  Without
     * `untracked`, every signal read inside `onSseChange` becomes a dependency
     * of THIS effect.  The write to `flashingIds` (a new Set object each call)
     * then dirtifies the effect immediately, causing an infinite re-run loop
     * that OOMs the V8 heap.  `untracked` constrains the effect's dependency
     * set to `lastEffectiveEvent` only — the correct semantic.
     */
    effect(() => {
      const ev = this.state.lastEffectiveEvent();
      if (ev) untracked(() => this.onSseChange(ev.service));
    });
  }

  // ── Collapsed lane helpers (#309) ────────────────────────
  protected isCollapsed(service: string): boolean {
    return this.state.collapsedLanes().has(service);
  }

  protected toggleCollapsed(service: string): void {
    this.state.toggleLaneCollapsed(service);
  }

  protected readonly autoScrollOnChange = computed(() => this.state.autoScrollOnChange());

  /**
   * For each lane, produce DAGs restricted to the vector chain when collapsed,
   * or the full DAG set when expanded. This is the rendered lane set.
   */
  protected readonly lanesView = computed<SwimLane[]>(() => {
    const lanes    = this.lanes();
    const collapsed = this.state.collapsedLanes();
    if (!collapsed.size) return lanes;

    return lanes.map(lane => {
      if (!collapsed.has(lane.service)) return lane;
      // Collapsed: restrict each DAG to only the vector chain nodes.
      const vids = lane.vectorIds;
      const collapsedDags = lane.dags
        .map(dag => ({
          ...dag,
          nodes: dag.nodes.filter(n => vids.has(n.id)),
          links: dag.links.filter(l => vids.has(l.source) && vids.has(l.target)),
        }))
        .filter(dag => dag.nodes.length > 0);
      return { ...lane, dags: collapsedDags };
    });
  });

  /** ngx-graph [view] for a chain: uniform stage width × that chain's own height. */
  protected viewFor(dagId: string): [number, number] {
    const h = this.dagContent().get(dagId)?.height ?? SEED_DIMS.height;
    return [this.stageW(), h];
  }

  /**
   * A card reported its real rendered size. Update the cache + the live node's
   * dimension and ask ngx-graph to relayout. Fires on first paint and on every
   * later change (e.g. an SSE event mutating the card) via the same observer.
   */
  protected onCardDims(d: CardDims): void {
    const prev = DIM_CACHE.get(d.id);
    if (prev && prev.width === d.width && prev.height === d.height) return;
    DIM_CACHE.set(d.id, { width: d.width, height: d.height });

    // Patch the live node object in place so dagre sees the true size; mutating
    // here (not in the computed) avoids a measure→recompute→measure loop.
    // Search the full lane set (not lanesView) so collapsed vector cards still
    // update their dimensions for when the lane is expanded.
    outer:
    for (const lane of this.lanes()) {
      for (const dag of lane.dags) {
        const node = dag.nodes.find((n) => n.id === d.id);
        if (node) { node.dimension = { width: d.width, height: d.height }; break outer; }
      }
    }
    this._update$.next();
  }

  // ── Flash + auto-scroll (SSE live change, #309) ───────────

  /**
   * Called when an SSE event arrives for a given service+environment.
   * Flashes the relevant card and scrolls the lane into view if off-screen.
   *
   * The parent app shell calls this method after `applyDeploymentEvent`
   * so the matrix is already updated before we derive the tip.
   */
  onSseChange(service: string): void {
    const lane = this.lanesView().find(l => l.service === service);
    if (!lane) return;

    // The card to flash: tip card when collapsed, the same tip node in expanded form.
    // `tipId` is always the newest-event node, valid in both states.
    const flashId = lane.tipId;
    if (flashId) this.flashCard(flashId);

    // Auto-scroll: bring the lane into view if it is off-screen.
    if (this.state.autoScrollOnChange()) {
      this.scrollLaneIntoView(service);
    }
  }

  /**
   * Add `flashId` to the flashing set for 1200 ms, then remove it.
   * The template binds `.is-flashing` on cards whose id is in this set.
   *
   * We defer adding the id by two rAF ticks so the DOM node re-rendered
   * by ngx-graph (following the matrixData update that triggered this call)
   * has committed to the layout before the CSS animation starts.  Without
   * this deferral the animation is applied to the OLD element just before
   * it is torn down, or to the NEW element at tick-0 before the browser
   * has painted it — both cases cause the flash to be invisible in practice.
   */
  private flashCard(nodeId: string): void {
    // First rAF: ngx-graph relayout scheduled; second rAF: paint committed.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const s = new Set(this.flashingIds());
        s.add(nodeId);
        this.flashingIds.set(s);
        setTimeout(() => {
          const next = new Set(this.flashingIds());
          next.delete(nodeId);
          this.flashingIds.set(next);
        }, 1200);
      });
    });
  }

  /**
   * Scroll the lane element for `service` into view if it is outside the
   * visible viewport. Uses `data-swim-service` attributes set in the template.
   */
  private scrollLaneIntoView(service: string): void {
    // CSS.escape is unavailable in jsdom (vitest); service names are safe
    // API identifiers so a plain attribute selector is fine as a fallback.
    const escaped = typeof CSS !== 'undefined' ? CSS.escape(service) : service;
    const el = this.host.nativeElement.querySelector(
      `[data-swim-service="${escaped}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!inView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * ngx-graph finished a layout — record its computed content size for this chain.
   *
   * Bound to `(stateChange)` (not `drawComplete`): `drawComplete` is a one-shot
   * event that fires only on the first successful `hasDims()` poll; it does NOT
   * fire on subsequent re-layouts triggered by `update$` or `ngOnChanges`.
   * `stateChange` with `NgxGraphStates.Output` fires after every layout cycle
   * (via `finalizeTickOutput`), so it is the correct hook for keeping `dagContent`
   * in sync after card-dimension changes (e.g. field-visibility toggles).
   */
  protected onStateChange(
    dagId: string,
    event: { state: NgxGraphStates },
    graph: { graphDims?: { width: number; height: number } },
  ): void {
    if (event.state !== NgxGraphStates.Output) return;
    const g = graph.graphDims;
    if (!g || !g.width || !g.height) return;
    // Strip ngx-graph's 100px-per-side minimap padding to get the true content box.
    const width  = Math.max(1, Math.round(g.width  - 2 * GRAPH_DIMS_PAD));
    const height = Math.max(1, Math.round(g.height - 2 * GRAPH_DIMS_PAD));
    const cur = this.dagContent().get(dagId);
    if (cur && cur.width === width && cur.height === height) return;
    const next = new Map(this.dagContent());
    next.set(dagId, { width, height });
    this.dagContent.set(next);
  }

  /**
   * Map from `current.id` → `slot.next` for all slots that have a next event.
   * Used to pass the context-status badge data to vis-card nodes.
   */
  protected readonly nextByEventId = computed<Map<string, DeploymentEvent>>(() => {
    const matrix = this.state.matrixData();
    const map = new Map<string, DeploymentEvent>();
    if (!matrix) return map;
    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots) as MatrixSlot[]) {
        if (slot.next) map.set(slot.current.id, slot.next);
      }
    }
    return map;
  });

  /**
   * Set of event IDs whose slot is never-deployed: `current` is a context
   * status with NO `last_successful` (first-ever gated deploy, no baseline).
   * Passed to VisCardComponent so it can render neutral + chip instead of a
   * coloured card. Cannot be derived from the event alone in the vis-card
   * because `last_successful` is not part of the node event.
   */
  protected readonly neverDeployedIds = computed<Set<string>>(() => {
    const matrix = this.state.matrixData();
    const ids = new Set<string>();
    if (!matrix) return ids;
    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots) as MatrixSlot[]) {
        if (isContextStatus(slot.current.status) && !slot.last_successful) {
          ids.add(slot.current.id);
        }
      }
    }
    return ids;
  });

  // ── Events extracted from shared matrix snapshot ──────────
  private readonly eventsFromMatrix = computed<Map<string, DeploymentEvent[]>>(() => {
    const matrix = this.state.matrixData();
    const byService = new Map<string, DeploymentEvent[]>();
    if (!matrix) return byService;

    for (const row of matrix.rows) {
      const events: DeploymentEvent[] = [];
      const seen = new Set<string>();

      for (const slot of Object.values(row.slots) as MatrixSlot[]) {
        // Only `current` events become swimlane nodes.
        // `last_successful` drives box-state in the matrix view only —
        // it belongs to a different run so its parent_deployments would
        // reference events not present in the matrix, producing orphan nodes.
        if (!seen.has(slot.current.id)) {
          seen.add(slot.current.id);
          events.push(slot.current);
        }
      }

      if (events.length) byService.set(row.service, events);
    }

    return byService;
  });

  // ── Swimlane lanes ────────────────────────────────────────
  protected readonly lanes = computed<SwimLane[]>(() => {
    const byService = this.eventsFromMatrix();
    if (!byService.size) return [];

    const predicate = this.state.correlationPredicate();
    const tw        = this.state.timeWindow();
    const fields    = this.state.swimlaneVisibleFields();
    const svcHidden = this.state.matrixSvcHidden();

    // Filter out hidden services before building lanes.
    const visibleByService = new Map(
      [...byService.entries()].filter(([svc]) => !svcHidden.has(svc)),
    );
    if (!visibleByService.size) return [];

    return this.buildLanes(visibleByService, predicate, tw, fields);
  });

  // ── Lane building ─────────────────────────────────────────

  private buildLanes(
    byService: Map<string, DeploymentEvent[]>,
    predicate: CorrelationPredicate,
    timeWindow: TimeWindow,
    fields: Set<SwimlaneField>,
  ): SwimLane[] {
    const twMs = TIME_WINDOW_MS[timeWindow];
    // `fields` is intentionally unused for layout: card content (and therefore
    // size) is driven by the template; ngx-graph measures it via the card's
    // ResizeObserver. No field-based width/height math here.
    void fields;

    return [...byService.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, svcEvents]) => {
        const nodes: NgxNode[] = svcEvents.map((ev) => ({
          id:        ev.id,
          label:     ev.version ?? ev.environment,
          data:      ev,
          // Seed from last measured size (or a neutral default). ngx-graph
          // overwrites this with the real card size on measure / relayout.
          dimension: { ...(DIM_CACHE.get(ev.id) ?? SEED_DIMS) },
        }));

        const depIdToNodeId = new Map<string, string>(
          svcEvents.map((ev) => [ev.deployment_id, ev.id]),
        );
        const nodeById = new Map<string, DeploymentEvent>(
          svcEvents.map((ev) => [ev.id, ev]),
        );

        const links = this.buildEdges(svcEvents, predicate, twMs, depIdToNodeId, nodeById);
        const dags  = this.partitionDags(service, nodes, links);

        // Build the collapsed vector: newest-event chain (#309).
        // Pass `links` so the vector uses the same parent graph as the edges,
        // regardless of which correlation predicate is active.
        const { vectorIds, tipId } = this.buildCollapsedVector(svcEvents, nodeById, links);

        return { service, dags, vectorIds, tipId };
      });
  }

  /**
   * Compute the collapsed vector for a service lane (#309).
   *
   * Algorithm (spec: docs/design/views.md §Collapse / Expand):
   *   1. tip = node with the latest `happened_at`.
   *   2. Walk backward through the edge graph (links are source→target = parent→child;
   *      reverse to target→[sources] for the backward walk). At a merge (multiple
   *      incoming edges) follow the source with the newest `happened_at`.
   *   3. Collect every node id in the chain (root→tip).
   *
   * Uses `links` (already built by buildEdges) instead of raw `parent_deployments`
   * so the vector always uses the same connectivity as the rendered edges, regardless
   * of which correlation predicate is active.
   *
   * Returns the set of node ids in the chain plus the tip's id.
   */
  private buildCollapsedVector(
    events:  DeploymentEvent[],
    nodeById: Map<string, DeploymentEvent>,
    links:   NgxEdge[],
  ): { vectorIds: Set<string>; tipId: string | null } {
    if (!events.length) return { vectorIds: new Set(), tipId: null };

    // 1. Find tip: node with the latest happened_at.
    const tip = events.reduce((best, ev) =>
      new Date(ev.happened_at) > new Date(best.happened_at) ? ev : best,
    );
    const tipId = tip.id;

    // 2. Build reverse adjacency: child-id → [parent-ids] from the edge list.
    //    Links are directed source→target (parent→child) so reversing gives us
    //    parent lookups without touching parent_deployments at all.
    const parents = new Map<string, string[]>();
    for (const link of links) {
      const existing = parents.get(link.target);
      if (existing) {
        existing.push(link.source);
      } else {
        parents.set(link.target, [link.source]);
      }
    }

    // 3. Walk backward from tip, choosing the newest parent at each merge.
    const chain = new Set<string>();
    let curId: string | undefined = tipId;
    const visited = new Set<string>();
    while (curId && !visited.has(curId)) {
      visited.add(curId);
      chain.add(curId);
      const parentIds: string[] = parents.get(curId) ?? [];
      if (!parentIds.length) break;
      // At a merge follow the parent with the newest happened_at.
      curId = parentIds.reduce((bestId: string, pid: string) => {
        const best = nodeById.get(bestId);
        const p    = nodeById.get(pid);
        if (!best || !p) return bestId;
        return new Date(p.happened_at) > new Date(best.happened_at) ? pid : bestId;
      });
    }

    return { vectorIds: chain, tipId };
  }

  /**
   * Split a service's nodes into connected components (independent deployment
   * chains) using the correlation edges as undirected connectivity. Each
   * component becomes its own ngx-graph so unrelated chains lay out
   * independently and their roots align flush-left.
   */
  private partitionDags(service: string, nodes: NgxNode[], links: NgxEdge[]): SwimDag[] {
    const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of links) {
      adj.get(e.source)?.add(e.target);
      adj.get(e.target)?.add(e.source);
    }

    const seen = new Set<string>();
    const dags: SwimDag[] = [];
    let idx = 0;
    for (const start of nodes) {
      if (seen.has(start.id)) continue;
      // BFS over undirected adjacency to collect one component.
      const compIds = new Set<string>();
      const queue = [start.id];
      seen.add(start.id);
      while (queue.length) {
        const cur = queue.shift()!;
        compIds.add(cur);
        for (const nb of adj.get(cur) ?? []) {
          if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
        }
      }
      const compNodes = nodes.filter((n) => compIds.has(n.id));
      const compLinks = links.filter((l) => compIds.has(l.source) && compIds.has(l.target));
      dags.push({ id: `${service}#${idx++}`, nodes: compNodes, links: compLinks });
    }
    return dags;
  }

  private buildEdges(
    events: DeploymentEvent[],
    predicate: CorrelationPredicate,
    twMs: number,
    depIdToNodeId: Map<string, string>,
    nodeById: Map<string, DeploymentEvent>,
  ): NgxEdge[] {
    if (predicate === 'explicit parent') {
      const edges: NgxEdge[] = [];
      for (const ev of events) {
        for (const pid of (ev.parent_deployments ?? [])) {
          const sourceId = depIdToNodeId.get(pid);
          if (!sourceId) continue;
          edges.push({
            id: `${sourceId}--${ev.id}`,
            source: sourceId,
            target: ev.id,
            data: { status: nodeById.get(sourceId)?.status ?? 'success' },
          });
        }
      }
      return edges;
    }

    const fieldMap: Partial<Record<CorrelationPredicate, keyof DeploymentEvent>> = {
      'same sha': 'sha', 'same run_number': 'run_number',
      'same actor': 'actor', 'same version': 'version', 'same ref': 'ref',
    };
    const field = fieldMap[predicate];
    if (!field) return [];

    const sorted = [...events].sort(
      (a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime(),
    );

    const edges: NgxEdge[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];
      const nodeTime = new Date(node.happened_at).getTime();
      const val = node[field] as string | undefined;
      if (!val) continue;

      for (let j = i - 1; j >= 0; j--) {
        const pred = sorted[j];
        if (nodeTime - new Date(pred.happened_at).getTime() > twMs) break;
        if ((pred[field] as string | undefined) === val) {
          edges.push({ id: `${pred.id}--${node.id}`, source: pred.id, target: node.id, data: { status: pred.status } });
          break;
        }
      }
    }
    return edges;
  }

  protected getEdgeColor(status: string | undefined): string {
    if (status === 'success')     return 'var(--emerald)';
    if (status === 'in-progress') return 'var(--amber)';
    return 'var(--coral)';
  }

  protected onNodeSelect(ev: DeploymentEvent): void {
    this.state.selectedNodeId.set(ev.id);
    this.state.selectedEvent.set(ev);
  }
}
