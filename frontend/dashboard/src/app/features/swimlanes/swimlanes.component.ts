import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { NgxGraphModule, Node as NgxNode, Edge as NgxEdge } from '@swimlane/ngx-graph';

import { AppStateService } from '../../core/services/app-state.service';
import { DeploymentApiService } from '../../core/services/deployment-api.service';
import {
  CorrelationPredicate,
  DeploymentEvent,
  SwimlaneField,
  TIME_WINDOWS,
  TimeWindow,
} from '../../core/models/deployment.model';
import { VisCardComponent } from './vis-card/vis-card.component';
import { InspectorPanelComponent } from './inspector-panel/inspector-panel.component';

/** Time-window string → milliseconds. */
const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '5 min':  5 * 60_000,
  '1 hr':   60 * 60_000,
  '1 day':  24 * 60 * 60_000,
  '7 days': 7 * 24 * 60 * 60_000,
};

/** Fixed node width (px). Content that exceeds this scrolls horizontally within the card. */
const NODE_W = 200;

/** Dagre layout settings: left-to-right, time axis flows left. */
const DAGRE_SETTINGS = {
  orientation: 'LR',
  rankPadding: 60,
  nodePadding: 12,
  edgePadding: 8,
  multigraph: true,
};

/** One service swimlane — maps 1-to-1 to a <ngx-graph> instance. */
export interface SwimLane {
  service: string;
  nodes: NgxNode[];
  links: NgxEdge[];
  /** Estimated canvas height in px (used for [view]). */
  graphH: number;
}

/**
 * SwimlanesComponent — per-service DAG visualisation shell (Phase 3).
 *
 * Layout:
 *   `.vis-shell { display: grid; grid-template-columns: 1fr 320px; }` — canvas | inspector.
 *   One `<ngx-graph>` per service lane (dagre, orientation: LR).
 *   Inspector panel (320px) updated on node click.
 *
 * Data:
 *   GET /api/deployments (limit 500) on init + on each SSE event.
 *   Client-side DAG correlation via `correlationPredicate` + `timeWindow` signals.
 *
 * Spec: docs/design/views.md §Swimlanes View Layout
 *       docs/design/components.md §Swimlane Node Card + §Inspector Panel
 */
@Component({
  selector: 'app-swimlanes',
  standalone: true,
  imports: [NgxGraphModule, VisCardComponent, InspectorPanelComponent],
  templateUrl: './swimlanes.component.html',
  styleUrl: './swimlanes.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwimlanesComponent implements OnInit, OnDestroy {
  protected readonly state = inject(AppStateService);
  private  readonly api   = inject(DeploymentApiService);

  // ── Local state ───────────────────────────────────────────
  protected readonly loading   = signal<boolean>(true);
  protected readonly loadErr   = signal<boolean>(false);
  /** Raw event list fetched from API. */
  private   readonly allEvents = signal<DeploymentEvent[]>([]);

  // ── Layout constants exposed to template ──────────────────
  protected readonly NODE_W    = NODE_W;
  protected readonly dagreSettings = DAGRE_SETTINGS;
  protected readonly timeWindows   = TIME_WINDOWS;

  // ── Update trigger — fires when layout must recompute ──────
  private  readonly _updateSubject$ = new Subject<void>();
  readonly updateTrigger$ = this._updateSubject$.asObservable();

  // ── Subscriptions ─────────────────────────────────────────
  private subs: Subscription[] = [];

  // ── Derived: swimlane lanes ────────────────────────────────
  /**
   * Recomputes whenever events, correlationPredicate, timeWindow, or
   * swimlaneVisibleFields change. Each recompute emits on updateTrigger$
   * so ngx-graph re-runs dagre layout.
   */
  protected readonly lanes = computed<SwimLane[]>(() => {
    const events = this.allEvents();
    if (!events.length) return [];

    const predicate = this.state.correlationPredicate();
    const tw        = this.state.timeWindow();
    const fields    = this.state.swimlaneVisibleFields();

    return this.buildLanes(events, predicate, tw, fields);
  });

  // ── Lifecycle ─────────────────────────────────────────────
  constructor() {
    // Fire update$ whenever lanes recompute (fields/predicate/timeWindow changes).
    effect(() => {
      this.lanes(); // track
      queueMicrotask(() => this._updateSubject$.next());
    });
  }

  ngOnInit(): void {
    this.loadAll();
    this.connectSSE();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── Data loading ──────────────────────────────────────────
  private loadAll(): void {
    this.loading.set(true);
    this.loadErr.set(false);
    const sub = this.api.listDeployments({ limit: 500 }).subscribe({
      next: (page) => {
        this.allEvents.set(page.items);
        this.loading.set(false);
      },
      error: () => {
        this.loadErr.set(true);
        this.loading.set(false);
      },
    });
    this.subs.push(sub);
  }

  private connectSSE(): void {
    const sub = this.api.streamEvents().subscribe({
      next: () => {
        this.state.sseConnected.set(true);
        this.loadAll();
      },
      error: () => {
        this.state.sseConnected.set(false);
      },
    });
    this.subs.push(sub);
  }

  // ── Lane building ─────────────────────────────────────────

  private buildLanes(
    events: DeploymentEvent[],
    predicate: CorrelationPredicate,
    timeWindow: TimeWindow,
    fields: Set<SwimlaneField>,
  ): SwimLane[] {
    const twMs   = TIME_WINDOW_MS[timeWindow];
    const nodeH  = this.calcNodeHeight(fields);

    // Group events by service, preserving demo data's alpha ordering.
    const byService = new Map<string, DeploymentEvent[]>();
    for (const ev of events) {
      if (!byService.has(ev.service)) byService.set(ev.service, []);
      byService.get(ev.service)!.push(ev);
    }

    return [...byService.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, svcEvents]) => {
        // Build ngx-graph nodes — id = event UUID (unique per log row).
        const nodes: NgxNode[] = svcEvents.map((ev) => ({
          id:    ev.id,
          label: ev.version ?? ev.environment,
          data:  ev,
          dimension: { width: NODE_W, height: nodeH },
        }));

        // Map deployment_id → ngx-graph node id (for explicit parent resolution).
        const depIdToNodeId = new Map<string, string>();
        for (const ev of svcEvents) {
          depIdToNodeId.set(ev.deployment_id, ev.id);
        }

        // Build edge map for status lookups (source event by node id).
        const nodeById = new Map<string, DeploymentEvent>();
        for (const ev of svcEvents) {
          nodeById.set(ev.id, ev);
        }

        const links = this.buildEdges(
          svcEvents, predicate, twMs, depIdToNodeId, nodeById,
        );

        // Estimate lane height: max nodes per rank × (nodeH + nodePad) + margin.
        const rowsEst = Math.max(1, Math.ceil(svcEvents.length / 3));
        const graphH  = rowsEst * (nodeH + DAGRE_SETTINGS.nodePadding) + 60;

        return { service, nodes, links, graphH };
      });
  }

  /**
   * Compute node card height (px) from the active visible-field set.
   * Row 1 (version/time): 22px.  Row 2 (ref/run): 20px.  Row 3 (sha/env): 22px.
   * Outer padding: 20px.
   */
  private calcNodeHeight(fields: Set<SwimlaneField>): number {
    let h = 20; // top + bottom padding
    if (fields.has('version') || fields.has('happened_at')) h += 22;
    if (
      fields.has('ref') ||
      fields.has('run_url') ||
      fields.has('run_number') ||
      fields.has('actor')
    ) h += 20;
    h += 22; // sha + env row always present
    return Math.max(h, 64);
  }

  /**
   * Build ngx-graph edges for one service lane.
   *
   * `explicit parent` — use `parent_deployments` (deployment_id refs); intra-service only.
   * Other predicates  — sort events chronologically; for each event find the most recent
   *                     predecessor within the time window sharing the same field value.
   */
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
        for (const parentDepId of (ev.parent_deployments ?? [])) {
          const sourceId = depIdToNodeId.get(parentDepId);
          if (!sourceId) continue; // cross-service or unknown — skip
          const srcStatus = nodeById.get(sourceId)?.status;
          edges.push({
            id:     `${sourceId}--${ev.id}`,
            source: sourceId,
            target: ev.id,
            data:   { status: srcStatus ?? 'success' },
          });
        }
      }
      return edges;
    }

    // Field-based correlation predicates.
    const fieldMap: Partial<Record<CorrelationPredicate, keyof DeploymentEvent>> = {
      'same sha':        'sha',
      'same run_number': 'run_number',
      'same actor':      'actor',
      'same version':    'version',
    };
    const field = fieldMap[predicate];
    if (!field) return [];

    const sorted = [...events].sort(
      (a, b) => new Date(a.happened_at).getTime() - new Date(b.happened_at).getTime(),
    );

    const edges: NgxEdge[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const node      = sorted[i];
      const nodeTime  = new Date(node.happened_at).getTime();
      const fieldVal  = node[field] as string | undefined;
      if (!fieldVal) continue;

      // Scan backwards for the most recent predecessor with the same field value.
      for (let j = i - 1; j >= 0; j--) {
        const pred     = sorted[j];
        const predTime = new Date(pred.happened_at).getTime();
        if (nodeTime - predTime > twMs) break;
        if ((pred[field] as string | undefined) === fieldVal) {
          edges.push({
            id:     `${pred.id}--${node.id}`,
            source: pred.id,
            target: node.id,
            data:   { status: pred.status },
          });
          break; // connect to immediate predecessor only
        }
      }
    }
    return edges;
  }

  // ── Edge color ────────────────────────────────────────────
  protected getEdgeColor(status: string | undefined): string {
    if (status === 'success')     return 'var(--emerald)';
    if (status === 'in-progress') return 'var(--amber)';
    return 'var(--coral)';
  }

  // ── Node selection ────────────────────────────────────────
  protected onNodeSelect(ev: DeploymentEvent): void {
    this.state.selectedNodeId.set(ev.id);
    this.state.selectedEvent.set(ev);
  }
}
