import { computed, Injectable, signal } from '@angular/core';
import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  DeploymentEvent,
  MATRIX_FIELDS,
  Matrix,
  MatrixField,
  SWIMLANE_FIELDS,
  SwimlaneField,
  TIME_WINDOWS,
  TimeWindow,
} from '../models/deployment.model';

export interface Kpi {
  services: number;
  environments: number;
  inFlight: number;
  failed: number;
}

/**
 * AppStateService — shared signal-based application state.
 *
 * Spec: docs/design/libraries.md §Angular Signals
 * All reactive state is signal<T>; derived values use computed().
 * No NgRx, no BehaviorSubject — Angular Signals only.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  // ── View ─────────────────────────────────────────────────
  readonly activeView = signal<'matrix' | 'swimlanes'>('matrix');

  // ── Matrix filters ────────────────────────────────────────
  /** Substring filter against service name (case-insensitive). */
  readonly serviceFilter = signal<string>('');
  /** When true, hide service rows with no failed states. */
  readonly failuresOnly = signal<boolean>(false);

  // ── Field visibility (all ON by default per spec) ─────────
  readonly matrixVisibleFields = signal<Set<MatrixField>>(new Set(MATRIX_FIELDS));
  readonly swimlaneVisibleFields = signal<Set<SwimlaneField>>(new Set(SWIMLANE_FIELDS));

  // ── Swimlanes correlation ─────────────────────────────────
  /** Default: explicit parent gives the richest DAG for the demo data. */
  readonly correlationPredicate = signal<CorrelationPredicate>('explicit parent');
  readonly timeWindow = signal<TimeWindow>(TIME_WINDOWS[2]); // '1 day'

  // ── Inspector (Swimlanes selected node) ───────────────────
  readonly selectedNodeId = signal<string | null>(null);
  readonly selectedEvent = signal<DeploymentEvent | null>(null);

  // ── SSE live status ───────────────────────────────────────
  readonly sseConnected = signal<boolean>(false);

  // ── Matrix data (populated by MatrixComponent in P2) ──────
  readonly matrixData = signal<Matrix | null>(null);

  // ── KPIs — derived from matrix data ───────────────────────
  /**
   * Per docs/design/data-model.md §KPIs & Derived Values:
   * - services:    distinct service count
   * - environments: distinct environment count
   * - inFlight:    slots where current.status === 'in-progress'
   * - failed:      slots where current.status === 'failure'
   */
  readonly kpi = computed<Kpi>(() => {
    const matrix = this.matrixData();
    if (!matrix) return { services: 0, environments: 0, inFlight: 0, failed: 0 };

    let inFlight = 0;
    let failed = 0;

    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots)) {
        if (slot.current.status === 'in-progress') inFlight++;
        else if (slot.current.status === 'failure') failed++;
      }
    }

    return {
      services: matrix.rows.length,
      environments: matrix.environments.length,
      inFlight,
      failed,
    };
  });

  // ── Helpers ───────────────────────────────────────────────
  toggleMatrixField(field: MatrixField): void {
    const current = new Set(this.matrixVisibleFields());
    if (current.has(field)) current.delete(field);
    else current.add(field);
    this.matrixVisibleFields.set(current);
  }

  toggleSwimlaneField(field: SwimlaneField): void {
    const current = new Set(this.swimlaneVisibleFields());
    if (current.has(field)) current.delete(field);
    else current.add(field);
    this.swimlaneVisibleFields.set(current);
  }
}
