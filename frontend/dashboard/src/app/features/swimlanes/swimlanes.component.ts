import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Subject } from 'rxjs';
import { NgxGraphModule, Node as NgxNode, Edge as NgxEdge } from '@swimlane/ngx-graph';

import { AppStateService } from '../../core/services/app-state.service';
import {
  CorrelationPredicate,
  DeploymentEvent,
  MatrixSlot,
  SwimlaneField,
  TIME_WINDOWS,
  TimeWindow,
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
}

/**
 * SwimlanesComponent — per-service DAG visualisation shell (Phase 3).
 *
 * Pure presentation component. Data arrives via AppStateService.matrixData
 * which is loaded once and kept live by the root App component.
 * No HTTP calls here — the App shell owns the matrix load + SSE stream.
 *
 * Events are extracted from each matrix slot's `current` + `last_successful`
 * fields; the DAG is derived client-side via the correlation predicate.
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

  protected readonly dagreSettings = DAGRE_SETTINGS;
  protected readonly timeWindows   = TIME_WINDOWS;

  // ── Update trigger for ngx-graph relayout ─────────────────
  private  readonly _update$ = new Subject<void>();
  readonly updateTrigger$    = this._update$.asObservable();

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
    // Relayout whenever the lane set changes (matrix update / view switch).
    effect(() => {
      this.lanes(); // track
      queueMicrotask(() => this._update$.next());
    });
  }

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
    outer:
    for (const lane of this.lanes()) {
      for (const dag of lane.dags) {
        const node = dag.nodes.find((n) => n.id === d.id);
        if (node) { node.dimension = { width: d.width, height: d.height }; break outer; }
      }
    }
    this._update$.next();
  }

  /** ngx-graph finished a layout — record its computed content size for this chain. */
  protected onDraw(dagId: string, graph: { graphDims?: { width: number; height: number } }): void {
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

  // ── Events extracted from shared matrix snapshot ──────────
  private readonly eventsFromMatrix = computed<Map<string, DeploymentEvent[]>>(() => {
    const matrix = this.state.matrixData();
    const byService = new Map<string, DeploymentEvent[]>();
    if (!matrix) return byService;

    for (const row of matrix.rows) {
      const events: DeploymentEvent[] = [];
      const seen = new Set<string>();

      for (const slot of Object.values(row.slots) as MatrixSlot[]) {
        if (!seen.has(slot.current.id)) {
          seen.add(slot.current.id);
          events.push(slot.current);
        }
        if (slot.last_successful && !seen.has(slot.last_successful.id)) {
          seen.add(slot.last_successful.id);
          events.push(slot.last_successful);
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

    return this.buildLanes(byService, predicate, tw, fields);
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
        const dags = this.partitionDags(service, nodes, links);
        return { service, dags };
      });
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
