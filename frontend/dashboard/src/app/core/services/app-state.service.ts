import { computed, Injectable, signal } from '@angular/core';
import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  DeploymentEvent,
  MATRIX_FIELDS,
  Matrix,
  MatrixField,
  MatrixSlot,
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

/** Canonical environment sort order; unknowns sort alphabetically after. */
const ENV_ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];

function sortEnvs(envs: string[]): string[] {
  return [...envs].sort((a, b) => {
    const ia = ENV_ORDER.indexOf(a), ib = ENV_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
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
  readonly serviceFilter   = signal<string>('');
  readonly failuresOnly    = signal<boolean>(false);

  // ── Field visibility (all ON by default per spec) ─────────
  readonly matrixVisibleFields   = signal<Set<MatrixField>>(new Set(MATRIX_FIELDS));
  readonly swimlaneVisibleFields = signal<Set<SwimlaneField>>(new Set(SWIMLANE_FIELDS));

  // ── Swimlanes correlation ─────────────────────────────────
  readonly correlationPredicate = signal<CorrelationPredicate>('explicit parent');
  readonly timeWindow           = signal<TimeWindow>(TIME_WINDOWS[2]); // '1 day'

  // ── Inspector ─────────────────────────────────────────────
  readonly selectedNodeId = signal<string | null>(null);
  readonly selectedEvent  = signal<DeploymentEvent | null>(null);

  // ── SSE live status ───────────────────────────────────────
  readonly sseConnected = signal<boolean>(false);

  // ── Matrix data ───────────────────────────────────────────
  /**
   * Loaded once via GET /api/matrix; subsequently updated in-place by
   * `applyDeploymentEvent()` as SSE events arrive — no further HTTP calls.
   */
  readonly matrixData = signal<Matrix | null>(null);

  // ── KPIs ─────────────────────────────────────────────────
  readonly kpi = computed<Kpi>(() => {
    const matrix = this.matrixData();
    if (!matrix) return { services: 0, environments: 0, inFlight: 0, failed: 0 };

    let inFlight = 0, failed = 0;
    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots)) {
        if (slot.current.status === 'in-progress') inFlight++;
        else if (slot.current.status === 'failure')  failed++;
      }
    }
    return { services: matrix.rows.length, environments: matrix.environments.length, inFlight, failed };
  });

  // ── SSE incremental update ────────────────────────────────
  /**
   * Apply a single incoming SSE DeploymentEvent to the matrix snapshot
   * without re-fetching /api/matrix.
   *
   * Slot update rules (mirrors mock store.matrix() logic):
   *   success     → current = ev;  last_successful = undefined;   prev_failed = false
   *   failure     → current = ev;  last_successful promoted from previous current/slot
   *   in-progress → current = ev;  last_successful carried forward;
   *                 prev_failed = (previous current was failure) OR (prev slot had prev_failed)
   */
  /**
   * Apply a single SSE DeploymentEvent to the matrix snapshot in-place.
   *
   * Intentionally only patches EXISTING (service, environment) slots.
   * Unknown combos are silently dropped — new services and environments are
   * discovered exclusively via the periodic full re-fetch in App, keeping the
   * matrix size bounded to what was shown at the last snapshot.
   *
   * Slot update rules:
   *   success     → current = ev;  last_successful = undefined
   *   failure     → current = ev;  last_successful promoted from previous current
   *   in-progress → current = ev;  last_successful carried forward;
   *                 prev_failed = (prev current was failure) OR (prev had prev_failed)
   */
  applyDeploymentEvent(ev: DeploymentEvent): void {
    const matrix = this.matrixData();
    if (!matrix) return;

    const existingRow = matrix.rows.find((r) => r.service === ev.service);
    // Unknown service or environment — skip. Discovered on next full refresh.
    if (!existingRow || !(ev.environment in existingRow.slots)) return;

    const existingSlot = existingRow.slots[ev.environment];

    const prevLastSuccessful =
      existingSlot.current.status === 'success'
        ? existingSlot.current
        : existingSlot.last_successful;

    const lastSuccessful = ev.status === 'success' ? undefined : prevLastSuccessful;

    const prevFailed =
      ev.status === 'in-progress' &&
      (existingSlot.current.status === 'failure' || existingSlot.prev_failed === true);

    const newSlot: MatrixSlot = {
      current: ev,
      ...(lastSuccessful ? { last_successful: lastSuccessful } : {}),
      ...(prevFailed     ? { prev_failed: true }               : {}),
    };

    const rows = matrix.rows.map((r) =>
      r.service === ev.service
        ? { ...r, slots: { ...r.slots, [ev.environment]: newSlot } }
        : r,
    );

    this.matrixData.set({ ...matrix, generated_at: new Date().toISOString(), rows });
  }

  // ── Field toggle helpers ──────────────────────────────────
  toggleMatrixField(field: MatrixField): void {
    const s = new Set(this.matrixVisibleFields());
    s.has(field) ? s.delete(field) : s.add(field);
    this.matrixVisibleFields.set(s);
  }

  toggleSwimlaneField(field: SwimlaneField): void {
    const s = new Set(this.swimlaneVisibleFields());
    s.has(field) ? s.delete(field) : s.add(field);
    this.swimlaneVisibleFields.set(s);
  }
}
