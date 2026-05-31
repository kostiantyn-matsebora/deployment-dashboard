/**
 * Control surface (openapi.yaml §control):
 *   POST /api/control/reset     — X-Control-API-Key, destructive (async 202)
 *   GET  /api/control/stream    — X-Control-API-Key, SSE orchestration stream
 *   POST /api/control/events    — X-Api-Key + X-Component-Id
 *   GET  /api/control/events    — unauthenticated listing
 *
 * Full reset-choreography coverage lives in reset-choreography.spec.ts.
 * This file covers auth gates, component-event rules, and GET /api/control/events.
 */
import {
  get, post, getJson, ingestEvent, resetAll, readControlSseUntil, sleep, API_KEY, CONTROL_KEY,
} from './helpers';

describe('POST /api/control/reset', () => {
  it('401 without a control key', async () => {
    expect((await post('/api/control/reset')).status).toBe(401);
  });

  it('401 when the write key is presented as the control key (least privilege)', async () => {
    const res = await post('/api/control/reset', undefined, { 'X-Control-API-Key': API_KEY });
    expect(res.status).toBe(401);
  });

  // Full choreography coverage (202 body shape, SSE sequence, ack-driven
  // completion, timeout backstop, 409 reentry, data cleared) lives in
  // reset-choreography.spec.ts.  Here we only verify the basic happy-path
  // smoke via resetAll() which drives the full async cycle internally.
  it('202 with the control key and clears all deployment data after completion', async () => {
    await ingestEvent();
    expect((await getJson('/api/services')).items.length).toBeGreaterThanOrEqual(1);

    // resetAll() posts reset (202), acks, waits for reset-completed.
    await resetAll();

    expect((await getJson('/api/services')).items.length).toBe(0);
    expect((await getJson('/api/matrix')).rows.length).toBe(0);
    expect((await getJson('/api/deployments')).items.length).toBe(0);
  });
});

describe('GET /api/control/stream', () => {
  it('401 without a control key', async () => {
    const res = await get('/api/control/stream', { Accept: 'text/event-stream' });
    expect(res.status).toBe(401);
  });

  it('401 when the write key is presented as the control key (least privilege)', async () => {
    const res = await get('/api/control/stream', { Accept: 'text/event-stream', 'X-Control-API-Key': API_KEY });
    expect(res.status).toBe(401);
  });

  it('pushes a reset-completed frame when a reset cycle finishes', async () => {
    // Open the stream BEFORE triggering resetAll so we do not miss early frames.
    const framePromise = readControlSseUntil(
      f => f.event === 'reset-completed',
      { timeoutMs: 20_000 },
    );
    await sleep(500);
    await resetAll();

    const frame = await framePromise;
    expect(frame.id).toBeTruthy();
    const data = JSON.parse(frame.data as string);
    expect(data.type).toBe('reset-completed');
    expect(data.component).toBe('*');
    expect(data.reset_id).toBeTruthy();
  });

  it('replays persisted control-stream events after Last-Event-ID', async () => {
    // resetAll persists reset-initiated / reset-started / reset-completed rows.
    // Replaying from the zero UUID returns every row — at least reset-completed.
    await resetAll();
    const frame = await readControlSseUntil(
      f => f.event === 'reset-completed',
      { lastEventId: '00000000-0000-0000-0000-000000000000', timeoutMs: 15_000 },
    );
    expect(JSON.parse(frame.data as string).type).toBe('reset-completed');
  });

  it('delivers wildcard ("*") events regardless of the ?component filter', async () => {
    // Reset events target "*"; a component-scoped subscriber still receives them.
    const framePromise = readControlSseUntil(
      f => f.event === 'reset-completed',
      { component: 'demo-driver', timeoutMs: 20_000 },
    );
    await sleep(500);
    await resetAll();

    const frame = await framePromise;
    expect(JSON.parse(frame.data as string).component).toBe('*');
  });
});

describe('POST /api/control/events', () => {
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

describe('GET /api/control/events', () => {
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

  it('reset does NOT purge component events (D14: only deployment_events + fetcher_state are cleared)', async () => {
    // API_SPECIFICATION.md D14: reset clears only deployment_events + fetcher_state.
    // component_events are left to the 2-hour retention job.
    const cid = `it-rst-${Date.now()}`;
    await post('/api/control/events',
      { event_type: 'status', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });
    await resetAll();
    const body = await getJson(`/api/control/events?component_id=${cid}`);
    // Component events survive a reset — they are purged only by the 2h retention job.
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });
});
