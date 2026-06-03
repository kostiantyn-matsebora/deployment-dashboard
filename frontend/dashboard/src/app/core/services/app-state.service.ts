import { computed, effect, Injectable, signal } from '@angular/core';
import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  DeploymentEvent,
  MATRIX_FIELDS,
  Matrix,
  MatrixField,
  MatrixRow,
  MatrixSlot,
  RateLimitReport,
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

/** localStorage keys — prefixed to avoid collisions with other apps. */
const K = {
  view:           'dd:view',
  svcFilter:      'dd:svcFilter',
  failOnly:       'dd:failOnly',
  matFields:      'dd:matFields',
  swFields:       'dd:swFields',
  correlation:    'dd:correlation',
  timeWindow:     'dd:timeWindow',
} as const;

/**
 * AppStateService — shared signal-based application state.
 *
 * Spec: docs/design/libraries.md §Angular Signals
 * All reactive state is signal<T>; derived values use computed().
 * No NgRx, no BehaviorSubject — Angular Signals only.
 *
 * User preferences (view, filters, field visibility, correlation, time window)
 * are persisted to localStorage on every change and restored on init.
 * Storage errors (private mode, quota exceeded) are silently ignored.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  // ── View ─────────────────────────────────────────────────
  readonly activeView = signal<'matrix' | 'swimlanes'>(
    this.ls(K.view, v => (v === 'matrix' || v === 'swimlanes') ? v : null, 'matrix'),
  );

  // ── Matrix filters ────────────────────────────────────────
  readonly serviceFilter = signal<string>(
    this.ls(K.svcFilter, v => v, ''),
  );
  readonly failuresOnly = signal<boolean>(
    this.ls(K.failOnly, v => v === 'true' ? true : v === 'false' ? false : null, false),
  );

  // ── Field visibility (all ON by default per spec) ─────────
  readonly matrixVisibleFields = signal<Set<MatrixField>>(
    this.ls(K.matFields, v => {
      const arr: unknown = JSON.parse(v);
      if (!Array.isArray(arr)) return null;
      const valid = (arr as string[]).filter(
        (f): f is MatrixField => (MATRIX_FIELDS as readonly string[]).includes(f),
      );
      // Fall back to all fields if stored set is empty (guards against corrupt data).
      return new Set<MatrixField>(valid.length ? valid : MATRIX_FIELDS);
    }, new Set(MATRIX_FIELDS)),
  );

  readonly swimlaneVisibleFields = signal<Set<SwimlaneField>>(
    this.ls(K.swFields, v => {
      const arr: unknown = JSON.parse(v);
      if (!Array.isArray(arr)) return null;
      const valid = (arr as string[]).filter(
        (f): f is SwimlaneField => (SWIMLANE_FIELDS as readonly string[]).includes(f),
      );
      return new Set<SwimlaneField>(valid.length ? valid : SWIMLANE_FIELDS);
    }, new Set(SWIMLANE_FIELDS)),
  );

  // ── Swimlanes correlation ─────────────────────────────────
  readonly correlationPredicate = signal<CorrelationPredicate>(
    this.ls(
      K.correlation,
      v => (CORRELATION_PREDICATES as readonly string[]).includes(v) ? v as CorrelationPredicate : null,
      'explicit parent',
    ),
  );
  readonly timeWindow = signal<TimeWindow>(
    this.ls(
      K.timeWindow,
      v => (TIME_WINDOWS as readonly string[]).includes(v) ? v as TimeWindow : null,
      TIME_WINDOWS[2], // '1 day'
    ),
  );

  // ── Inspector ─────────────────────────────────────────────
  /** Transient — not persisted. */
  readonly selectedNodeId = signal<string | null>(null);
  readonly selectedEvent  = signal<DeploymentEvent | null>(null);

  // ── SSE live status ───────────────────────────────────────
  readonly sseConnected = signal<boolean>(false);

  // ── Operational telemetry — fetcher rate-limit ────────────
  /**
   * Latest rate-limit report from dashboard-fetcher.
   * undefined until the first `event_type: rate-limit` component event arrives.
   * Last-value-wins; updated by App on every qualifying SSE frame.
   * Source: docs/diagrams/fetcher-rate-limit.md + api-guidelines.md §11.
   */
  readonly latestRateLimit = signal<RateLimitReport | undefined>(undefined);

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

  constructor() {
    // ── Persist user preferences on every change ──────────
    effect(() => this.save(K.view,        this.activeView()));
    effect(() => this.save(K.svcFilter,   this.serviceFilter()));
    effect(() => this.save(K.failOnly,    String(this.failuresOnly())));
    effect(() => this.save(K.matFields,   JSON.stringify([...this.matrixVisibleFields()])));
    effect(() => this.save(K.swFields,    JSON.stringify([...this.swimlaneVisibleFields()])));
    effect(() => this.save(K.correlation, this.correlationPredicate()));
    effect(() => this.save(K.timeWindow,  this.timeWindow()));
  }

  // ── SSE incremental update ────────────────────────────────
  /**
   * Apply a single SSE DeploymentEvent to the matrix snapshot in-place.
   *
   * New (service, environment) combinations are inserted immediately — appearing
   * in both views as soon as the event arrives. Each slot holds at most two
   * events (current + last_successful), so growth is proportional to the number
   * of distinct (service, env) pairs seen, which is bounded in any real system.
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

    const existingRow  = matrix.rows.find((r) => r.service === ev.service);
    const existingSlot = existingRow?.slots[ev.environment] as MatrixSlot | undefined;

    // ── Derive slot fields ────────────────────────────────
    const prevLastSuccessful =
      existingSlot?.current.status === 'success'
        ? existingSlot.current
        : existingSlot?.last_successful;

    const lastSuccessful = ev.status === 'success' ? undefined : prevLastSuccessful;

    const prevFailed =
      ev.status === 'in-progress' &&
      (existingSlot?.current.status === 'failure' || existingSlot?.prev_failed === true);

    const newSlot: MatrixSlot = {
      current: ev,
      ...(lastSuccessful ? { last_successful: lastSuccessful } : {}),
      ...(prevFailed     ? { prev_failed: true }               : {}),
    };

    // ── Patch or insert row ───────────────────────────────
    let rows = matrix.rows;
    if (existingRow) {
      rows = rows.map((r) =>
        r.service === ev.service
          ? { ...r, slots: { ...r.slots, [ev.environment]: newSlot } }
          : r,
      );
    } else {
      const newRow: MatrixRow = { service: ev.service, slots: { [ev.environment]: newSlot } };
      rows = [...rows, newRow].sort((a, b) => a.service.localeCompare(b.service));
    }

    // ── Track new environment ─────────────────────────────
    const environments = matrix.environments.includes(ev.environment)
      ? matrix.environments
      : sortEnvs([...matrix.environments, ev.environment]);

    this.matrixData.set({ ...matrix, generated_at: new Date().toISOString(), environments, rows });
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

  // ── localStorage helpers ──────────────────────────────────

  /**
   * Read a value from localStorage, parse and validate it.
   * Returns `def` if the key is absent, storage is unavailable, or parsing fails.
   * Methods on the prototype are available during field initialisation, so
   * this can be called in signal() initialisers before the constructor runs.
   */
  private ls<T>(key: string, parse: (raw: string) => T | null, def: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = parse(raw);
        if (parsed !== null) return parsed;
      }
    } catch { /* storage unavailable or parse error */ }
    return def;
  }

  /** Write a value to localStorage; silently ignores errors. */
  private save(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch { /* quota exceeded or private mode */ }
  }
}
