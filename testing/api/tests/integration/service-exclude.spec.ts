/**
 * SERVICE_EXCLUDE black-box integration coverage (issue #348 / PR #382).
 *
 * Tests the end-to-end behaviour of the SERVICE_EXCLUDE env var on the real
 * composed stack (gateway → Dashboard.Api + Postgres). No mocks — all
 * assertions target HTTP endpoints.
 *
 * Contract sources of truth:
 *   docs/api/openapi.yaml              §/api/deployments post (403 response)
 *   docs/API_SPECIFICATION.md          §Deployment-wide service exclusion
 *   docs/api/api-guidelines.md         §SERVICE_EXCLUDE
 *   docs/design/behavior.md            §SERVICE_EXCLUDE
 *
 * Sentinel values set in compose/docker-compose.test.yaml:
 *   SERVICE_EXCLUDE: "svc-exclude-probe,probe-ns/probe-*"
 *
 *   Pattern 1 — "svc-exclude-probe"
 *     Slashless pattern: matches the service name "svc-exclude-probe" across
 *     every namespace. Tests case (a).
 *
 *   Pattern 2 — "probe-ns/probe-*"
 *     Composite glob: matches any service whose namespace/service identity
 *     starts with "probe-ns/probe-". Tests case (b).
 *
 * Verification that the sentinels are unused by any other fixture, driver, or
 * spec was performed by grep over the full repo — zero hits.
 *
 * Black-box limit: the read-filter's "hide already-stored" path cannot be
 * exercised here because the 403 on POST prevents any excluded event from
 * being stored. That path is covered by Dashboard.Api.Tests
 * (ServiceScopeFilterIntegrationTests). Here we assert 403 + absence.
 */

import { API_KEY, getJson, ingestEvent, minimalEvent, post, resetAll } from './helpers';

// ── Sentinel values (must stay in sync with compose/docker-compose.test.yaml) ──

/** Matched by the slashless pattern "svc-exclude-probe". */
const EXCLUDED_SERVICE_SLASHLESS = 'svc-exclude-probe';

/**
 * Service portion of the composite-pattern match "probe-ns/probe-*".
 * Identity "probe-ns/probe-svc" matches the pattern.
 */
const EXCLUDED_SERVICE_NS      = 'probe-svc';
const EXCLUDED_NAMESPACE       = 'probe-ns';

/**
 * Synthetic service that does NOT match any SERVICE_EXCLUDE pattern.
 * Used to verify the pass-through path (201) and that reads remain unaffected.
 */
const ALLOWED_SERVICE = 'allowed-probe-svc';

// ─────────────────────────────────────────────────────────────────────────────

describe('SERVICE_EXCLUDE — POST /api/deployments', () => {
  // Clean slate for each describe block; the exclude patterns are static config.
  beforeAll(() => resetAll());

  // (a) Slashless pattern: "svc-exclude-probe" matches the service name across
  //     all namespaces.
  it('(a) excluded by slashless pattern → 403', async () => {
    const res = await post(
      '/api/deployments',
      minimalEvent({ service: EXCLUDED_SERVICE_SLASHLESS }),
      { 'X-Api-Key': API_KEY },
    );
    expect(res.status).toBe(403);
  });

  it('(a) 403 body is problem+json', async () => {
    const res = await post(
      '/api/deployments',
      minimalEvent({ service: EXCLUDED_SERVICE_SLASHLESS }),
      { 'X-Api-Key': API_KEY },
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    // RFC 7807 problem document — status and title are required fields.
    expect(body.status).toBe(403);
    expect(typeof body.title).toBe('string');
  });

  // (b) Composite pattern: "probe-ns/probe-*" matches "probe-ns/probe-svc".
  it('(b) excluded by composite pattern (namespace/service glob) → 403', async () => {
    const res = await post(
      '/api/deployments',
      minimalEvent({ service: EXCLUDED_SERVICE_NS, namespace: EXCLUDED_NAMESPACE }),
      { 'X-Api-Key': API_KEY },
    );
    expect(res.status).toBe(403);
  });

  it('(b) composite pattern: a sub-variant matching the glob prefix → 403', async () => {
    // "probe-ns/probe-anything" must also be blocked — confirms * spans a suffix.
    const res = await post(
      '/api/deployments',
      minimalEvent({ service: 'probe-anything', namespace: EXCLUDED_NAMESPACE }),
      { 'X-Api-Key': API_KEY },
    );
    expect(res.status).toBe(403);
  });

  // (c) Non-matching event must pass through normally → 201.
  it('(c) non-matching service → 201', async () => {
    const dep = `allowed-${Date.now()}`;
    const res = await post(
      '/api/deployments',
      minimalEvent({ service: ALLOWED_SERVICE, deployment_id: dep }),
      { 'X-Api-Key': API_KEY },
    );
    expect(res.status).toBe(201);
  });

  it('(c) non-matching event appears in GET /api/deployments', async () => {
    const dep = `appear-${Date.now()}`;
    await ingestEvent({ service: ALLOWED_SERVICE, deployment_id: dep });

    const page = await getJson(`/api/deployments?deployment_id=${dep}`);
    expect(page.items.length).toBe(1);
    expect(page.items[0].service).toBe(ALLOWED_SERVICE);
  });

  it('(c) non-matching service appears in GET /api/services', async () => {
    // ingestEvent was already called above — the service must be visible.
    const body = await getJson('/api/services');
    const names: string[] = body.items.map((s: any) => s.service ?? s.name ?? s);
    expect(names).toContain(ALLOWED_SERVICE);
  });

  // (d) Excluded services must NOT appear in read endpoints.
  //     Because the 403 on POST prevents storage, absence is equivalent to the
  //     read-filter hiding stored rows — we assert it holds either way.
  it('(d) excluded service (slashless) never appears in GET /api/services', async () => {
    const body = await getJson('/api/services');
    const names: string[] = body.items.map((s: any) => s.service ?? s.name ?? s);
    expect(names).not.toContain(EXCLUDED_SERVICE_SLASHLESS);
  });

  it('(d) excluded service (composite) never appears in GET /api/services', async () => {
    const body = await getJson('/api/services');
    const names: string[] = body.items.map((s: any) => s.service ?? s.name ?? s);
    expect(names).not.toContain(EXCLUDED_SERVICE_NS);
  });

  it('(d) excluded service (slashless) returns empty list on GET /api/deployments?service=', async () => {
    const page = await getJson(`/api/deployments?service=${EXCLUDED_SERVICE_SLASHLESS}`);
    expect(page.items.length).toBe(0);
  });

  it('(d) excluded service (composite) returns empty list on GET /api/deployments?service=', async () => {
    const page = await getJson(`/api/deployments?service=${EXCLUDED_SERVICE_NS}`);
    expect(page.items.length).toBe(0);
  });
});
