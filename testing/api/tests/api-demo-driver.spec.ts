/**
 * API integration tests — real Dashboard.Api driven by the demo-driver.
 *
 * Unlike api-mock.spec.ts (which targets the in-memory mock at :3000), this
 * suite runs against the real stack — PostgreSQL + Dashboard.Api + demo-driver
 * + gateway — brought up by docker compose in CI
 * (.github/workflows/api-tests.yml). All traffic routes through the gateway:
 *   /api/*  -> Dashboard.Api      /demo/* -> demo-driver
 *
 * Each scenario uses the demo-driver control surface to seed / mutate the API,
 * then asserts the resulting real-API read state.
 *
 * Contract sources of truth:
 *   docs/api/openapi.yaml              — API contract
 *   docs/DEMO_DRIVER_SPECIFICATION.md  — /demo control surface
 *
 * Run locally:
 *   docker compose -f compose/docker-compose.yaml \
 *                  -f compose/docker-compose.demo.yaml \
 *                  -f compose/docker-compose.local.yaml \
 *                  --profile db --profile api --profile demo-driver --profile gateway \
 *                  up -d --build --wait
 *   cd testing/api && npm run test:integration
 */

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const DEMO = `${BASE}/demo`;

// Mirrors EMIT_INTERVAL_MS on the demo-driver container (workflow sets 1000;
// 8000 is the spec default for a local run).
const EMIT_INTERVAL_MS = Number(process.env.EMIT_INTERVAL_MS ?? 8000);

// Stack ops (ingest loops, polling) are slow relative to unit tests.
jest.setTimeout(120_000);

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  expect(res.ok).toBe(true);
  return res.json();
}

function demoPost(path: string, body?: unknown): Promise<Response> {
  return fetch(`${DEMO}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Poll GET /demo/status until the run terminates. Returns the final DemoStatus. */
async function waitForIngest(timeoutMs = 60_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await (await fetch(`${DEMO}/status`)).json();
    if (status.state === 'done')   return status;
    if (status.state === 'failed') throw new Error(`ingest failed: ${JSON.stringify(status)}`);
    if (Date.now() > deadline)     throw new Error(`ingest timed out in state=${status.state}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

/** Truncate all deployment data via the demo-driver -> POST /api/control/reset proxy. */
async function apiReset(): Promise<void> {
  const body = await (await demoPost('/api-reset')).json();
  expect(body.ok).toBe(true);            // { ok: true, http_status: 204 }
}

const STATUSES = ['in-progress', 'success', 'failure'];

// ─────────────────────────────────────────────────────────────────────────────
// Stack reachable through the gateway
// ─────────────────────────────────────────────────────────────────────────────

describe('Gateway routing', () => {
  it('proxies /api/* to the API (readyz 200)', async () => {
    const res = await fetch(`${BASE}/readyz`);
    expect(res.status).toBe(200);
  });

  it('proxies /demo/* to the demo-driver (status reachable)', async () => {
    const res = await fetch(`${DEMO}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(['idle', 'running', 'done', 'failed']).toContain(body.state);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — demo dataset ingest
// ─────────────────────────────────────────────────────────────────────────────

describe('Demo dataset ingest', () => {
  it('seeds the real API with the demo-set scenario', async () => {
    const res = await demoPost('/ingest', { dataset: 'demo', reset: true });
    expect(res.status).toBe(200);

    const final = await waitForIngest();
    expect(final.errors).toBe(0);
    expect(final.events_sent).toBeGreaterThan(0);
    expect(final.events_sent).toBe(final.events_total);

    // Discovery, listing and matrix all reflect the seeded data.
    const services = await getJson('/api/services');
    expect(services.items.length).toBeGreaterThanOrEqual(1);

    const deployments = await getJson('/api/deployments?limit=1');
    expect(Array.isArray(deployments.items)).toBe(true);
    expect(deployments.items.length).toBeGreaterThanOrEqual(1);

    const matrix = await getJson('/api/matrix');
    expect(matrix.rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — random dataset ingest
// ─────────────────────────────────────────────────────────────────────────────

describe('Random dataset ingest', () => {
  const COUNT = 5;   // number of service scenarios (DEMO_DRIVER_SPECIFICATION §4.3)

  it(`generates ${COUNT} services with full per-slot status coverage`, async () => {
    const res = await demoPost('/ingest', { dataset: 'random', reset: true, count: COUNT });
    expect(res.status).toBe(200);

    const final = await waitForIngest();
    expect(final.errors).toBe(0);
    expect(final.events_sent).toBeGreaterThan(0);

    // reset:true cleared the slate, so exactly COUNT distinct services exist.
    const services = await getJson('/api/services');
    expect(services.items.length).toBe(COUNT);

    const matrix = await getJson('/api/matrix');
    expect(matrix.rows.length).toBe(COUNT);

    // Every populated slot exposes a current event with a valid status.
    for (const row of matrix.rows) {
      expect(typeof row.service).toBe('string');
      for (const slot of Object.values(row.slots) as any[]) {
        expect(typeof slot.current.id).toBe('string');
        expect(STATUSES).toContain(slot.current.status);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — live event emission
// ─────────────────────────────────────────────────────────────────────────────

describe('Live event emission', () => {
  it('periodic emission appends new deployments over time', async () => {
    await apiReset();
    expect((await getJson('/api/deployments?limit=1')).items.length).toBe(0);

    const enabled = await (await demoPost('/emit', { enabled: true })).json();
    expect(enabled.emitting).toBe(true);

    // Let several ticks fire, then stop.
    await new Promise(r => setTimeout(r, EMIT_INTERVAL_MS * 3 + 2_000));

    const disabled = await (await demoPost('/emit', { enabled: false })).json();
    expect(disabled.emitting).toBe(false);

    const after = await getJson('/api/deployments?limit=50');
    expect(after.items.length).toBeGreaterThan(0);
    for (const item of after.items) {
      expect(STATUSES).toContain(item.status);
      expect(typeof item.happened_at).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — control reset
// ─────────────────────────────────────────────────────────────────────────────

describe('API reset via demo driver', () => {
  it('truncates all deployment data', async () => {
    // Arrange — ensure data is present.
    await demoPost('/ingest', { dataset: 'random', reset: true, count: 2 });
    await waitForIngest();
    expect((await getJson('/api/services')).items.length).toBe(2);

    // Act.
    await apiReset();

    // Assert — discovery and matrix are empty again.
    expect((await getJson('/api/services')).items.length).toBe(0);
    expect((await getJson('/api/matrix')).rows.length).toBe(0);
  });
});
