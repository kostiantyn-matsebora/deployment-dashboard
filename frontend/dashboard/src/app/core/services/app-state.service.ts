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
  isContextStatus,
} from '../models/deployment.model';
import { applyGlobFilter } from '../utils/glob.util';

export interface Kpi {
  services: number;
  environments: number;
  inFlight: number;
  failed: number;
}

/** Filter mode for the services picker — mirrors svcFilterMode in mockup. */
export type ServiceFilterMode = 'exclude' | 'include';

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
  view:              'dd:view',
  svcFilter:         'dd:svcFilter',
  failOnly:          'dd:failOnly',
  svcFilterMode:     'dd:svcFilterMode',
  svcPatterns:       'dd:svcPatterns',
  matFields:         'dd:matFields',
  swFields:          'dd:swFields',
  correlation:       'dd:correlation',
  timeWindow:        'dd:timeWindow',
  rateLimit:         'dd.rateLimit',
  colOrder:          'dd:colOrder',
  colHidden:         'dd:colHidden',
  swimCollapsed:     'dd:swimCollapsed',
  swimKnown:         'dd:swimKnown',
  swimAutoScroll:    'dd:swimAutoScroll',
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
  readonly activeView = signal<'matrix' | 'swimlanes' | 'analytics'>(
    this.ls(K.view, v => (v === 'matrix' || v === 'swimlanes' || v === 'analytics') ? v : null, 'matrix'),
  );

  // ── Matrix filters ────────────────────────────────────────
  readonly serviceFilter = signal<string>(
    this.ls(K.svcFilter, v => v, ''),
  );
  readonly failuresOnly = signal<boolean>(
    this.ls(K.failOnly, v => v === 'true' ? true : v === 'false' ? false : null, false),
  );

  /**
   * Glob pattern filter mode for the services picker.
   * exclude = "Show all except" (default); include = "Show only".
   * Persisted under dd:svcFilterMode.
   * Spec: docs/design/mockup/index.html §buildSvcsPicker / §visibleServices
   */
  readonly serviceFilterMode = signal<ServiceFilterMode>(
    this.ls(K.svcFilterMode, v => (v === 'include' ? 'include' : null), 'exclude'),
  );

  /**
   * Glob pattern list for the services picker.
   * Each entry is a glob string (e.g. '*-api', 'auth-bff').
   * Empty list → all services visible (blank = all).
   * Persisted under dd:svcPatterns (JSON array).
   * Spec: docs/design/mockup/index.html §svcPatterns
   */
  readonly servicePatterns = signal<string[]>(
    this.ls(K.svcPatterns, v => {
      const arr: unknown = JSON.parse(v);
      if (!Array.isArray(arr)) return null;
      const patterns = (arr as unknown[]).filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      );
      return patterns;
    }, []),
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

  /**
   * The `next` context-status event for the currently selected slot, if any.
   * Derived from `selectedEvent` + matrix snapshot: finds the slot whose
   * `current.id === selectedEvent.id` and returns its `next` field.
   * Null when no node is selected or the selected slot has no next event.
   */
  readonly selectedNextEvent = computed<DeploymentEvent | null>(() => {
    const ev = this.selectedEvent();
    const matrix = this.matrixData();
    if (!ev || !matrix) return null;
    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots) as MatrixSlot[]) {
        if (slot.current.id === ev.id) return slot.next ?? null;
      }
    }
    return null;
  });

  // ── SSE live status ───────────────────────────────────────
  readonly sseConnected = signal<boolean>(false);

  // ── Operational telemetry — fetcher rate-limit ────────────
  /**
   * Per-adapter rate-limit reports keyed by `payload.adapter`.
   * Empty map until the first `event_type: rate-limit` component event arrives.
   * Last-value-wins per adapter; updated by App on every qualifying SSE frame.
   * Persisted to localStorage under `dd.rateLimit`; hydrated on init.
   * Source: docs/diagrams/fetcher-rate-limit.md + api-guidelines.md §11.
   */
  readonly rateLimitMap = signal<Map<string, RateLimitReport>>(
    this.ls(K.rateLimit, (raw) => {
      const obj: unknown = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      const map = new Map<string, RateLimitReport>();
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          map.set(k, v as RateLimitReport);
        }
      }
      return map.size > 0 ? map : null;
    }, new Map<string, RateLimitReport>()),
  );

  // ── Matrix data ───────────────────────────────────────────
  /**
   * Loaded once via GET /api/matrix; subsequently updated in-place by
   * `applyDeploymentEvent()` as SSE events arrive — no further HTTP calls.
   */
  readonly matrixData = signal<Matrix | null>(null);

  /**
   * Last effective (non-context) deployment event applied via `applyDeploymentEvent`.
   * Set to `ev` only when `ev.status` is NOT a context status (success / in-progress /
   * failure). Context-only events (pending / queued / waiting / cancelled / rejected)
   * do NOT update this signal — they change only `slot.next` in the matrix and
   * represent pipeline gates, not a service's latest deployment status.
   *
   * Consumers (e.g. SwimlanesComponent) watch this signal in an `effect` to react
   * to live status changes without firing on context-only updates. Transient — not
   * persisted to localStorage.
   *
   * Spec: docs/design/views.md §Collapse / Expand (#309) — flash + auto-scroll
   */
  readonly lastEffectiveEvent = signal<DeploymentEvent | null>(null);

  // ── Swimlanes collapse/expand state (#309) ───────────────────────────────
  /**
   * Set of service names whose lane is currently collapsed.
   * Default: ALL services collapsed (populated lazily when matrix data loads).
   * Persisted to localStorage; restored across view switches and reloads.
   *
   * Spec: docs/design/views.md §Collapse / Expand (#309)
   */
  readonly collapsedLanes = signal<Set<string>>(
    this.ls(K.swimCollapsed, v => {
      const arr: unknown = JSON.parse(v);
      if (!Array.isArray(arr)) return null;
      return new Set((arr as unknown[]).filter((x): x is string => typeof x === 'string'));
    }, new Set<string>()),
  );

  /**
   * Whether to auto-scroll a lane into view when it receives a new SSE event
   * and is currently off-screen. Default ON.
   *
   * Spec: docs/design/views.md §Collapse / Expand (#309)
   */
  readonly autoScrollOnChange = signal<boolean>(
    this.ls(K.swimAutoScroll, v => v === 'true' ? true : v === 'false' ? false : null, true),
  );

  // ── Matrix column order + visibility ────────────────────────────────────
  /**
   * Persisted column order: a permutation of all environment names last seen.
   * On load the stored array is validated against the live environment list and
   * re-reconciled in `orderedVisibleEnvironments()`.
   */
  readonly matrixColOrder = signal<string[]>(
    this.ls(K.colOrder, v => {
      const arr: unknown = JSON.parse(v);
      if (!Array.isArray(arr)) return null;
      return (arr as unknown[]).every(x => typeof x === 'string') ? (arr as string[]) : null;
    }, []),
  );

  /**
   * Set of environment names that the user has hidden.
   * Guard: must always leave at least one column visible.
   */
  readonly matrixColHidden = signal<Set<string>>(
    this.ls(K.colHidden, v => {
      if (!v) return null;
      return new Set(v.split(',').filter(Boolean));
    }, new Set<string>()),
  );

  // ── KPIs ─────────────────────────────────────────────────
  /**
   * KPIs derived from visible services × visible environments.
   * Respects the glob service filter (serviceFilterMode + servicePatterns)
   * and the column hidden set (matrixColHidden), matching mockup §computeKPIs.
   */
  readonly kpi = computed<Kpi>(() => {
    const matrix = this.matrixData();
    if (!matrix) return { services: 0, environments: 0, inFlight: 0, failed: 0 };

    const visSvcs = new Set(this.visibleServices(matrix.rows.map((r) => r.service)));
    const hidden  = this.matrixColHidden();

    const svcSet = new Set<string>();
    const envSet = new Set<string>();
    let inFlight = 0, failed = 0;

    for (const row of matrix.rows) {
      if (!visSvcs.has(row.service)) continue;
      for (const [env, slot] of Object.entries(row.slots)) {
        if (hidden.has(env)) continue;
        svcSet.add(row.service);
        envSet.add(env);
        if (slot.current.status === 'in-progress') inFlight++;
        else if (slot.current.status === 'failure')  failed++;
      }
    }

    return { services: svcSet.size, environments: envSet.size, inFlight, failed };
  });

  constructor() {
    // ── Persist user preferences on every change ──────────
    effect(() => this.save(K.view,           this.activeView()));
    effect(() => this.save(K.svcFilter,      this.serviceFilter()));
    effect(() => this.save(K.failOnly,       String(this.failuresOnly())));
    effect(() => this.save(K.svcFilterMode,  this.serviceFilterMode()));
    effect(() => this.save(K.svcPatterns,    JSON.stringify(this.servicePatterns())));
    effect(() => this.save(K.matFields,   JSON.stringify([...this.matrixVisibleFields()])));
    effect(() => this.save(K.swFields,    JSON.stringify([...this.swimlaneVisibleFields()])));
    effect(() => this.save(K.correlation, this.correlationPredicate()));
    effect(() => this.save(K.timeWindow,  this.timeWindow()));
    effect(() => this.save(K.rateLimit,   JSON.stringify(Object.fromEntries(this.rateLimitMap()))));
    effect(() => this.save(K.colOrder,      JSON.stringify(this.matrixColOrder())));
    effect(() => this.save(K.colHidden,     [...this.matrixColHidden()].join(',')));
    effect(() => this.save(K.swimCollapsed, JSON.stringify([...this.collapsedLanes()])));
    effect(() => this.save(K.swimAutoScroll, String(this.autoScrollOnChange())));

    // ── Seed column order whenever matrix data loads / envs change ─────
    // Runs on first load (GET /api/matrix) and on every SSE event that
    // adds a new environment. syncColOrder() is a no-op when the order
    // already contains all current envs, so the persistence effect above
    // only fires when something actually changes.
    effect(() => {
      const matrix = this.matrixData();
      if (matrix) {
        this.syncColOrder(matrix.environments);
      }
    });
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
   * Slot update rules (effective statuses: success / in-progress / failure):
   *   success     → current = ev;  last_successful = undefined;  next cleared
   *   failure     → current = ev;  last_successful promoted from previous current;  next cleared
   *   in-progress → current = ev;  last_successful carried forward;
   *                 prev_failed = (prev current was failure) OR (prev had prev_failed);  next cleared
   *
   * Context statuses (pending / queued / waiting / cancelled / rejected):
   *   → stored in next only; current + last_successful are unchanged.
   *   A context event older than the existing current is ignored.
   */
  applyDeploymentEvent(ev: DeploymentEvent): void {
    const matrix = this.matrixData();
    if (!matrix) return;

    const existingRow  = matrix.rows.find((r) => r.service === ev.service);
    const existingSlot = existingRow?.slots[ev.environment] as MatrixSlot | undefined;

    let newSlot: MatrixSlot;

    if (isContextStatus(ev.status)) {
      // ── Context event: update slot.next only ──────────────
      if (!existingSlot) {
        // No slot yet — can't place a context event without a current; skip
        return;
      }
      const evTs      = new Date(ev.happened_at).getTime();
      const currentTs = new Date(existingSlot.current.happened_at).getTime();
      if (evTs <= currentTs) {
        // Older than current effective event — ignore
        return;
      }
      newSlot = { ...existingSlot, next: ev };
    } else {
      // ── Effective event: update current ───────────────────
      const prevLastSuccessful =
        existingSlot?.current.status === 'success'
          ? existingSlot.current
          : existingSlot?.last_successful;

      const lastSuccessful = ev.status === 'success' ? undefined : prevLastSuccessful;

      const prevFailed =
        ev.status === 'in-progress' &&
        (existingSlot?.current.status === 'failure' || existingSlot?.prev_failed === true);

      // Effective event supersedes any pending next
      newSlot = {
        current: ev,
        ...(lastSuccessful ? { last_successful: lastSuccessful } : {}),
        ...(prevFailed     ? { prev_failed: true }               : {}),
        // next cleared — a new effective event resolves the previous context status
      };
    }

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

    // Notify swimlane live-update watchers (#309): only for effective events.
    // Context events change slot.next only (gate status, not deployment outcome)
    // and must NOT trigger flash/auto-scroll — the spec states "new status arrives
    // over SSE" meaning an effective status change.
    if (!isContextStatus(ev.status)) {
      this.lastEffectiveEvent.set(ev);
    }
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

  // ── Collapse/expand helpers (#309) ────────────────────────────────────────

  /** Toggle a single lane's collapsed state. */
  toggleLaneCollapsed(service: string): void {
    const s = new Set(this.collapsedLanes());
    s.has(service) ? s.delete(service) : s.add(service);
    this.collapsedLanes.set(s);
  }

  /**
   * Collapse all lanes. Caller passes the current service list so that
   * newly added services (not yet in the persisted set) are also covered.
   */
  collapseAllLanes(services: string[]): void {
    this.collapsedLanes.set(new Set(services));
  }

  /** Expand all lanes. */
  expandAllLanes(): void {
    this.collapsedLanes.set(new Set());
  }

  /**
   * Ensure every service starts collapsed the first time it is seen.
   * Services already in the "known" set were previously shown to the user
   * and their collapsed/expanded state is already persisted — leave them alone.
   * New services (not in the known set) default to collapsed.
   *
   * Called each time the swimlane lane list first becomes non-empty.
   */
  initDefaultCollapsed(services: string[]): void {
    if (!services.length) return;

    // Restore the set of services whose state has already been persisted.
    const knownRaw = this.tryGet(K.swimKnown);
    const known = new Set<string>(
      knownRaw ? (JSON.parse(knownRaw) as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    );

    // Any service not yet known defaults to collapsed.
    const newServices = services.filter(s => !known.has(s));
    if (newServices.length === 0) return;

    // Collapse the new ones and mark them known.
    const collapsed = new Set(this.collapsedLanes());
    for (const s of newServices) {
      collapsed.add(s);
      known.add(s);
    }
    this.collapsedLanes.set(collapsed);
    try { localStorage.setItem(K.swimKnown, JSON.stringify([...known])); } catch { /* quota */ }
  }

  // ── Services glob filter ─────────────────────────────────

  /**
   * Derive the visible service list from `allServices` applying the current
   * glob filter mode + patterns.
   *
   * exclude mode: show everything EXCEPT services matching a pattern.
   * include mode: show ONLY services matching a pattern.
   * Empty pattern list → return all services (blank = all).
   * Last-visible guard via applyGlobFilter: always returns at least one item.
   *
   * Spec: docs/design/mockup/index.html §visibleServices
   */
  visibleServices(allServices: string[]): string[] {
    return applyGlobFilter(allServices, this.serviceFilterMode(), this.servicePatterns());
  }

  /** Raw localStorage get — null when absent or storage unavailable. */
  private tryGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  // ── Column order + visibility helpers ────────────────────────────────────

  /**
   * Derive the ordered + filtered environment list for matrix rendering.
   *
   * Algorithm:
   * 1. Start from `allEnvs` (live environment list from matrix data).
   * 2. Prepend any envs from the saved order that still exist in `allEnvs`
   *    (preserves user-defined order; new envs not yet in colOrder fall to end).
   * 3. Append any new envs from `allEnvs` not yet in the saved order (sorted).
   * 4. Drop hidden envs.
   *
   * This handles environments appearing/disappearing from the data gracefully.
   */
  orderedVisibleEnvironments(allEnvs: string[]): string[] {
    const savedOrder = this.matrixColOrder();
    const hidden     = this.matrixColHidden();

    // Build ordered list: saved order first, then new envs (not in saved order)
    const inSaved  = savedOrder.filter(e => allEnvs.includes(e));
    const newEnvs  = allEnvs.filter(e => !savedOrder.includes(e));
    const ordered  = [...inSaved, ...newEnvs];

    return ordered.filter(e => !hidden.has(e));
  }

  /**
   * Reorder columns: move `fromEnv` to the position occupied by `toEnv`.
   * Operates on the full (non-hidden) order array.
   */
  reorderColumn(fromEnv: string, toEnv: string): void {
    const order = [...this.matrixColOrder()];
    const fromIdx = order.indexOf(fromEnv);
    const toIdx   = order.indexOf(toEnv);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromEnv);
    this.matrixColOrder.set(order);
  }

  /**
   * Toggle env column visibility. Refuses to hide the last visible column.
   * `allEnvs` is passed so the guard can check against the current data set.
   */
  toggleColHidden(env: string, allEnvs: string[]): void {
    const hidden  = new Set(this.matrixColHidden());
    const visible = allEnvs.filter(e => !hidden.has(e));
    if (!hidden.has(env)) {
      // Attempting to hide — guard: must leave at least one visible
      if (visible.length <= 1) return;
      hidden.add(env);
    } else {
      hidden.delete(env);
    }
    this.matrixColHidden.set(hidden);
  }

  /**
   * Show all columns and reset the column order to the default (sortEnvs).
   */
  resetColumns(allEnvs: string[]): void {
    this.matrixColHidden.set(new Set());
    this.matrixColOrder.set(sortEnvs([...allEnvs]));
  }

  /**
   * Ensure the saved column order contains all current envs.
   * Called when new environments appear in matrix data.
   */
  syncColOrder(allEnvs: string[]): void {
    const order   = this.matrixColOrder();
    // Keep existing order for envs still present; append new envs sorted
    const kept    = order.filter(e => allEnvs.includes(e));
    const newEnvs = allEnvs.filter(e => !order.includes(e));
    if (kept.length !== order.length || newEnvs.length > 0) {
      this.matrixColOrder.set([...kept, ...sortEnvs(newEnvs)]);
    }
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
