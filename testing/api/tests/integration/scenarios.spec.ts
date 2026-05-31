/**
 * Scenario coverage — the **demo-driver** provisions realistic datasets; every
 * assertion targets the **Dashboard API** read surface that results.
 *
 * The demo-driver is the fixture (DEMO_DRIVER_SPECIFICATION.md §4):
 *   - demo dataset   — POST /demo/ingest { dataset: "demo", reset: true }
 *   - random dataset — POST /demo/ingest { dataset: "random", reset: true, count }
 *   - live emission  — POST /demo/emit  { enabled: true }
 *
 * Each describe block runs waitForDemoReady() in beforeEach as a settling
 * precondition: ensures the demo-driver is idle (no reset cycle in flight, no
 * ingest running) before each test starts.  This guards against cross-test and
 * cross-file reset settling even when reset:true exercises the full choreography
 * path end-to-end.
 */
import {
  getJson, resetAll, demoPost, waitForIngest, waitForDemoReady, sleep, EMIT_INTERVAL_MS, STATUSES,
} from './helpers';

describe('Scenario: demo dataset', () => {
  beforeEach(() => waitForDemoReady());

  it('seeds the API so discovery, listing and matrix are populated', async () => {
    const res = await demoPost('/ingest', { dataset: 'demo', reset: true });
    expect(res.status).toBe(200);

    const final = await waitForIngest();
    expect(final.errors).toBe(0);
    expect(final.events_sent).toBe(final.events_total);
    expect(final.events_sent).toBeGreaterThan(0);

    expect((await getJson('/api/services')).items.length).toBeGreaterThanOrEqual(1);
    expect((await getJson('/api/environments')).items.length).toBeGreaterThanOrEqual(1);
    expect((await getJson('/api/deployments?limit=1')).items.length).toBe(1);
    expect((await getJson('/api/matrix')).rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Scenario: random dataset', () => {
  const COUNT = 5;

  beforeEach(() => waitForDemoReady());

  it(`materialises ${COUNT} services with full per-slot status coverage`, async () => {
    const res = await demoPost('/ingest', { dataset: 'random', reset: true, count: COUNT });
    expect(res.status).toBe(200);

    const final = await waitForIngest();
    expect(final.errors).toBe(0);

    // reset:true cleared the slate -> exactly COUNT distinct services.
    expect((await getJson('/api/services')).items.length).toBe(COUNT);

    const matrix = await getJson('/api/matrix');
    expect(matrix.rows.length).toBe(COUNT);
    for (const row of matrix.rows) {
      for (const slot of Object.values(row.slots) as any[]) {
        expect(typeof slot.current.id).toBe('string');
        expect(STATUSES).toContain(slot.current.status);
      }
    }

    // Each slot emits historical events covering every status, so the listing
    // as a whole exercises all three states.
    const page = await getJson('/api/deployments?limit=500');
    const seen = new Set(page.items.map((e: any) => e.status));
    for (const s of STATUSES) expect(seen.has(s)).toBe(true);
  });
});

describe('Scenario: live emission', () => {
  beforeEach(() => waitForDemoReady());

  it('periodic random emission appends well-formed deployments to the API', async () => {
    await resetAll();
    expect((await getJson('/api/deployments?limit=1')).items.length).toBe(0);

    const on = await (await demoPost('/emit', { enabled: true })).json();
    expect(on.emitting).toBe(true);

    await sleep(EMIT_INTERVAL_MS * 3 + 2_000);

    await demoPost('/emit', { enabled: false });

    const page = await getJson('/api/deployments?limit=50');
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.deployment_id).toBe('string');
      expect(STATUSES).toContain(item.status);
      expect(typeof item.happened_at).toBe('string');
    }
    // Emitted events are discoverable through the API.
    expect((await getJson('/api/services')).items.length).toBeGreaterThanOrEqual(1);
  });
});
