/**
 * Integration test — demo driver against mock server.
 *
 * Sources of truth:
 *   docs/DEMO_DRIVER_SPECIFICATION.md §9 (Integration layer)
 *   docs/MOCK_SPECIFICATION.md         §6 (control surface)
 *
 * Prerequisites (both must be running):
 *   cd frontend/mock   && npm run start:dev   # mock  → :3002
 *   cd demo/driver     && npm run start:dev   # driver → :3001
 *
 * Run:
 *   cd demo/driver && npm run test:e2e
 */

const MOCK_URL   = process.env.MOCK_URL          ?? 'http://localhost:3002';
const DRIVER_URL = process.env.DEMO_DRIVER_URL   ?? 'http://localhost:3001';

/** Maximum time (ms) to poll for state == done before failing. */
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

// ── Helpers ───────────────────────────────────────────────────────────────────

function driverGet(path: string): Promise<Response> {
  return fetch(`${DRIVER_URL}${path}`);
}

function driverPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`${DRIVER_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function mockPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`${MOCK_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function mockGet(path: string): Promise<Response> {
  return fetch(`${MOCK_URL}${path}`);
}

/** Poll GET /demo/status until state matches or timeout elapses. */
async function waitForState(
  target: string,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res  = await driverGet('/demo/status');
    const data = await res.json() as Record<string, unknown>;
    if (data.state === target) return data;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for state="${target}" after ${timeoutMs}ms`);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Restore a clean mock slate: demo data loaded, emitting off, fetcher cleared.
  await mockPost('/_mock/reset');
  // Reset demo driver to idle so each test starts from a known state.
  await driverPost('/demo/reset');
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Demo Driver — integration (mock target)', () => {

  it('GET /demo/status returns idle on startup', async () => {
    const res  = await driverGet('/demo/status');
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.state).toBe('idle');
  });

  it('GET /demo/scenarios lists at least demo-set', async () => {
    const res  = await driverGet('/demo/scenarios');
    const data = await res.json() as { items: string[] };

    expect(res.status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items).toContain('events');   // events.json → scenario name "events"
  });

  it('GET /demo/ serves the HTML control panel', async () => {
    const res = await driverGet('/demo/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('Demo Driver');
  });

  it('POST /demo/scenarios/events/run drives scenario to done and seeds mock', async () => {
    // Start the run (bulk mode — EMIT_DELAY_MS defaults to 0)
    const runRes  = await driverPost('/demo/scenarios/events/run', {});
    const runData = await runRes.json() as Record<string, unknown>;

    expect(runRes.status).toBe(200);
    expect(['running', 'done']).toContain(runData.state);

    // Wait for completion
    const finalStatus = await waitForState('done');

    expect(finalStatus.state).toBe('done');
    expect(finalStatus.errors).toBe(0);
    expect(Number(finalStatus.events_sent)).toBeGreaterThan(0);
    expect(Number(finalStatus.events_sent)).toBe(Number(finalStatus.events_total));

    // Assert mock received events — GET /api/services returns ≥ 1 service
    const svcRes  = await mockGet('/api/services');
    const svcData = await svcRes.json() as { items?: string[] };

    expect(svcRes.status).toBe(200);
    expect(Array.isArray(svcData.items)).toBe(true);
    expect((svcData.items ?? []).length).toBeGreaterThanOrEqual(1);
  }, POLL_TIMEOUT_MS + 10_000);

  it('POST /demo/scenarios/events/run is idempotent while running', async () => {
    // First call starts the run
    await driverPost('/demo/scenarios/events/run', {});

    // Second immediate call returns current status without double-starting
    const res2  = await driverPost('/demo/scenarios/events/run', {});
    const data2 = await res2.json() as Record<string, unknown>;

    expect(res2.status).toBe(200);
    // State is running (not a 4xx or reset to idle)
    expect(['running', 'done']).toContain(data2.state);

    await waitForState('done');
  }, POLL_TIMEOUT_MS + 10_000);

  it('POST /demo/scenarios/unknown/run returns 404', async () => {
    const res = await driverPost('/demo/scenarios/no-such-scenario/run', {});
    expect(res.status).toBe(404);
  });

  it('POST /demo/reset returns idle with zeroed counters', async () => {
    // Run to completion first
    await driverPost('/demo/scenarios/events/run', {});
    await waitForState('done');

    // Now reset
    const res  = await driverPost('/demo/reset');
    const data = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.state).toBe('idle');
    expect(data.events_sent).toBe(0);
    expect(data.errors).toBe(0);
    expect(data.started_at).toBeNull();
    expect(data.finished_at).toBeNull();
  }, POLL_TIMEOUT_MS + 10_000);

});
