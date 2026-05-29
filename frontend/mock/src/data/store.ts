/**
 * In-memory event store — shared singleton across all NestJS request handlers.
 *
 * Data source: demo-data/events.json (project root).
 * The store resolves elapsed_minutes → happened_at at startup so that
 * displayed elapsed labels match the dataset values immediately after boot.
 */
import { Subject } from 'rxjs';
import type { DemoData, DemoEvent as DemoEventShape, DemoSseTemplate } from './demo-types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const demoData: DemoData = require('../../../../demo/data/events.json');

// ── Wire type (matches docs/api/openapi.yaml DeploymentEvent) ────────────────

export interface DeploymentEvent {
  id: string;
  deployment_id: string;
  service: string;
  environment: string;
  status: 'in-progress' | 'success' | 'failure';
  happened_at: string;
  version?: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
  ref?: string;
  sha?: string;
  parent_deployments?: string[];
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

function toWireEvent(demo: DemoEventShape, baseMs: number): DeploymentEvent {
  const { elapsed_minutes, ...fields } = demo;
  return { id: makeUuid(), happened_at: resolveHappenedAt(elapsed_minutes, baseMs), ...fields };
}

// ── Store ────────────────────────────────────────────────────────────────────

class EventStore {
  private readonly baseMs: number;
  private events: DeploymentEvent[];

  readonly live$ = new Subject<DeploymentEvent>();

  constructor() {
    this.baseMs = Date.now();
    // Sort newest-first (smallest elapsed_minutes = most recent).
    this.events = [...demoData.events]
      .sort((a, b) => a.elapsed_minutes - b.elapsed_minutes)
      .map((d) => toWireEvent(d, this.baseMs));
  }

  all(): DeploymentEvent[] {
    return [...this.events];
  }

  findById(id: string): DeploymentEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  list(params: {
    service?: string;
    environment?: string;
    status?: string;
    deployment_id?: string;
    since?: string;
    until?: string;
    cursor?: string;
    limit?: number;
  }): { items: DeploymentEvent[]; next_cursor: string | null } {
    const limit = Math.min(params.limit ?? 100, 500);
    let rows = this.events;

    if (params.service)       rows = rows.filter((e) => e.service === params.service);
    if (params.environment)   rows = rows.filter((e) => e.environment === params.environment);
    if (params.status)        rows = rows.filter((e) => e.status === params.status);
    if (params.deployment_id) rows = rows.filter((e) => e.deployment_id === params.deployment_id);
    if (params.since)         rows = rows.filter((e) => e.happened_at >= params.since!);
    if (params.until)         rows = rows.filter((e) => e.happened_at < params.until!);

    let offset = 0;
    if (params.cursor) {
      try { offset = parseInt(Buffer.from(params.cursor, 'base64').toString(), 10); } catch {}
    }
    const page = rows.slice(offset, offset + limit);
    const next_cursor =
      offset + limit < rows.length
        ? Buffer.from(String(offset + limit)).toString('base64')
        : null;

    return { items: page, next_cursor };
  }

  matrix(serviceFilter?: string): {
    generated_at: string;
    environments: string[];
    rows: Array<{ service: string; slots: Record<string, { current: DeploymentEvent; last_successful?: DeploymentEvent }> }>;
  } {
    let rows = this.events;
    if (serviceFilter) rows = rows.filter((e) => e.service === serviceFilter);

    const serviceSet = new Set<string>();
    const envSet = new Set<string>();
    for (const e of rows) { serviceSet.add(e.service); envSet.add(e.environment); }

    const ENV_ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];
    const services = [...serviceSet].sort();
    const environments = [...envSet].sort((a, b) => {
      const ia = ENV_ORDER.indexOf(a), ib = ENV_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    const matrixRows = services.map((service) => {
      const slots: Record<string, { current: DeploymentEvent; last_successful?: DeploymentEvent }> = {};
      for (const env of environments) {
        const slotEvents = rows
          .filter((e) => e.service === service && e.environment === env)
          .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime());
        if (slotEvents.length === 0) continue;
        const current = slotEvents[0];
        const lastSuccessful = current.status === 'success' ? undefined : slotEvents.find((e) => e.status === 'success');
        slots[env] = lastSuccessful ? { current, last_successful: lastSuccessful } : { current };
      }
      return { service, slots };
    });

    return { generated_at: new Date().toISOString(), environments, rows: matrixRows };
  }

  append(event: Omit<DeploymentEvent, 'id'>): DeploymentEvent {
    const row: DeploymentEvent = { id: makeUuid(), ...event };
    this.events.unshift(row);
    this.live$.next(row);
    return row;
  }
}

export const store = new EventStore();

// ── SSE live emitter ──────────────────────────────────────────────────────────

const sseTemplates: DemoSseTemplate[] = demoData.sse_templates as DemoSseTemplate[];
let _sseIdx = 0;

export function nextSseEvent(): DeploymentEvent {
  const tpl = sseTemplates[_sseIdx % sseTemplates.length];
  _sseIdx++;
  return store.append({ happened_at: new Date().toISOString(), ...tpl });
}
