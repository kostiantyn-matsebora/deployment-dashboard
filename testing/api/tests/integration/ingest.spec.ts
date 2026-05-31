/**
 * Write surface — POST /api/deployments (openapi.yaml §/api/deployments post).
 * Edge cases (auth, validation) use direct writes; the demo-driver cannot emit
 * invalid payloads.
 */
import { API_KEY, get, post, minimalEvent, ingestEvent } from './helpers';

describe('POST /api/deployments', () => {
  // ── Happy path ────────────────────────────────────────────────────────────
  it('returns 201 with a server-assigned id and echoes the payload', async () => {
    const payload = minimalEvent();
    const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.deployment_id).toBe(payload.deployment_id);
    expect(body.service).toBe(payload.service);
    expect(body.environment).toBe(payload.environment);
    expect(body.status).toBe(payload.status);
  });

  it('Location header points to the created row', async () => {
    const res  = await post('/api/deployments', minimalEvent(), { 'X-Api-Key': API_KEY });
    const body = await res.json();
    expect(res.headers.get('location')).toBe(`/api/deployments/${body.id}`);
  });

  it('round-trips all optional fields', async () => {
    const body = await ingestEvent({
      version:            '2.0.0',
      actor:              'alice',
      run_number:         '9999',
      run_url:            'https://example.com/runs/9999',
      ref:                'refs/heads/main',
      sha:                'deadbeef',
      parent_deployments: ['gh-0001'],
    });
    expect(body.version).toBe('2.0.0');
    expect(body.actor).toBe('alice');
    expect(body.run_number).toBe('9999');
    expect(body.parent_deployments).toEqual(['gh-0001']);
  });

  it('accepts an X-Progress-Reporter attribution header', async () => {
    const res = await post('/api/deployments', minimalEvent(), {
      'X-Api-Key':          API_KEY,
      'X-Progress-Reporter': 'integration-suite/direct',
    });
    expect(res.status).toBe(201);
  });

  it('appends (no dedup) — two posts with the same deployment_id yield two rows', async () => {
    const dep = `dup-${Date.now()}`;
    const a = await ingestEvent({ deployment_id: dep, status: 'in-progress' });
    const b = await ingestEvent({ deployment_id: dep, status: 'success' });
    expect(a.id).not.toBe(b.id);
    const page = await (await get(`/api/deployments?deployment_id=${dep}`)).json();
    expect(page.items.length).toBe(2);
  });

  // ── Auth (401) ────────────────────────────────────────────────────────────
  it('401 when X-Api-Key is absent', async () => {
    expect((await post('/api/deployments', minimalEvent())).status).toBe(401);
  });

  it('401 when X-Api-Key is wrong', async () => {
    expect((await post('/api/deployments', minimalEvent(), { 'X-Api-Key': 'nope' })).status).toBe(401);
  });

  it('401 body is problem+json', async () => {
    const body = await (await post('/api/deployments', minimalEvent())).json();
    expect(body.status).toBe(401);
    expect(typeof body.title).toBe('string');
  });

  // ── Validation (422) — implemented (semantic rules) ──────────────────────────
  it('returns 422 on an invalid status enum value', async () => {
    const res = await post('/api/deployments', minimalEvent({ status: 'pending' }), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('returns 422 when version exceeds 50 chars', async () => {
    const res = await post('/api/deployments', minimalEvent({ version: 'v'.repeat(51) }), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  // ── Validation (422) — binding-level failures ────────────────────────────────
  // System.Text.Json rejects a missing required field / unknown field at
  // deserialization; the global handler (ProblemDetailsExtensions) maps the
  // JsonException to 422 application/problem+json with errors[] (D5 / §6).
  it.each(['deployment_id', 'service', 'environment', 'status', 'happened_at'])(
    'returns 422 when required field %s is missing',
    async (field) => {
      const payload: Record<string, unknown> = minimalEvent();
      delete payload[field];
      const res = await post('/api/deployments', payload, { 'X-Api-Key': API_KEY });
      expect(res.status).toBe(422);
    },
  );

  it('returns 422 on an unknown field (additionalProperties: false)', async () => {
    const res = await post('/api/deployments', minimalEvent({ bogus: 'x' }), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('422 body is problem+json with an errors array', async () => {
    const payload: Record<string, unknown> = minimalEvent();
    delete payload.deployment_id;
    const problem = await (await post('/api/deployments', payload, { 'X-Api-Key': API_KEY })).json();
    expect(problem.status).toBe(422);
    expect(Array.isArray(problem.errors)).toBe(true);
    expect(problem.errors.length).toBeGreaterThanOrEqual(1);
    expect(problem.errors[0]).toMatchObject({ pointer: expect.any(String), message: expect.any(String) });
  });
});
