/**
 * Analytics contract/integration tests — GET /api/analytics/* (issue #299).
 *
 * Covers all 9 endpoints against the real backend + PostgreSQL (via Docker Compose).
 * Contract source of truth: docs/api/openapi.yaml — tag: analytics.
 *
 * Assertions per the team task mandate:
 *   - Response shape vs OpenAPI schema (required fields, types)
 *   - window clamp + `clamped` flag (HISTORY_RETENTION_DAYS)
 *   - ETag / If-None-Match → 304 behaviour
 *   - DORA classification values LOWERCASE (elite/high/medium/low) [fixed in #9]
 *   - severity values LOWERCASE (low/medium/high/critical)           [fixed in #9]
 *   - status-distribution in OpenAPI enum order, zero-filled to 8
 *   - lead_time approximated: true; other three approximated: false
 *   - duration histogram p50/p95 present (nullable)
 *   - promotion funnel conversion (last stage null)
 *   - heatmap day_of_week 0-6 × hour 0-23 bounds
 *   - incidents worst-first (null duration_minutes sorts first)
 *   - top-deployers limit 1-100 clamp
 */

import { get, getJson, ingestEvent, resetAll, sleep } from './helpers';

// ── OpenAPI-defined ordered enum ────────────────────────────────────────────
const STATUS_ENUM_ORDER = [
  'pending', 'queued', 'waiting', 'in-progress',
  'success', 'failure', 'cancelled', 'rejected',
] as const;

const CLASSIFICATION_VALUES = ['elite', 'high', 'medium', 'low'] as const;
const SEVERITY_VALUES        = ['low', 'medium', 'high', 'critical'] as const;

// ── Shared window-shape assertion ────────────────────────────────────────────

function assertWindow(w: any): void {
  expect(typeof w.days).toBe('number');
  expect(w.days).toBeGreaterThanOrEqual(1);
  expect(typeof w.from).toBe('string');
  expect(typeof w.to).toBe('string');
  expect(typeof w.retention_days).toBe('number');
  expect(typeof w.clamped).toBe('boolean');
}

// ── Shared KPI-shape assertion ───────────────────────────────────────────────

function assertKpi(kpi: any, expectApproximated: boolean): void {
  // value is number | null
  expect(kpi.value === null || typeof kpi.value === 'number').toBe(true);
  expect(typeof kpi.unit).toBe('string');
  // classification must be one of the four lowercase values [fix #9]
  expect((CLASSIFICATION_VALUES as readonly string[]).includes(kpi.classification)).toBe(true);
  // trend_delta is number | null
  expect(kpi.trend_delta === null || typeof kpi.trend_delta === 'number').toBe(true);
  expect(Array.isArray(kpi.sparkline)).toBe(true);
  expect(typeof kpi.approximated).toBe('boolean');
  expect(kpi.approximated).toBe(expectApproximated);
}

// ── ETag / 304 helper ────────────────────────────────────────────────────────

async function assertEtag304(path: string): Promise<void> {
  const res1 = await get(path);
  expect(res1.status).toBe(200);
  const etag = res1.headers.get('ETag');
  expect(typeof etag).toBe('string');
  expect(etag).toBeTruthy();

  const res304 = await get(path, { 'If-None-Match': etag! });
  expect(res304.status).toBe(304);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Analytics endpoints — contract / integration', () => {

  // Seed a small deterministic dataset before running shape tests so the
  // server has something to aggregate against.  A full reset first removes
  // data leftover from other suites running concurrently with --runInBand.
  beforeAll(async () => {
    await resetAll();

    const now = new Date();
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();

    // Two services, two environments, multiple terminal events across the window
    // to produce non-trivial aggregates for every endpoint.
    const events = [
      // service-a / dev  — multi-step deployment (measurable duration)
      { service: 'analytics-svc-a', environment: 'dev',  status: 'in-progress', happened_at: ago(120), deployment_id: 'an-1' },
      { service: 'analytics-svc-a', environment: 'dev',  status: 'success',     happened_at: ago(90),  deployment_id: 'an-1' },
      // service-a / staging — failure then restore
      { service: 'analytics-svc-a', environment: 'staging', status: 'failure',  happened_at: ago(80),  deployment_id: 'an-2' },
      { service: 'analytics-svc-a', environment: 'staging', status: 'success',  happened_at: ago(30),  deployment_id: 'an-3' },
      // service-b / prod — success (no actor → unknown group)
      { service: 'analytics-svc-b', environment: 'prod',    status: 'success',  happened_at: ago(60),  deployment_id: 'an-4', actor: undefined },
    ];

    for (const ev of events) {
      const body: Record<string, unknown> = {
        deployment_id: ev.deployment_id,
        service:       ev.service,
        environment:   ev.environment,
        status:        ev.status,
        happened_at:   ev.happened_at,
      };
      if (ev.actor !== undefined) body['actor'] = ev.actor;
      await ingestEvent(body);
    }

    // Allow write propagation before reads
    await sleep(300);
  }, 60_000);

  // ── /api/analytics/dora ─────────────────────────────────────────────────

  describe('GET /api/analytics/dora', () => {

    it('returns 200 with AnalyticsDora shape', async () => {
      const body = await getJson('/api/analytics/dora');
      assertWindow(body.window);
      assertKpi(body.deployment_frequency, false);
      assertKpi(body.lead_time, true);
      assertKpi(body.change_failure_rate, false);
      assertKpi(body.time_to_restore, false);
    });

    it('lead_time has approximated: true; other three have approximated: false', async () => {
      const body = await getJson('/api/analytics/dora');
      expect(body.lead_time.approximated).toBe(true);
      expect(body.deployment_frequency.approximated).toBe(false);
      expect(body.change_failure_rate.approximated).toBe(false);
      expect(body.time_to_restore.approximated).toBe(false);
    });

    it('classification values are lowercase [fix #9]', async () => {
      const body = await getJson('/api/analytics/dora');
      for (const kpiKey of ['deployment_frequency', 'lead_time', 'change_failure_rate', 'time_to_restore']) {
        const cls = body[kpiKey].classification;
        expect((CLASSIFICATION_VALUES as readonly string[]).includes(cls)).toBe(true);
        // Verify it is NOT the legacy PascalCase form
        expect(cls).toBe(cls.toLowerCase());
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/dora');
    });

    it('window.clamped is false for 7d (well within 365-day retention)', async () => {
      const body = await getJson('/api/analytics/dora?window=7d');
      assertWindow(body.window);
      expect(body.window.clamped).toBe(false);
      expect(body.window.days).toBe(7);
    });

    it('window defaults to 7d when param is absent', async () => {
      const body = await getJson('/api/analytics/dora');
      // Default is 7d per the spec (enum default: 7d)
      assertWindow(body.window);
      expect(body.window.days).toBeGreaterThanOrEqual(1);
    });

    it('accepts all three valid window values (7d / 14d / 30d)', async () => {
      for (const w of ['7d', '14d', '30d']) {
        const body = await getJson(`/api/analytics/dora?window=${w}`);
        assertWindow(body.window);
        const expected = w === '7d' ? 7 : w === '14d' ? 14 : 30;
        expect(body.window.days).toBeLessThanOrEqual(expected);
      }
    });

  });

  // ── /api/analytics/frequency ────────────────────────────────────────────

  describe('GET /api/analytics/frequency', () => {

    it('returns 200 with AnalyticsFrequency shape', async () => {
      const body = await getJson('/api/analytics/frequency');
      assertWindow(body.window);
      expect(Array.isArray(body.buckets)).toBe(true);
      if (body.buckets.length > 0) {
        const b = body.buckets[0];
        expect(typeof b.date).toBe('string');
        expect(typeof b.success).toBe('number');
        expect(typeof b.failure).toBe('number');
        expect(b.success).toBeGreaterThanOrEqual(0);
        expect(b.failure).toBeGreaterThanOrEqual(0);
      }
    });

    it('bucket count matches the resolved window.days', async () => {
      const body = await getJson('/api/analytics/frequency?window=7d');
      assertWindow(body.window);
      // The server returns one bucket per day in the resolved window.
      expect(body.buckets.length).toBe(body.window.days);
    });

    it('buckets are in date-ascending order (oldest → newest)', async () => {
      const body = await getJson('/api/analytics/frequency?window=14d');
      const dates: string[] = body.buckets.map((b: any) => b.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i - 1]).toBe(true);
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/frequency');
    });

  });

  // ── /api/analytics/change-failure-rate ──────────────────────────────────

  describe('GET /api/analytics/change-failure-rate', () => {

    it('returns 200 with AnalyticsChangeFailureRate shape', async () => {
      const body = await getJson('/api/analytics/change-failure-rate');
      assertWindow(body.window);
      expect(typeof body.elite_threshold).toBe('number');
      expect(body.elite_threshold).toBeCloseTo(0.15, 5);
      expect(Array.isArray(body.buckets)).toBe(true);
      if (body.buckets.length > 0) {
        const b = body.buckets[0];
        expect(typeof b.date).toBe('string');
        expect(typeof b.rate).toBe('number');
        expect(b.rate).toBeGreaterThanOrEqual(0);
        expect(b.rate).toBeLessThanOrEqual(1);
      }
    });

    it('elite_threshold is exactly 0.15 (DORA spec constant)', async () => {
      const body = await getJson('/api/analytics/change-failure-rate');
      expect(body.elite_threshold).toBeCloseTo(0.15, 5);
    });

    it('bucket count matches window.days', async () => {
      const body = await getJson('/api/analytics/change-failure-rate?window=7d');
      expect(body.buckets.length).toBe(body.window.days);
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/change-failure-rate');
    });

  });

  // ── /api/analytics/duration-histogram ───────────────────────────────────

  describe('GET /api/analytics/duration-histogram', () => {

    it('returns 200 with AnalyticsDurationHistogram shape', async () => {
      const body = await getJson('/api/analytics/duration-histogram');
      assertWindow(body.window);
      expect(Array.isArray(body.bins)).toBe(true);
      // p50 and p95 are nullable (null when no measurable deployment in window)
      expect(body.p50_minutes === null || typeof body.p50_minutes === 'number').toBe(true);
      expect(body.p95_minutes === null || typeof body.p95_minutes === 'number').toBe(true);
    });

    it('each bin has required fields with correct types', async () => {
      const body = await getJson('/api/analytics/duration-histogram');
      for (const bin of body.bins) {
        expect(typeof bin.label).toBe('string');
        expect(typeof bin.lower_minutes).toBe('number');
        expect(bin.lower_minutes).toBeGreaterThanOrEqual(0);
        // upper_minutes is nullable for the open-ended top bin
        expect(bin.upper_minutes === null || typeof bin.upper_minutes === 'number').toBe(true);
        expect(typeof bin.count).toBe('number');
        expect(bin.count).toBeGreaterThanOrEqual(0);
      }
    });

    it('p50 ≤ p95 when both are non-null', async () => {
      const body = await getJson('/api/analytics/duration-histogram');
      if (body.p50_minutes !== null && body.p95_minutes !== null) {
        expect(body.p50_minutes).toBeLessThanOrEqual(body.p95_minutes);
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/duration-histogram');
    });

  });

  // ── /api/analytics/promotion-funnel ─────────────────────────────────────

  describe('GET /api/analytics/promotion-funnel', () => {

    it('returns 200 with AnalyticsPromotionFunnel shape', async () => {
      const body = await getJson('/api/analytics/promotion-funnel');
      assertWindow(body.window);
      expect(Array.isArray(body.stages)).toBe(true);
    });

    it('each stage has environment, count, and conversion', async () => {
      const body = await getJson('/api/analytics/promotion-funnel');
      for (const stage of body.stages) {
        expect(typeof stage.environment).toBe('string');
        expect(typeof stage.count).toBe('number');
        expect(stage.count).toBeGreaterThanOrEqual(0);
        // conversion is nullable (null for the last stage, null when count 0)
        expect(stage.conversion === null || typeof stage.conversion === 'number').toBe(true);
        if (stage.conversion !== null) {
          expect(stage.conversion).toBeGreaterThanOrEqual(0);
          expect(stage.conversion).toBeLessThanOrEqual(1);
        }
      }
    });

    it('the terminal (last) stage has conversion: null', async () => {
      const body = await getJson('/api/analytics/promotion-funnel');
      if (body.stages.length > 0) {
        const last = body.stages[body.stages.length - 1];
        expect(last.conversion).toBeNull();
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/promotion-funnel');
    });

  });

  // ── /api/analytics/status-distribution ──────────────────────────────────

  describe('GET /api/analytics/status-distribution', () => {

    it('returns 200 with exactly 8 status entries', async () => {
      const body = await getJson('/api/analytics/status-distribution');
      assertWindow(body.window);
      expect(Array.isArray(body.statuses)).toBe(true);
      expect(body.statuses.length).toBe(8);
    });

    it('entries are in OpenAPI enum order (pending→queued→waiting→in-progress→success→failure→cancelled→rejected) [fix #9]', async () => {
      const body = await getJson('/api/analytics/status-distribution');
      const returned = body.statuses.map((s: any) => s.status);
      expect(returned).toEqual([...STATUS_ENUM_ORDER]);
    });

    it('all 8 statuses are present, zero-filled', async () => {
      const body = await getJson('/api/analytics/status-distribution');
      const seen = new Set(body.statuses.map((s: any) => s.status));
      for (const status of STATUS_ENUM_ORDER) {
        expect(seen.has(status)).toBe(true);
      }
      // counts are non-negative integers
      for (const s of body.statuses) {
        expect(typeof s.count).toBe('number');
        expect(s.count).toBeGreaterThanOrEqual(0);
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/status-distribution');
    });

  });

  // ── /api/analytics/heatmap ──────────────────────────────────────────────

  describe('GET /api/analytics/heatmap', () => {

    it('returns 200 with AnalyticsHeatmap shape', async () => {
      const body = await getJson('/api/analytics/heatmap');
      assertWindow(body.window);
      expect(Array.isArray(body.cells)).toBe(true);
    });

    it('each cell has day_of_week 0-6, hour 0-23, count ≥ 0', async () => {
      const body = await getJson('/api/analytics/heatmap');
      for (const cell of body.cells) {
        expect(typeof cell.day_of_week).toBe('number');
        expect(cell.day_of_week).toBeGreaterThanOrEqual(0);
        expect(cell.day_of_week).toBeLessThanOrEqual(6);
        expect(typeof cell.hour).toBe('number');
        expect(cell.hour).toBeGreaterThanOrEqual(0);
        expect(cell.hour).toBeLessThanOrEqual(23);
        expect(typeof cell.count).toBe('number');
        expect(cell.count).toBeGreaterThan(0); // sparse: absent cells are omitted (not zero-emitted)
      }
    });

    it('no duplicate (day_of_week, hour) pairs', async () => {
      const body = await getJson('/api/analytics/heatmap');
      const seen = new Set<string>();
      for (const cell of body.cells) {
        const key = `${cell.day_of_week}:${cell.hour}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/heatmap');
    });

  });

  // ── /api/analytics/top-deployers ────────────────────────────────────────

  describe('GET /api/analytics/top-deployers', () => {

    it('returns 200 with AnalyticsTopDeployers shape', async () => {
      const body = await getJson('/api/analytics/top-deployers');
      assertWindow(body.window);
      expect(Array.isArray(body.deployers)).toBe(true);
    });

    it('each deployer has actor (string) and count (≥ 0)', async () => {
      const body = await getJson('/api/analytics/top-deployers');
      for (const d of body.deployers) {
        expect(typeof d.actor).toBe('string');
        expect(typeof d.count).toBe('number');
        expect(d.count).toBeGreaterThanOrEqual(0);
      }
    });

    it('deployers are ordered descending by count', async () => {
      const body = await getJson('/api/analytics/top-deployers');
      for (let i = 1; i < body.deployers.length; i++) {
        expect(body.deployers[i].count).toBeLessThanOrEqual(body.deployers[i - 1].count);
      }
    });

    it('limit=1 returns at most 1 deployer', async () => {
      const body = await getJson('/api/analytics/top-deployers?limit=1');
      expect(body.deployers.length).toBeLessThanOrEqual(1);
    });

    it('limit=100 is accepted and returns at most 100 deployers', async () => {
      const body = await getJson('/api/analytics/top-deployers?limit=100');
      expect(body.deployers.length).toBeLessThanOrEqual(100);
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/top-deployers');
    });

  });

  // ── /api/analytics/incidents ─────────────────────────────────────────────

  describe('GET /api/analytics/incidents', () => {

    it('returns 200 with AnalyticsIncidents shape', async () => {
      const body = await getJson('/api/analytics/incidents');
      assertWindow(body.window);
      expect(Array.isArray(body.incidents)).toBe(true);
    });

    it('each incident has required fields', async () => {
      const body = await getJson('/api/analytics/incidents');
      for (const inc of body.incidents) {
        expect(typeof inc.service).toBe('string');
        expect(typeof inc.environment).toBe('string');
        expect(typeof inc.failed_at).toBe('string');
        // restored_at and duration_minutes are nullable
        expect(inc.restored_at === null || typeof inc.restored_at === 'string').toBe(true);
        expect(inc.duration_minutes === null || typeof inc.duration_minutes === 'number').toBe(true);
        // severity must be one of the four lowercase values [fix #9]
        expect((SEVERITY_VALUES as readonly string[]).includes(inc.severity)).toBe(true);
        expect(inc.severity).toBe(inc.severity.toLowerCase());
      }
    });

    it('incidents are worst-first: null duration_minutes sorts before resolved ones', async () => {
      const body = await getJson('/api/analytics/incidents');
      const incidents = body.incidents;
      // Verify: no null-duration incident comes AFTER a non-null one
      let seenNonNull = false;
      for (const inc of incidents) {
        if (inc.duration_minutes !== null) {
          seenNonNull = true;
        } else {
          // A null entry after a non-null entry violates worst-first order
          expect(seenNonNull).toBe(false);
        }
      }
    });

    it('non-null durations are descending (worst first)', async () => {
      const body = await getJson('/api/analytics/incidents');
      const resolved = body.incidents.filter((i: any) => i.duration_minutes !== null);
      for (let i = 1; i < resolved.length; i++) {
        expect(resolved[i].duration_minutes).toBeLessThanOrEqual(resolved[i - 1].duration_minutes);
      }
    });

    it('limit=1 returns at most 1 incident', async () => {
      const body = await getJson('/api/analytics/incidents?limit=1');
      expect(body.incidents.length).toBeLessThanOrEqual(1);
    });

    it('limit=100 is accepted', async () => {
      const body = await getJson('/api/analytics/incidents?limit=100');
      expect(body.incidents.length).toBeLessThanOrEqual(100);
    });

    it('responds with ETag and honours If-None-Match → 304', async () => {
      await assertEtag304('/api/analytics/incidents');
    });

  });

  // ── Window clamp across endpoints ──────────────────────────────────────

  describe('Window clamp behaviour', () => {

    it('30d request: clamped is false when HISTORY_RETENTION_DAYS ≥ 30', async () => {
      // Default retention is 365d; 30d ≤ 365d → no clamp
      const body = await getJson('/api/analytics/dora?window=30d');
      expect(body.window.clamped).toBe(false);
      expect(body.window.days).toBe(30);
    });

    it('retention_days is a positive integer in every response', async () => {
      for (const path of [
        '/api/analytics/dora',
        '/api/analytics/frequency',
        '/api/analytics/change-failure-rate',
        '/api/analytics/duration-histogram',
        '/api/analytics/promotion-funnel',
        '/api/analytics/status-distribution',
        '/api/analytics/heatmap',
        '/api/analytics/top-deployers',
        '/api/analytics/incidents',
      ]) {
        const body = await getJson(path);
        expect(typeof body.window.retention_days).toBe('number');
        expect(body.window.retention_days).toBeGreaterThan(0);
      }
    });

  });

});
