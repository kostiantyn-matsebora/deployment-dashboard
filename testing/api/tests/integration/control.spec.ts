/**
 * Control surface (openapi.yaml §control):
 *   POST /api/control/reset          — X-Control-API-Key, destructive (async 202)
 *   GET  /api/control/stream         — X-Control-API-Key, SSE orchestration stream
 *   POST /api/control/events         — X-Api-Key + X-Component-Id
 *   GET  /api/control/events/stream  — unauthenticated SSE stream of component events
 *
 * Full reset-choreography coverage lives in reset-choreography.spec.ts.
 * This file covers auth gates, component-event rules, and the component-events SSE stream.
 */
import {
  get, post, getJson, ingestEvent, resetAll, readControlSseUntil,
  readComponentEventSseUntil, sleep, API_KEY, CONTROL_KEY,
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

describe('GET /api/control/events/stream', () => {
  it('stream delivers a posted component event as an `event: component` frame', async () => {
    // Use a unique component_id so client-side matching is unambiguous even if
    // other events are in flight (the stream has no server-side filter).
    const cid = `it-cmp-${Date.now()}`;

    // Open the stream BEFORE posting so the live NOTIFY reaches us.
    // Match client-side on event name AND component_id embedded in the data JSON.
    const framePromise = readComponentEventSseUntil(
      f => f.event === 'component' && !!f.data && JSON.parse(f.data).component_id === cid,
      { timeoutMs: 20_000 },
    );
    await sleep(750);

    await post('/api/control/events',
      { event_type: 'heartbeat', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });

    const frame = await framePromise;
    expect(frame.id).toBeTruthy();

    // data must be a ComponentEventRecord with snake_case fields (§11 wire example).
    const data = JSON.parse(frame.data as string);
    expect(data.id).toBeTruthy();
    expect(data.component_id).toBe(cid);
    expect(data.event_type).toBe('heartbeat');
    expect(data.state).toBe('running');
    expect(data.occurred_at).toBeTruthy();
    expect(data.received_at).toBeTruthy();
  });

  it('reset does NOT purge component events (D14: only deployment_events + fetcher_state are cleared)', async () => {
    // API_SPECIFICATION.md D14: reset clears only deployment_events + fetcher_state.
    // component_events survive a reset and remain in the SSE replay window (2 h retention).

    // Step 1: post a baseline event and capture its frame id as the replay cursor.
    const baselineFramePromise = readComponentEventSseUntil(
      f => f.event === 'component' && !!f.id,
      { timeoutMs: 20_000 },
    );
    await sleep(750);
    await post('/api/control/events',
      { event_type: 'status', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': `it-baseline-${Date.now()}` });
    const baselineFrame = await baselineFramePromise;
    const cursorId = baselineFrame.id as string;

    // Step 2: post the event we want to survive the reset, with a unique cid.
    const cid = `it-rst-${Date.now()}`;
    const eventFramePromise = readComponentEventSseUntil(
      f => f.event === 'component' && !!f.data && JSON.parse(f.data).component_id === cid,
      { timeoutMs: 20_000 },
    );
    await sleep(750);
    await post('/api/control/events',
      { event_type: 'status', state: 'running', occurred_at: new Date().toISOString() },
      { 'X-Api-Key': API_KEY, 'X-Component-Id': cid });
    await eventFramePromise;

    // Step 3: drive a full reset cycle.
    await resetAll();

    // Step 4: reconnect with Last-Event-ID: cursorId — E must be replayed, proving
    // the component_events row was NOT cleared by the reset (D14).
    const replayedFrame = await readComponentEventSseUntil(
      f => f.event === 'component' && !!f.data && JSON.parse(f.data).component_id === cid,
      { lastEventId: cursorId, timeoutMs: 20_000 },
    );
    const data = JSON.parse(replayedFrame.data as string);
    expect(data.component_id).toBe(cid);
    expect(data.event_type).toBe('status');
  });
});
