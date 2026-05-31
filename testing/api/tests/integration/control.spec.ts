/**
 * Control surface (openapi.yaml §control):
 *   POST /api/control/reset     — X-Control-API-Key, destructive
 *   POST /api/control/events    — X-Api-Key + X-Component-Id
 *   GET  /api/control/events    — unauthenticated listing
 */
import { get, post, getJson, ingestEvent, resetAll, API_KEY, CONTROL_KEY } from './helpers';

describe('POST /api/control/reset', () => {
  it('401 without a control key', async () => {
    expect((await post('/api/control/reset')).status).toBe(401);
  });

  it('401 when the write key is presented as the control key (least privilege)', async () => {
    const res = await post('/api/control/reset', undefined, { 'X-Control-API-Key': API_KEY });
    expect(res.status).toBe(401);
  });

  it('204 with the control key and truncates all deployment data', async () => {
    await ingestEvent();
    expect((await getJson('/api/services')).items.length).toBeGreaterThanOrEqual(1);

    const res = await post('/api/control/reset', undefined, { 'X-Control-API-Key': CONTROL_KEY });
    expect(res.status).toBe(204);

    expect((await getJson('/api/services')).items.length).toBe(0);
    expect((await getJson('/api/matrix')).rows.length).toBe(0);
    expect((await getJson('/api/deployments')).items.length).toBe(0);
  });
});

// TODO: PENDING — API_SPECIFICATION Phase 10 (control plane) not implemented yet.
// ControlEndpoints.cs maps only POST /api/control/reset; the component-events
// endpoints (and control_stream_events / component_events tables, second LISTEN
// channel) do not exist, so these return 404. Enable when Phase 10 lands.
describe.skip('POST /api/control/events', () => {
  const validBody = () => ({
    event_type: 'status',
    state:      'running',
    detail:     'integration probe',
    occurred_at: new Date().toISOString(),
    payload:    { events_this_hour: 1 },
  });

  it('204 with X-Api-Key + valid X-Component-Id', async () => {
    const res = await post('/api/control/events', validBody(), {
      'X-Api-Key': API_KEY, 'X-Component-Id': 'integration-suite',
    });
    expect(res.status).toBe(204);
  });

  it('401 without X-Api-Key', async () => {
    const res = await post('/api/control/events', validBody(), { 'X-Component-Id': 'integration-suite' });
    expect(res.status).toBe(401);
  });

  it('422 when X-Component-Id is missing', async () => {
    const res = await post('/api/control/events', validBody(), { 'X-Api-Key': API_KEY });
    expect(res.status).toBe(422);
  });

  it('422 when X-Component-Id violates the pattern', async () => {
    const res = await post('/api/control/events', validBody(), {
      'X-Api-Key': API_KEY, 'X-Component-Id': 'BAD_ID',   // uppercase + underscore
    });
    expect(res.status).toBe(422);
  });

  it('413 when a payload field exceeds 8 KiB', async () => {
    const res = await post('/api/control/events',
      { ...validBody(), payload: { blob: 'x'.repeat(8 * 1024 + 1) } },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': 'integration-suite' });
    expect(res.status).toBe(413);
  });
});

// TODO: PENDING — see Phase 10 note above. Enable when GET /api/control/events lands.
describe.skip('GET /api/control/events', () => {
  it('returns posted component events, filterable by component_id', async () => {
    const cid = `it-cmp-${Date.now()}`;
    await post('/api/control/events',
      { event_type: 'heartbeat', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });

    const body = await getJson(`/api/control/events?component_id=${cid}`);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((e: any) => e.component_id === cid)).toBe(true);
    expect(body.items[0]).toMatchObject({
      id:         expect.any(String),
      event_type: 'heartbeat',
      state:      'running',
    });
  });

  it('event_type filter narrows the listing', async () => {
    const cid = `it-et-${Date.now()}`;
    await post('/api/control/events',
      { event_type: 'status', state: 'idle', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });
    await post('/api/control/events',
      { event_type: 'error', state: 'error', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });

    const body = await getJson(`/api/control/events?component_id=${cid}&event_type=error`);
    expect(body.items.length).toBe(1);
    expect(body.items[0].event_type).toBe('error');
  });

  it('reset purges component events too', async () => {
    const cid = `it-rst-${Date.now()}`;
    await post('/api/control/events',
      { event_type: 'status', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });
    await resetAll();
    const body = await getJson(`/api/control/events?component_id=${cid}`);
    expect(body.items.length).toBe(0);
  });
});
