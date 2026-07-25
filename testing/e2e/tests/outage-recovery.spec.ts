/**
 * E2E scenario — outage recovery via `POST /api/control/recover` driven through the REAL
 * fetcher-host + github-emulator (issue #423, §5.10.6).
 *
 * Unlike the `mockup`/`live-app` Playwright projects (which run against the NestJS mock server
 * + Angular SPA — see playwright.config.ts's `webServer` block), this scenario is a black-box
 * API test against the REAL backend stack (Dashboard.Api + PostgreSQL + demo-driver +
 * github-emulator + fetcher-host), reached through the gateway — the same target
 * `testing/api`'s integration suite drives (see `testing/api/tests/integration/
 * github-fetcher.spec.ts` and `recover.spec.ts`, which this scenario complements: those cover
 * the control-plane contract in isolation; this exercises the full outage→recover→re-poll loop
 * end-to-end through the real fetcher and a real (emulated) upstream).
 *
 * Uses the `outage-recovery` Playwright project (see playwright.config.ts) — no browser page is
 * created (only `request`-less global `fetch`, mirroring testing/api's helpers), so this spec
 * carries none of the mockup/live-app webServer overhead in terms of assertions, though the
 * shared `webServer` array still boots those unrelated servers (documented pre-existing
 * "acceptable overhead" for the `mockup` project in playwright.config.ts).
 *
 * Spec references:
 *   docs/api/openapi.yaml                    — POST /api/control/recover contract
 *   docs/API_SPECIFICATION.md §5.10.6        — recover choreography
 *   docs/GITHUB_EMULATOR_SPECIFICATION.md §6 — seed / emit control surface
 *   docs/DEMO_DRIVER_SPECIFICATION.md §5     — /demo/github/* proxy routes
 *
 * Scenario:
 *   1. Reset to a clean slate; seed the emulator's curated demo dataset; wait for the real
 *      fetcher to complete its initial backfill (steady state — pre-outage baseline).
 *   2. Simulate outage-window activity: enable emulator live emission for a few seconds so
 *      NEW deployments land in the (emulated) upstream with `created_at=now` — data that
 *      exists upstream but whose ingestion timing is now uncertain (mirrors "things happened
 *      while a component was degraded").
 *   3. POST /api/control/recover with a `since` that covers the ENTIRE dataset history
 *      (days_back far exceeding the fixture's age) — the non-destructive rewind that forces
 *      the fetcher's cursor back to an incremental (not backfill) re-poll of the full window.
 *   4. Drive the choreography via the control stream (recover-initiated → recover-started →
 *      recover-completed, `since` carried in the completed frame's payload) and wait for the
 *      real fetcher to react (ControlStreamListener → RewindTo → RewindAndResume → re-poll).
 *   5. Assert data continuity: every service's deployment count after recovery is at least the
 *      pre-outage-window baseline (no data lost; the rewind-triggered re-poll is idempotent/
 *      additive-safe) AND at least the post-emission count (the newly emitted deployments are
 *      picked up).
 *
 * NOTE: Docker is not available in the development environment — this suite typechecks
 * cleanly (`tsc --noEmit`) and is discovered by `playwright test --list`, but executes only in
 * CI (or locally) where the full compose stack (db + api + demo-driver + gateway +
 * github-emulator + fetcher-host) is running. No workflow currently wires `testing/e2e/**`
 * changes to a stack that includes the real backend/emulator (only the `extension` CI job is
 * triggered by this path today) — running this scenario requires the same compose profile
 * `testing/api`'s `_api-tests` workflow already brings up
 * (`db,api,demo-driver,gateway,github-emulator,fetcher-host`); wiring that is a CI/infra
 * change, out of this testing lane's `backend/tests/**`, `testing/api/**`, `testing/e2e/**`
 * scope.
 */

import { test, expect } from '@playwright/test';

// ── Config (mirrors testing/api/tests/integration/helpers.ts conventions) ────

const BASE = process.env['BASE_URL'] ?? 'http://localhost:8080';
const DEMO = `${BASE}/demo`;
const API_KEY = process.env['API_KEY'] ?? 'demo-api-key';
const CONTROL_KEY = process.env['CONTROL_API_KEY'] ?? 'demo-control-key';

type Headers = Record<string, string>;

function get(path: string, headers: Headers = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers });
}

function post(path: string, body?: unknown, headers: Headers = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function getJson(path: string, headers: Headers = {}): Promise<any> {
  const res = await get(path, headers);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 90_000, intervalMs = 1_500, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result as T;
    if (Date.now() > deadline) throw new Error(`waitFor("${label}") timed out after ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}

// ── SSE (mirrors testing/api's readControlSseUntil) ───────────────────────────

interface SseFrame { event?: string; id?: string; data?: string }

function parseFrame(raw: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) frame.event = line.slice(6).trim();
    else if (line.startsWith('id:')) frame.id = line.slice(3).trim();
    else if (line.startsWith('data:')) frame.data = (frame.data ?? '') + line.slice(5).trim();
  }
  return frame;
}

async function readControlSseUntil(
  match: (frame: SseFrame) => boolean,
  timeoutMs = 30_000,
): Promise<SseFrame> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/control/stream`, {
      headers: { Accept: 'text/event-stream', 'X-Control-API-Key': CONTROL_KEY },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`SSE /api/control/stream -> ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (match(frame)) return frame;
      }
    }
    throw new Error('SSE /api/control/stream closed before a matching frame');
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

// ── Control-plane helpers ──────────────────────────────────────────────────────

async function resetAll(): Promise<void> {
  const completedPromise = readControlSseUntil(f => f.event === 'reset-completed', 20_000);
  let res = await post('/api/control/reset', undefined, { 'X-Control-API-Key': CONTROL_KEY });
  if (res.status === 409) {
    await completedPromise;
    await sleep(200);
    return resetAll();
  }
  if (res.status !== 202) throw new Error(`control reset -> ${res.status}: ${await res.text()}`);
  const { correlation_id } = await res.json() as { correlation_id: string };
  const ackRes = await post('/api/control/events', {
    event_type: 'reset-ack', state: 'paused', occurred_at: new Date().toISOString(),
  }, { 'X-Api-Key': API_KEY, 'X-Component-Id': 'e2e-outage-recovery', 'X-Correlation-Id': correlation_id });
  if (ackRes.status !== 204) throw new Error(`reset-ack -> ${ackRes.status}`);
  await completedPromise;
}

interface RecoverAccepted { correlation_id: string; state: string; since: string; accepted_at: string }

/** Drive a full recover cycle (days_back-based) to completion; returns the resolved body. */
async function recoverAll(daysBack: number): Promise<RecoverAccepted> {
  const completedPromise = readControlSseUntil(f => f.event === 'recover-completed', 60_000);
  const res = await post('/api/control/recover', { days_back: daysBack }, { 'X-Control-API-Key': CONTROL_KEY });
  if (res.status !== 202) throw new Error(`control recover -> ${res.status}: ${await res.text()}`);
  const body = await res.json() as RecoverAccepted;

  const ackRes = await post('/api/control/events', {
    event_type: 'recover-ack', state: 'paused', occurred_at: new Date().toISOString(),
  }, { 'X-Api-Key': API_KEY, 'X-Component-Id': 'e2e-outage-recovery', 'X-Correlation-Id': body.correlation_id });
  if (ackRes.status !== 204) throw new Error(`recover-ack -> ${ackRes.status}`);

  const completedFrame = await completedPromise;
  const completedData = JSON.parse(completedFrame.data as string);
  expect(completedData.type).toBe('recover-completed');
  expect(completedData.correlation_id).toBe(body.correlation_id);
  expect(completedData.payload?.since).toBeTruthy();

  return body;
}

// ── Emulator helpers (mirrors testing/api's github-fetcher.spec.ts) ──────────

async function seedEmulator(dataset: 'demo' | 'random' = 'demo'): Promise<void> {
  const res = await post('/demo/github/seed', { dataset, reset: true });
  if (!res.ok) throw new Error(`seed emulator -> ${res.status}: ${await res.text()}`);
}

async function clearEmulator(): Promise<void> {
  const res = await post('/demo/github/clear');
  if (!res.ok) throw new Error(`clear emulator -> ${res.status}: ${await res.text()}`);
}

async function setEmission(enabled: boolean): Promise<void> {
  const res = await post('/demo/github/emit', { enabled });
  if (!res.ok) throw new Error(`set emission -> ${res.status}: ${await res.text()}`);
}

async function emulatorStatus(): Promise<{ deployments: number; repos: number }> {
  return getJson('/demo/github/status');
}

async function waitForDemoReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getJson('/demo/status');
    if (status.reset_state === 'idle' && status.state !== 'running') return;
    if (Date.now() > deadline) {
      throw new Error(`waitForDemoReady timed out: reset_state=${status.reset_state} state=${status.state}`);
    }
    await sleep(500);
  }
}

async function totalDeploymentCount(): Promise<number> {
  const services = await getJson('/api/services');
  let total = 0;
  for (const svc of services.items as Array<{ name: string }>) {
    const page = await getJson(`/api/deployments?service=${encodeURIComponent(svc.name)}&limit=200`);
    total += page.items.length;
  }
  return total;
}

// ── Scenario ─────────────────────────────────────────────────────────────────

test.describe('Outage recovery — POST /api/control/recover through the real fetcher + github-emulator', () => {
  test.setTimeout(240_000);

  test('recover rewinds the fetcher cursor and re-establishes data continuity after an outage window', async () => {
    // 1. Clean slate → seed → wait for initial backfill (pre-outage steady state).
    await resetAll();
    await waitForDemoReady();
    await seedEmulator('demo');

    const seedStatus = await emulatorStatus();
    expect(seedStatus.repos).toBeGreaterThan(0);

    await waitFor(
      async () => {
        const body = await getJson('/api/services');
        return body.items.length >= seedStatus.repos ? body.items : null;
      },
      { timeoutMs: 120_000, intervalMs: 2_000, label: 'initial backfill: services >= seeded repos' },
    );

    const baselineCount = await waitFor(
      async () => {
        const n = await totalDeploymentCount();
        return n > 0 ? n : null;
      },
      { timeoutMs: 30_000, intervalMs: 2_000, label: 'baseline deployment count > 0' },
    );

    // 2. Simulate outage-window activity: brief live emission adds new upstream deployments.
    await setEmission(true);
    await sleep(5_000);
    await setEmission(false);

    // 3 + 4. Recover: rewind since = the entire dataset's history, drive the choreography,
    // and let the real fetcher's ControlStreamListener react (RewindTo → RewindAndResume).
    const accepted = await recoverAll(3650);
    expect(new Date(accepted.since).getTime()).toBeLessThan(Date.now());

    // 5. Data continuity: the post-recovery count must reach at least the count observed
    // right after the emission window (nothing lost across the rewind + re-poll cycle) —
    // and strictly more than the pre-emission baseline (the "outage" activity was recovered).
    await waitFor(
      async () => {
        const n = await totalDeploymentCount();
        return n > baselineCount ? n : null;
      },
      { timeoutMs: 90_000, intervalMs: 3_000, label: 'post-recovery deployment count > pre-emission baseline' },
    );
  });

  test.afterAll(async () => {
    await waitForDemoReady().catch(() => {});
    try { await clearEmulator(); } catch { /* best-effort */ }
    await resetAll().catch(() => {});
  });
});
