/**
 * Shared helpers for the real-API integration suite.
 *
 * Target under test: **Dashboard.Api** (the real backend + PostgreSQL), reached
 * through the gateway (single public surface) at BASE_URL. The demo-driver is a
 * *fixture* used to provision realistic scenarios (demo dataset, random dataset,
 * live emission) — it is never the assertion target; every assertion is on an
 * API endpoint.
 *
 * Contract sources of truth:
 *   docs/api/openapi.yaml              — API contract (wins on any conflict)
 *   docs/API_SPECIFICATION.md          — decisions / behaviour
 *   docs/DEMO_DRIVER_SPECIFICATION.md  — /demo fixture control surface
 *
 * Brought up by .github/workflows/api-tests.yml (docker compose: db + api +
 * demo-driver + gateway). Run locally with the stack up:
 *   cd testing/api && npm run test:integration
 */

export const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
export const DEMO = `${BASE}/demo`;

// Match compose/docker-compose.demo.yaml. Overridable for non-demo stacks.
export const API_KEY     = process.env.API_KEY     ?? 'demo-api-key';
export const CONTROL_KEY = process.env.CONTROL_API_KEY ?? 'demo-control-key';

// Mirrors EMIT_INTERVAL_MS on the demo-driver container (CI sets 1000).
export const EMIT_INTERVAL_MS = Number(process.env.EMIT_INTERVAL_MS ?? 8000);

export const STATUSES = ['in-progress', 'success', 'failure'] as const;

// ── HTTP ──────────────────────────────────────────────────────────────────────

type Headers = Record<string, string>;

export function get(path: string, headers: Headers = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers });
}

export function post(path: string, body?: unknown, headers: Headers = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function put(path: string, body?: unknown, headers: Headers = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function getJson(path: string, headers: Headers = {}): Promise<any> {
  const res = await get(path, headers);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

// ── Deployment ingest ─────────────────────────────────────────────────────────

let seq = 0;

/** Minimal valid DeploymentEventIngest body with a unique deployment_id. */
export function minimalEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  seq += 1;
  return {
    deployment_id: `it-${Date.now()}-${seq}`,
    service:       'it-svc',
    environment:   'dev',
    status:        'success',
    happened_at:   new Date().toISOString(),
    ...overrides,
  };
}

/** POST a deployment with the demo API key; assert 201; return the created DeploymentEvent. */
export async function ingestEvent(overrides: Record<string, unknown> = {}): Promise<any> {
  const res = await post('/api/deployments', minimalEvent(overrides), { 'X-Api-Key': API_KEY });
  if (res.status !== 201) throw new Error(`ingest -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Clean slate ───────────────────────────────────────────────────────────────

/** Truncate all data via the control surface; assert 204. */
export async function resetAll(): Promise<void> {
  const res = await post('/api/control/reset', undefined, { 'X-Control-API-Key': CONTROL_KEY });
  if (res.status !== 204) throw new Error(`control reset -> ${res.status}`);
}

// ── Demo-driver fixtures (scenario provisioning) ──────────────────────────────

export function demoPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`${DEMO}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Poll GET /demo/status until the ingest run terminates; return the final DemoStatus. */
export async function waitForIngest(timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await (await fetch(`${DEMO}/status`)).json();
    if (status.state === 'done')   return status;
    if (status.state === 'failed') throw new Error(`ingest failed: ${JSON.stringify(status)}`);
    if (Date.now() > deadline)     throw new Error(`ingest timed out in state=${status.state}`);
    await sleep(500);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── SSE ───────────────────────────────────────────────────────────────────────

export interface SseFrame { event?: string; id?: string; data?: string }

/**
 * Open an SSE connection and read frames until `match` returns true or timeout.
 * Returns the matched frame. Always aborts the connection before resolving.
 */
export async function readSseUntil(
  path: string,
  match: (frame: SseFrame) => boolean,
  opts: { headers?: Headers; timeoutMs?: number } = {},
): Promise<SseFrame> {
  const { headers = {}, timeoutMs = 15_000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'text/event-stream', ...headers }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`SSE ${path} -> ${res.status}`);
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (match(frame)) return frame;
      }
    }
    throw new Error(`SSE ${path} closed before a matching frame`);
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

function parseFrame(raw: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) frame.event = line.slice(6).trim();
    else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
    else if (line.startsWith('data:')) frame.data = (frame.data ?? '') + line.slice(5).trim();
  }
  return frame;
}
