import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
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
import { VisCardComponent } from './vis-card/vis-card.component';
import { InspectorPanelComponent } from './inspector-panel/inspector-panel.component';

/** Time-window string → milliseconds. */
const TIME_WINDOW_MS: Record<TimeWindow, number> = {
  '5 min':  5 * 60_000,
  '1 hr':   60 * 60_000,
  '1 day':  24 * 60 * 60_000,
  '7 days': 7 * 24 * 60 * 60_000,
};

const NODE_W = 200;

const DAGRE_SETTINGS = {
  orientation: 'LR',
  rankPadding: 60,
  nodePadding: 12,
  edgePadding: 8,
  multigraph: true,
};

export interface SwimLane {
  service: string;
  nodes: NgxNode[];
  links: NgxEdge[];
  graphH: number;
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

  protected readonly NODE_W        = NODE_W;
  protected readonly dagreSettings = DAGRE_SETTINGS;
  protected readonly timeWindows   = TIME_WINDOWS;

  // ── Update trigger for ngx-graph relayout ─────────────────
  private  readonly _update$ = new Subject<void>();
  readonly updateTrigger$    = this._update$.asObservable();

  constructor() {
    effect(() => {
      this.lanes(); // track — fire relayout when lanes recompute
      queueMicrotask(() => this._update$.next());
    });
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
    const twMs  = TIME_WINDOW_MS[timeWindow];
    const nodeH = this.calcNodeHeight(fields);

    return [...byService.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([service, svcEvents]) => {
        const nodes: NgxNode[] = svcEvents.map((ev) => ({
          id:        ev.id,
          label:     ev.version ?? ev.environment,
          data:      ev,
          dimension: { width: NODE_W, height: nodeH },
        }));

        const depIdToNodeId = new Map<string, string>(
          svcEvents.map((ev) => [ev.deployment_id, ev.id]),
        );
        const nodeById = new Map<string, DeploymentEvent>(
          svcEvents.map((ev) => [ev.id, ev]),
        );

        const links  = this.buildEdges(svcEvents, predicate, twMs, depIdToNodeId, nodeById);
        const rowsEst = Math.max(1, Math.ceil(svcEvents.length / 3));
        const graphH  = rowsEst * (nodeH + DAGRE_SETTINGS.nodePadding) + 60;

        return { service, nodes, links, graphH };
      });
  }

  private calcNodeHeight(fields: Set<SwimlaneField>): number {
    let h = 20;
    if (fields.has('version') || fields.has('happened_at'))                              h += 22;
    if (fields.has('ref') || fields.has('run_url') || fields.has('run_number') || fields.has('actor')) h += 20;
    h += 22; // sha + env row
    return Math.max(h, 64);
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
      'same actor': 'actor', 'same version': 'version',
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
