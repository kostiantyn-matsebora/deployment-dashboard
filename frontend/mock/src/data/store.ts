/**
 * In-memory event store — shared singleton across all NestJS request handlers.
 *
 * Data source: demo/data/events.json (project root).
 * The store resolves elapsed_minutes → happened_at at startup so that
 * displayed elapsed labels match the dataset values immediately after boot.
 *
 * Demo data control:
 *   store.setDemoEnabled(false) hides all pre-loaded events from every read
 *   surface (list, findById, matrix, discovery). User-posted events (via
 *   POST /api/deployments or the SSE emitter) are never tagged as demo and
 *   always remain visible.
 */
import { Subject } from 'rxjs';
import type { DemoData, DemoEvent as DemoEventShape, DemoSseTemplate, DemoStatus } from './demo-types';

// ── Feed entry (control panel + /_mock/stream) ────────────────────────────────

export type IngestSource = 'write-api' | 'sse-emitter';

export interface FeedEntry {
  event:       DeploymentEvent;
  source:      IngestSource;
  received_at: string;          // server wall-clock at time of append
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const demoData: DemoData = require('../../../../demo/data/events.json');

// ── Wire type (matches docs/api/openapi.yaml DeploymentEvent) ────────────────

export interface DeploymentEvent {
  id: string;
  deployment_id: string;
  service: string;
  /**
   * Optional CI/CD namespace (e.g. GitHub org/owner).
   * Null/absent = bare service name with no namespace prefix.
   */
  namespace?: string | null;
  environment: string;
  status: DemoStatus;
  happened_at: string;
  version?: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
  ref?: string;
  sha?: string;
  parent_deployments?: string[];
}

// ── Internal stored type — _demo never leaves the server ─────────────────────

interface StoredEvent extends DeploymentEvent {
  readonly _demo?: true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function resolveHappenedAt(elapsed_minutes: number, baseMs: number): string {
  return new Date(baseMs - elapsed_minutes * 60_000).toISOString();
}

function toDemoEvent(demo: DemoEventShape, baseMs: number): StoredEvent {
  const { elapsed_minutes, ...fields } = demo;
  return { id: makeUuid(), happened_at: resolveHappenedAt(elapsed_minutes, baseMs), _demo: true, ...fields };
}

/** Strip the internal _demo tag before returning to a caller. */
function wire({ _demo: _ignored, ...e }: StoredEvent): DeploymentEvent {
  return e;
}

// ── Store ────────────────────────────────────────────────────────────────────

class EventStore {
  private readonly baseMs: number;
  private events: StoredEvent[];
  private _demoEnabled = true;

  readonly live$ = new Subject<DeploymentEvent>();
  readonly feed$ = new Subject<FeedEntry>();

  constructor() {
    this.baseMs = Date.now();
    // Sort newest-first (smallest elapsed_minutes = most recent).
    this.events = [...demoData.events]
      .sort((a, b) => a.elapsed_minutes - b.elapsed_minutes)
      .map((d) => toDemoEvent(d, this.baseMs));
  }

  // ── Demo-data control ───────────────────────────────────────────────────────

  get isDemoEnabled(): boolean {
    return this._demoEnabled;
  }

  setDemoEnabled(val: boolean): void {
    this._demoEnabled = val;
  }

  /**
   * Reset to demo state:
   * - Removes all user-posted / SSE-emitted events (anything without _demo).
   * - Re-enables demo data visibility.
   */
  reset(): void {
    this.events = this.events.filter((e) => e._demo === true);
    this._demoEnabled = true;
  }

  /** Events currently visible to callers (respects demo flag). */
  private visible(): StoredEvent[] {
    return this._demoEnabled ? this.events : this.events.filter((e) => !e._demo);
  }

  // ── Read methods ────────────────────────────────────────────────────────────

  all(): DeploymentEvent[] {
    return this.visible().map(wire);
  }

  findById(id: string): DeploymentEvent | undefined {
    const e = this.visible().find((e) => e.id === id);
    return e ? wire(e) : undefined;
  }

  list(params: {
    service?: string;
    environment?: string;
    status?: string;
    deployment_id?: string;
    since?: string;
    until?: string;
    /**
     * Free-text search — case-insensitive substring match across service,
     * namespace, environment, version, status, actor, ref, sha,
     * deployment_id, run_number. Applied AFTER the structured filters and
     * BEFORE cursor pagination (contract: docs/api/openapi.yaml `q` param).
     */
    q?: string;
    cursor?: string;
    limit?: number;
  }): { items: DeploymentEvent[]; next_cursor: string | null } {
    const limit = Math.min(params.limit ?? 100, 500);
    let rows = this.visible();

    if (params.service)       rows = rows.filter((e) => e.service === params.service);
    if (params.environment)   rows = rows.filter((e) => e.environment === params.environment);
    if (params.status)        rows = rows.filter((e) => e.status === params.status);
    if (params.deployment_id) rows = rows.filter((e) => e.deployment_id === params.deployment_id);
    if (params.since)         rows = rows.filter((e) => e.happened_at >= params.since!);
    if (params.until)         rows = rows.filter((e) => e.happened_at < params.until!);
    if (params.q) {
      const q = params.q.toLowerCase();
      rows = rows.filter((e) =>
        [e.service, e.namespace, e.environment, e.version, e.status, e.actor, e.ref, e.sha, e.deployment_id, e.run_number]
          .filter((v): v is string => v != null)
          .some((v) => v.toLowerCase().includes(q)),
      );
    }

    let offset = 0;
    if (params.cursor) {
      try { offset = parseInt(Buffer.from(params.cursor, 'base64').toString(), 10); } catch {}
    }
    const page = rows.slice(offset, offset + limit);
    const next_cursor =
      offset + limit < rows.length
        ? Buffer.from(String(offset + limit)).toString('base64')
        : null;

    return { items: page.map(wire), next_cursor };
  }

  matrix(serviceFilter?: string): {
    generated_at: string;
    environments: string[];
    rows: Array<{ service: string; namespace?: string | null; slots: Record<string, { current: DeploymentEvent; last_successful?: DeploymentEvent; next?: DeploymentEvent }> }>;
  } {
    let rows = this.visible();
    if (serviceFilter) rows = rows.filter((e) => e.service === serviceFilter);

    // Key by (namespace, service) pair to support namespace-aware rows (issue #353).
    const rowKeys = new Map<string, { service: string; namespace: string | null }>();
    const envSet  = new Set<string>();
    for (const e of rows) {
      const key = `${e.namespace ?? ''}|${e.service}`;
      if (!rowKeys.has(key)) rowKeys.set(key, { service: e.service, namespace: e.namespace ?? null });
      envSet.add(e.environment);
    }

    const ENV_ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];
    const EFFECTIVE_STATUSES = new Set(['success', 'in-progress', 'failure']);
    const rowIdentities = [...rowKeys.values()].sort((a, b) => a.service.localeCompare(b.service));
    const environments = [...envSet].sort((a, b) => {
      const ia = ENV_ORDER.indexOf(a), ib = ENV_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    const matrixRows = rowIdentities.map(({ service, namespace }) => {
      const slots: Record<string, { current: DeploymentEvent; last_successful?: DeploymentEvent; prev_failed?: boolean; next?: DeploymentEvent }> = {};
      for (const env of environments) {
        const slotEvents = rows
          .filter((e) => e.service === service && (e.namespace ?? null) === namespace && e.environment === env)
          .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime());
        if (slotEvents.length === 0) continue;

        // Separate effective (success/in-progress/failure) from context (pending/queued/waiting/cancelled/rejected)
        const effectiveEvents = slotEvents.filter((e) => EFFECTIVE_STATUSES.has(e.status));
        const contextEvents   = slotEvents.filter((e) => !EFFECTIVE_STATUSES.has(e.status));

        // current must always be an effective status; fall back to first overall if no effective event exists
        const currentRaw = effectiveEvents[0] ?? slotEvents[0];
        const current = wire(currentRaw);

        // next: most-recent context-status event that is newer than current
        const currentTs = new Date(currentRaw.happened_at).getTime();
        const nextRaw = contextEvents.find(
          (e) => new Date(e.happened_at).getTime() > currentTs
        );
        const next = nextRaw ? wire(nextRaw) : undefined;

        const lastSuccessfulRaw = current.status === 'success' ? undefined : effectiveEvents.find((e) => e.status === 'success');
        const lastSuccessful = lastSuccessfulRaw ? wire(lastSuccessfulRaw) : undefined;

        let prevFailed = false;
        if (current.status !== 'success') {
          const searchUntil = lastSuccessfulRaw ? effectiveEvents.indexOf(lastSuccessfulRaw) : effectiveEvents.length;
          prevFailed = effectiveEvents.slice(1, searchUntil).some((e) => e.status === 'failure');
        }

        slots[env] = {
          current,
          ...(lastSuccessful ? { last_successful: lastSuccessful } : {}),
          ...(prevFailed ? { prev_failed: true } : {}),
          ...(next ? { next } : {}),
        };
      }
      return {
        service,
        ...(namespace ? { namespace } : {}),
        slots,
      };
    });

    return { generated_at: new Date().toISOString(), environments, rows: matrixRows };
  }

  /** Distinct sorted services derived from visible events. */
  services(): string[] {
    return [...new Set(this.visible().map((e) => e.service))].sort();
  }

  /** Distinct sorted environments derived from visible events. */
  environments(): string[] {
    const ENV_ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];
    const envs = [...new Set(this.visible().map((e) => e.environment))];
    return envs.sort((a, b) => {
      const ia = ENV_ORDER.indexOf(a), ib = ENV_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }

  append(event: Omit<DeploymentEvent, 'id'>, source: IngestSource = 'write-api'): DeploymentEvent {
    // User-posted events are never tagged as demo — always visible.
    const row: StoredEvent = { id: makeUuid(), ...event };
    this.events.unshift(row);
    const wired = wire(row);
    this.live$.next(wired);
    this.feed$.next({ event: wired, source, received_at: new Date().toISOString() });
    return wired;
  }
}

export const store = new EventStore();

// ── SSE live emitter ──────────────────────────────────────────────────────────

const sseTemplates: DemoSseTemplate[] = demoData.sse_templates as DemoSseTemplate[];
let _sseIdx = 0;

export function nextSseEvent(): DeploymentEvent {
  const tpl = sseTemplates[_sseIdx % sseTemplates.length];
  _sseIdx++;
  return store.append({ happened_at: new Date().toISOString(), ...tpl }, 'sse-emitter');
}
