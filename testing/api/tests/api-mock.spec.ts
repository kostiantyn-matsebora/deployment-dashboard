/**
 * API contract tests — mock server (`frontend/mock`).
 *
 * Contract source of truth: docs/api/openapi.yaml
 * Mock spec:                docs/MOCK_SPECIFICATION.md
 *
 * Prerequisite: mock server running on port 3000.
 *   cd frontend/mock && npm run start:dev
 *
 * Run:
 *   cd testing/api && npx jest
 */

const BASE    = 'http://localhost:3000';
const API_KEY = 'dev-secret';           // MOCK_SPECIFICATION.md §4

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers });
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function put(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Minimal valid DeploymentEventIngest body. Unique deployment_id per call. */
function minimalEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deployment_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    service:       'test-svc',
    environment:   'dev',
    status:        'success',
    happened_at:   new Date().toISOString(),
    ...overrides,
  };
}

// ── Global beforeEach — restore deterministic clean slate ─────────────────────

beforeEach(async () => {
  // MOCK_SPECIFICATION.md §6.1 — restores: emitting=false, demo_enabled=true,
  // event_count=demo-baseline, fetcher_adapters=[]
  await post('/_mock/reset');
});

// ─────────────────────────────────────────────────────────────────────────────
// Ops
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /healthz', () => {
  it('returns 200', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
  });

  it('body is { status: "ok" }', async () => {
    const body = await (await get('/healthz')).json();
    expect(body.status).toBe('ok');
  });
});

describe('GET /readyz', () => {
  it('returns 200', async () => {
    const res = await get('/readyz');
    expect(res.status).toBe(200);
  });

  it('body.status is "ready"', async () => {
    const body = await (await get('/readyz')).json();
    expect(body.status).toBe('ready');
  });

  it('checks is an object whose values are ok or fail', async () => {
    const body = await (await get('/readyz')).json();
    expect(body.checks !== null && typeof body.checks === 'object').toBe(true);
    // openapi.yaml Readiness: checks.additionalProperties enum [ok, fail]
    expect(
      Object.values(body.checks as Record<string, string>).every(v => v === 'ok' || v === 'fail'),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Write — POST /api/deployments
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/deployments', () => {

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns 201 with a valid body', async () => {
    const res = await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(201);
  });

  it('response body is a DeploymentEvent with server-assigned id', async () => {
    const payload = minimalEvent();
    const body = await (await post('/api/deployments', payload, { 'X-Api-Key': API_KEY })).json();
    expect(typeof body.id).toBe('string');
    expect(body.deployment_id).toBe(payload.deployment_id);
    expect(body.service).toBe(payload.service);
    expect(body.environment).toBe(payload.environment);
    expect(body.status).toBe(payload.status);
  });

  it('response includes Location header pointing to the created event', async () => {
    const res  = await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY });
    const body = await res.json();
    expect(res.headers.get('location')).toBe(`/api/deployments/${body.id}`);
  });

  it('optional fields are round-tripped on 201', async () => {
    const payload = minimalEvent({
      version:            '2.0.0',
      actor:              'alice',
      run_number:         '9999',
      sha:                'deadbeef',
      ref:                'refs/heads/main',
      run_url:            'https://example.com/runs/9999',
      parent_deployments: ['gh-0001'],
    });
    const body = await (await post('/api/deployments', payload, { 'X-Api-Key': API_KEY })).json();
    expect(body.version).toBe('2.0.0');
    expect(body.actor).toBe('alice');
    expect(body.parent_deployments).toEqual(['gh-0001']);
  });

  // ── Auth errors (401) ────────────────────────────────────────────────────────

  it('returns 401 when X-Api-Key is absent', async () => {
    const res = await post('/api/deployments', minimalEvent());
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-Api-Key is wrong', async () => {
    const res = await post('/api/deployments', minimalEvent(), { 'X-Api-Key': 'bad-key' });
    expect(res.status).toBe(401);
  });

  it('401 body conforms to Problem+JSON', async () => {
    const body = await (await post('/api/deployments', minimalEvent())).json();
    expect(body.status).toBe(401);
    expect(typeof body.title).toBe('string');
  });

  // ── Validation errors (422) ──────────────────────────────────────────────────

  it('returns 422 when deployment_id is missing', async () => {
    const { deployment_id: _, ...payload } = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when service is missing', async () => {
    const { service: _, ...payload } = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when environment is missing', async () => {
    const { environment: _, ...payload } = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when status is missing', async () => {
    const { status: _, ...payload } = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when status is an invalid enum value', async () => {
    // 'unknown-status' is genuinely invalid; 'pending' is now a valid status (#268)
    const res = await post('/api/deployments', minimalEvent({ status: 'unknown-status' }), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when happened_at is missing', async () => {
    const { happened_at: _, ...payload } = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('422 body is Problem+JSON with per-field errors array', async () => {
    const { deployment_id: _a, service: _b, ...payload } = minimalEvent();
    const problem = await (await post('/api/deployments', payload, { 'X-Api-Key': API_KEY })).json();
    expect(problem.status).toBe(422);
    expect(Array.isArray(problem.errors)).toBe(true);
    expect(problem.errors.length).toBeGreaterThanOrEqual(2);
    expect(problem.errors[0]).toMatchObject({ pointer: expect.any(String), message: expect.any(String) });
  });

  // ── Context statuses (#268) ─────────────────────────────────────────────────

  const CTX_STATUSES = ['pending', 'queued', 'waiting', 'cancelled', 'rejected'] as const;

  for (const status of CTX_STATUSES) {
    it(`returns 201 for context status: ${status}`, async () => {
      const res = await post('/api/deployments', minimalEvent({ status }), { 'X-Api-Key': API_KEY });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe(status);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Read — GET /api/deployments
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/deployments', () => {
  it('returns 200', async () => {
    const res = await get('/api/deployments');
    expect(res.status).toBe(200);
  });

  it('body has items array and next_cursor field', async () => {
    const body = await (await get('/api/deployments')).json();
    expect(Array.isArray(body.items)).toBe(true);
    expect('next_cursor' in body).toBe(true);
  });

  it('a posted event appears in items with the DeploymentEvent shape', async () => {
    const payload = minimalEvent();
    await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    await post('/_mock/demo', { enabled: false });   // exclude seed data from assertion
    const body = await (await get('/api/deployments')).json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const item = body.items[0];
    expect(typeof item.id).toBe('string');
    expect(typeof item.deployment_id).toBe('string');
    expect(['in-progress', 'success', 'failure', 'pending', 'queued', 'waiting', 'cancelled', 'rejected']).toContain(item.status);
    expect(typeof item.happened_at).toBe('string');
  });

  it('service filter returns only matching events', async () => {
    const svc = `svc-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ service: svc }), { 'X-Api-Key': API_KEY });
    const body = await (await get(`/api/deployments?service=${svc}`)).json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((e: Record<string, unknown>) => e['service'] === svc)).toBe(true);
  });

  it('environment filter returns only matching events', async () => {
    const env = `env-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ environment: env }), { 'X-Api-Key': API_KEY });
    const body = await (await get(`/api/deployments?environment=${env}`)).json();
    expect(body.items.every((e: Record<string, unknown>) => e['environment'] === env)).toBe(true);
  });

  it('status filter returns only matching events', async () => {
    await post('/_mock/demo', { enabled: false });
    await post('/api/deployments', minimalEvent({ status: 'success' }), { 'X-Api-Key': API_KEY });
    await post('/api/deployments', minimalEvent({ status: 'failure' }), { 'X-Api-Key': API_KEY });
    const body = await (await get('/api/deployments?status=success')).json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].status).toBe('success');
  });

  it('deployment_id filter returns all rows sharing that key', async () => {
    const dep_id = `dep-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ deployment_id: dep_id }), { 'X-Api-Key': API_KEY });
    const body = await (await get(`/api/deployments?deployment_id=${dep_id}`)).json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((e: Record<string, unknown>) => e['deployment_id'] === dep_id)).toBe(true);
  });

  it('limit param caps page size', async () => {
    const body = await (await get('/api/deployments?limit=2')).json();
    expect(body.items.length).toBeLessThanOrEqual(2);
  });

  it('cursor pagination advances to a non-overlapping page', async () => {
    await post('/_mock/demo', { enabled: false });
    // Post 4 events so two pages of 2 are guaranteed by the spec
    for (let i = 0; i < 4; i++) {
      await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY });
    }
    const page1 = await (await get('/api/deployments?limit=2')).json();
    expect(page1.next_cursor).not.toBeNull();

    const page2 = await (await get(
      `/api/deployments?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`,
    )).json();
    const ids1 = new Set(page1.items.map((e: Record<string, unknown>) => e['id']));
    const ids2 = page2.items.map((e: Record<string, unknown>) => e['id']);
    expect(ids2.some((id: unknown) => ids1.has(id))).toBe(false);
  });

  it('since filter excludes events with happened_at before the threshold', async () => {
    await post('/_mock/demo', { enabled: false });
    await post('/api/deployments', minimalEvent({ happened_at: '2020-01-01T00:00:00.000Z' }), { 'X-Api-Key': API_KEY });
    const body = await (await get(`/api/deployments?since=${encodeURIComponent('2030-01-01T00:00:00.000Z')}`)).json();
    expect(body.items.length).toBe(0);
  });

  it('until filter excludes events with happened_at >= the threshold', async () => {
    await post('/_mock/demo', { enabled: false });
    await post('/api/deployments', minimalEvent({ happened_at: '2030-01-01T00:00:00.000Z' }), { 'X-Api-Key': API_KEY });
    const body = await (await get(`/api/deployments?until=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`)).json();
    expect(body.items.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Read — GET /api/deployments/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/deployments/:id', () => {
  it('returns 200 with the event for a known id', async () => {
    const created = await (await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY })).json();
    const res = await get(`/api/deployments/${created.id}`);
    expect(res.status).toBe(200);
  });

  it('returned event id matches the requested id', async () => {
    const created = await (await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY })).json();
    const body = await (await get(`/api/deployments/${created.id}`)).json();
    expect(body.id).toBe(created.id);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await get('/api/deployments/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('404 body conforms to Problem+JSON', async () => {
    const body = await (await get('/api/deployments/00000000-0000-0000-0000-000000000000')).json();
    expect(body.status).toBe(404);
    expect(typeof body.title).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Matrix — GET /api/matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/matrix', () => {
  it('returns 200', async () => {
    const res = await get('/api/matrix');
    expect(res.status).toBe(200);
  });

  it('body has generated_at, environments[], rows[]', async () => {
    const body = await (await get('/api/matrix')).json();
    expect(typeof body.generated_at).toBe('string');
    expect(Array.isArray(body.environments)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('each row has service string and slots object', async () => {
    await post('/_mock/demo', { enabled: false });
    const svc = `row-svc-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ service: svc }), { 'X-Api-Key': API_KEY });
    const { rows } = await (await get('/api/matrix')).json();
    for (const row of rows) {
      expect(typeof row.service).toBe('string');
      expect(row.slots !== null && typeof row.slots === 'object').toBe(true);
    }
  });

  it('each slot has a current DeploymentEvent with id and status', async () => {
    await post('/_mock/demo', { enabled: false });
    const svc = `slot-svc-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ service: svc, environment: 'prod' }), { 'X-Api-Key': API_KEY });
    const { rows } = await (await get('/api/matrix')).json();
    for (const row of rows) {
      for (const slot of Object.values(row.slots) as Record<string, unknown>[]) {
        const current = slot['current'] as Record<string, unknown>;
        expect(typeof current['id']).toBe('string');
        expect(['in-progress', 'success', 'failure']).toContain(current['status']);
      }
    }
  });

  it('service filter limits rows to the named service', async () => {
    await post('/_mock/demo', { enabled: false });
    const svc = `filter-svc-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ service: svc }), { 'X-Api-Key': API_KEY });
    const { rows: filtered } = await (await get(`/api/matrix?service=${encodeURIComponent(svc)}`)).json();
    expect(filtered.length).toBe(1);
    expect(filtered[0].service).toBe(svc);
  });

  it('demo hidden → rows is empty', async () => {
    await post('/_mock/demo', { enabled: false });
    const { rows } = await (await get('/api/matrix')).json();
    expect(rows.length).toBe(0);
  });

  // ── Context statuses appear in matrix slot.next (#268) ────────────────────

  it('slot.next is populated when a context-status event is posted after a success', async () => {
    const svc = `ctx-svc-${Date.now()}`;
    const env = 'prod';
    const t0 = new Date(Date.now() - 60000).toISOString();
    const t1 = new Date().toISOString();
    // Post success first, then pending (newer)
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'success', happened_at: t0 }), { 'X-Api-Key': API_KEY });
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'pending', happened_at: t1 }), { 'X-Api-Key': API_KEY });

    const { rows } = await (await get(`/api/matrix?service=${encodeURIComponent(svc)}`)).json();
    const slot = rows[0]?.slots[env];
    expect(slot).toBeDefined();
    // current must remain the effective (success) event
    expect(slot.current.status).toBe('success');
    // next must carry the context status
    expect(slot.next).toBeDefined();
    expect(slot.next.status).toBe('pending');
  });

  it('slot.next is populated for queued; current stays as the effective state', async () => {
    const svc = `ctx-svc2-${Date.now()}`;
    const env = 'staging';
    const t0 = new Date(Date.now() - 120000).toISOString();
    const t1 = new Date(Date.now() - 60000).toISOString();
    const t2 = new Date().toISOString();
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'success',    happened_at: t0 }), { 'X-Api-Key': API_KEY });
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'in-progress', happened_at: t1 }), { 'X-Api-Key': API_KEY });
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'queued',      happened_at: t2 }), { 'X-Api-Key': API_KEY });

    const { rows } = await (await get(`/api/matrix?service=${encodeURIComponent(svc)}`)).json();
    const slot = rows[0]?.slots[env];
    // current = most recent effective = in-progress
    expect(slot.current.status).toBe('in-progress');
    expect(slot.last_successful?.status).toBe('success');
    // next = context event
    expect(slot.next?.status).toBe('queued');
  });

  it('slot.next is absent when no context event exists', async () => {
    const svc = `ctx-svc3-${Date.now()}`;
    const env = 'qa';
    await post('/api/deployments', minimalEvent({ service: svc, environment: env, status: 'success', happened_at: new Date().toISOString() }), { 'X-Api-Key': API_KEY });

    const { rows } = await (await get(`/api/matrix?service=${encodeURIComponent(svc)}`)).json();
    const slot = rows[0]?.slots[env];
    expect(slot.current.status).toBe('success');
    expect(slot.next).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discovery — GET /api/services
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/services', () => {
  it('returns 200 with items string array', async () => {
    const res = await get('/api/services');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('items are sorted alphabetically', async () => {
    await post('/_mock/demo', { enabled: false });
    await post('/api/deployments', minimalEvent({ service: 'svc-z' }), { 'X-Api-Key': API_KEY });
    await post('/api/deployments', minimalEvent({ service: 'svc-a' }), { 'X-Api-Key': API_KEY });
    const { items } = await (await get('/api/services')).json();
    expect(items.indexOf('svc-a')).toBeLessThan(items.indexOf('svc-z'));
  });

  it('a newly posted service appears in the list', async () => {
    const svc = `disc-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ service: svc }), { 'X-Api-Key': API_KEY });
    const { items } = await (await get('/api/services')).json();
    expect(items).toContain(svc);
  });

  it('demo hidden + no user events → items is empty', async () => {
    await post('/_mock/demo', { enabled: false });
    const { items } = await (await get('/api/services')).json();
    expect(items.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Discovery — GET /api/environments
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/environments', () => {
  it('returns 200 with items string array', async () => {
    const res = await get('/api/environments');
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(Array.isArray(items)).toBe(true);
  });

  it('canonical env names precede unknown env names', async () => {
    const customEnv = `zzz-${Date.now()}`;
    await post('/api/deployments', minimalEvent({ environment: customEnv }), { 'X-Api-Key': API_KEY });
    const { items } = await (await get('/api/environments')).json();
    const customIdx = items.indexOf(customEnv);
    for (const canonical of ['dev', 'staging', 'qa', 'preprod', 'prod']) {
      const idx = items.indexOf(canonical);
      if (idx !== -1 && customIdx !== -1) {
        expect(idx).toBeLessThan(customIdx);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetcher — /api/fetcher/state/:adapter
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/fetcher/state/:adapter', () => {
  it('returns 401 without X-Api-Key', async () => {
    const res = await get('/api/fetcher/state/github-actions');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong X-Api-Key', async () => {
    const res = await get('/api/fetcher/state/github-actions', { 'X-Api-Key': 'bad-key' });
    expect(res.status).toBe(401);
  });

  it('returns 404 when no state has been stored yet', async () => {
    const res = await get('/api/fetcher/state/github-actions', { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(404);
  });

  it('404 body conforms to Problem+JSON', async () => {
    const body = await (await get('/api/fetcher/state/github-actions', { 'X-Api-Key': API_KEY })).json();
    expect(body.status).toBe(404);
    expect(typeof body.title).toBe('string');
  });
});

describe('PUT /api/fetcher/state/:adapter', () => {
  it('returns 401 without X-Api-Key', async () => {
    const res = await put('/api/fetcher/state/github-actions', { cursor: 'abc' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong X-Api-Key', async () => {
    const res = await put('/api/fetcher/state/github-actions', { cursor: 'abc' }, { 'X-Api-Key': 'bad-key' });
    expect(res.status).toBe(401);
  });

  it('returns 204 with a valid cursor', async () => {
    const res = await put('/api/fetcher/state/github-actions', { cursor: 'cursor-abc-123' }, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(204);
  });

  it('GET after PUT returns the stored cursor with adapter and updated_at', async () => {
    await put('/api/fetcher/state/my-adapter', { cursor: 'stored-cursor-xyz' }, { 'X-Api-Key': API_KEY });
    const body = await (await get('/api/fetcher/state/my-adapter', { 'X-Api-Key': API_KEY })).json();
    expect(body.adapter).toBe('my-adapter');
    expect(body.cursor).toBe('stored-cursor-xyz');
    expect(typeof body.updated_at).toBe('string');
  });

  it('returns 413 when cursor exceeds 8 KiB', async () => {
    const res = await put('/api/fetcher/state/github-actions', { cursor: 'x'.repeat(8 * 1024 + 1) }, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(413);
  });
});
