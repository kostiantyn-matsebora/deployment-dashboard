/**
 * GitHub-fetcher integration scenario.
 *
 * Seed the github-emulator with the curated demo set → the REAL fetcher-host
 * backfills → assert the resulting Dashboard API state.
 *
 * Contract sources of truth:
 *   docs/api/openapi.yaml                    — API contract (wins on any conflict)
 *   docs/GITHUB_EMULATOR_SPECIFICATION.md    — emulator control surface, demo fixture
 *   docs/DEMO_DRIVER_SPECIFICATION.md §5     — /demo/github/* proxy routes
 *   docs/FETCHER_SPECIFICATION.md            — F10 (parent_deployments), F15 (version)
 *
 * Isolation guarantees:
 *   • docker-compose.test.yaml sets SEED_ON_STARTUP=false → emulator starts empty.
 *     The real fetcher backfills nothing on startup, so demo-driver and
 *     reset-choreography specs see no phantom fetcher data.
 *   • beforeAll runs one-time setup: resetAll → waitForDemoReady → seed → wait
 *     for backfill. All it-blocks are independent reads against the settled state.
 *   • afterAll (and on-failure path) clears the emulator and calls resetAll(),
 *     leaving an empty store + empty API for any spec that runs afterwards.
 *     Jest runs --runInBand so this ordering is deterministic.
 *   • The reset gate ignores the fetcher's acks (ExpectedComponents = ["api-test-reset"]),
 *     so resetAll() is not blocked by the fetcher's presence.
 *
 * Fixture facts (demo/data/github/fixtures.json):
 *   • 10 repos → 10 distinct services after backfill.
 *   • payments-api: dev→staging→qa→preprod→prod needs chain (run_id 4830).
 *     Staging deployment id = 4830002 → deployment_id "gh-deploy-4830002";
 *     parent_deployments = ["gh-deploy-4830001"] (the dev deployment).
 *   • search-indexer: artifact:version.txt with content "v0.8.0" on every
 *     deployment (F15). All search-indexer events have version "v0.8.0".
 *   • X-Progress-Reporter "dashboard-fetcher/github-actions" is stored as
 *     progress_reporter on each fetcher-posted event (API data-model column;
 *     returned in the DeploymentEvent read response body).
 */

import { getJson, post, resetAll, sleep, waitForDemoReady } from './helpers';

const DEMO_GITHUB_SEED   = '/demo/github/seed';
const DEMO_GITHUB_CLEAR  = '/demo/github/clear';
const DEMO_GITHUB_STATUS = '/demo/github/status';

// ── Emulator helpers ──────────────────────────────────────────────────────────

async function seedEmulator(dataset: 'demo' | 'random' = 'demo'): Promise<any> {
  const res = await post(DEMO_GITHUB_SEED, { dataset });
  if (!res.ok) throw new Error(`seed emulator -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function clearEmulator(): Promise<void> {
  const res = await post(DEMO_GITHUB_CLEAR);
  if (!res.ok) throw new Error(`clear emulator -> ${res.status}: ${await res.text()}`);
}

async function emulatorStatus(): Promise<any> {
  return getJson(DEMO_GITHUB_STATUS);
}

// ── Generic polling helper ────────────────────────────────────────────────────

/**
 * Poll `fn` every `intervalMs` until it returns a truthy value or `timeoutMs`
 * elapses. Returns the truthy value; throws on timeout.
 */
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

// ── Expected fixture constants ────────────────────────────────────────────────

/** Number of distinct services in the demo fixture (one per repo). */
const EXPECTED_SERVICE_COUNT = 10;

/**
 * payments-api staging deployment_id (derived from fixture deployment id 4830002).
 * The fetcher formats deployment_id as "gh-deploy-{GitHub deployment id}".
 */
const PAYMENTS_STAGING_DEPLOYMENT_ID = 'gh-deploy-4830002';

/**
 * payments-api dev deployment_id (derived from fixture deployment id 4830001).
 * Expected parent of the staging deployment — confirms F10 needs-chain derivation.
 */
const PAYMENTS_DEV_DEPLOYMENT_ID = 'gh-deploy-4830001';

/** search-indexer version string resolved from the version.txt artifact (F15). */
const SEARCH_INDEXER_VERSION = 'v0.8.0';

/** X-Progress-Reporter value sent by the fetcher on every POST /api/deployments. */
const FETCHER_REPORTER = 'dashboard-fetcher/github-actions';

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario: GitHub emulator → fetcher backfill → API state', () => {

  // One-time setup: reset → wait for demo-driver ready → seed → wait for
  // backfill to complete. All it-blocks are independent reads against this
  // already-settled state, so a single setup failure does not cascade into
  // spurious assertion failures in subsequent tests.
  //
  // waitForDemoReady() is the critical guard: resetAll() resolves when the API
  // emits reset-completed, but the demo-driver unblocks its /demo/* surface
  // slightly later (async). Seeding immediately after resetAll() races this
  // unblock and hits the 503 reset gate. waitForDemoReady() polls /demo/status
  // until reset_state==idle && state!=='running', ensuring the /demo/* surface
  // is fully open before any mutator call.
  beforeAll(async () => {
    await resetAll();
    await waitForDemoReady();

    // Seed the emulator and verify repos are visible.
    const seedStatus = await seedEmulator('demo');
    expect(seedStatus).toBeDefined();

    const status = await emulatorStatus();
    expect(typeof status.repos).toBe('number');
    expect(status.repos).toBeGreaterThan(0);

    // Wait for the fetcher to backfill all 10 services into the API.
    // The fetcher polls every POLL_INTERVAL_SECONDS=2s (test override) and
    // triggers a full backfill on its first cycle (null cursor → F14).
    // 120 s gives headroom for 10 repos × ~1-2 poll cycles each.
    await waitFor(
      async () => {
        const body = await getJson('/api/services');
        return body.items.length >= EXPECTED_SERVICE_COUNT ? body.items : null;
      },
      { timeoutMs: 120_000, intervalMs: 2_000, label: `services count >= ${EXPECTED_SERVICE_COUNT}` },
    );
  }, 150_000);

  afterAll(async () => {
    // Clean up regardless of pass/fail so subsequent specs see no stale data.
    // waitForDemoReady() guards the clear call against the same 503 race that
    // originally caused the seed failure; suppress errors so afterAll always
    // proceeds to resetAll().
    await waitForDemoReady().catch(() => {});
    try { await clearEmulator(); } catch { /* best-effort */ }
    await resetAll();
  });

  it('API has exactly 10 services after backfill', async () => {
    const body = await getJson('/api/services');
    expect(body.items.length).toBe(EXPECTED_SERVICE_COUNT);
  });

  it('payments-api staging deployment has a non-empty parent_deployments (F10)', async () => {
    // The fetcher derives parent_deployments from the workflow YAML needs graph (F10).
    // payments-api workflow: deploy-staging needs deploy-dev.
    // deployment_id format: "gh-deploy-{GitHub deployment id}".
    // Staging → parent = dev deployment ("gh-deploy-4830001").
    //
    // Contract: DeploymentEventIngest.required does NOT include parent_deployments.
    // Sending [] and omitting the field are semantically equivalent; the API
    // serialises with null-omission so the field is ABSENT (undefined) when empty —
    // NOT []. Use `?? []` to handle the absent-when-empty case correctly.
    const page = await getJson(`/api/deployments?service=payments-api&environment=staging&limit=50`);
    expect(page.items.length).toBeGreaterThan(0);

    // Find the specific staging event by deployment_id.
    const stagingEvent = page.items.find(
      (e: any) => e.deployment_id === PAYMENTS_STAGING_DEPLOYMENT_ID,
    );
    expect(stagingEvent).toBeDefined();

    // The dev parent must be present in parent_deployments once the backfill
    // fix lands. `?? []` is contract-correct: if the field is absent (empty),
    // toContain on [] fails and surfaces the regression.
    expect(stagingEvent.parent_deployments ?? []).toContain(PAYMENTS_DEV_DEPLOYMENT_ID);
  });

  it('search-indexer deployments carry version resolved from artifact (F15)', async () => {
    // The fetcher is configured with GITHUB_VERSION_SOURCE="artifact:version.txt"
    // (demo compose override). Every search-indexer deployment in the fixture has
    // a version.txt artifact with content "v0.8.0".
    const page = await getJson(`/api/deployments?service=search-indexer&limit=50`);
    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items as any[]) {
      expect(item.version).toBe(SEARCH_INDEXER_VERSION);
    }
  });

  it('fetcher-sourced events carry progress_reporter "dashboard-fetcher/github-actions"', async () => {
    // The fetcher sends X-Progress-Reporter: dashboard-fetcher/github-actions on
    // every POST /api/deployments (FETCHER_SPEC §1). The API stores this as the
    // progress_reporter column and returns it in the DeploymentEvent read response.
    // Asserting this field confirms the data originates from the fetcher, not the
    // demo-driver (which would send "demo-driver/demo" or similar).
    const page = await getJson(`/api/deployments?service=payments-api&limit=50`);
    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items as any[]) {
      expect(item.progress_reporter).toBe(FETCHER_REPORTER);
    }
  });

  it('matrix reflects the GitHub-sourced dataset', async () => {
    // GET /api/matrix must return rows for all 10 services with at least one
    // slot each (GITHUB_EMULATOR_SPEC §7 guarantees every service has deployments).
    const matrix = await getJson('/api/matrix');
    expect(matrix.rows.length).toBe(EXPECTED_SERVICE_COUNT);

    for (const row of matrix.rows as any[]) {
      expect(typeof row.service).toBe('string');
      expect(Object.keys(row.slots).length).toBeGreaterThan(0);

      for (const slot of Object.values(row.slots) as any[]) {
        expect(typeof slot.current.id).toBe('string');
        expect(['in-progress', 'success', 'failure']).toContain(slot.current.status);
      }
    }
  });
});
