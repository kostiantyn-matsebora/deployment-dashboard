/**
 * Read surface — GET /api/matrix (openapi.yaml §/api/matrix).
 * Verifies shape, current/last_successful reduction, service filter, ETag→304.
 */
import { get, getJson, ingestEvent, resetAll, STATUSES } from './helpers';

describe('GET /api/matrix', () => {
  it('returns 200 with generated_at, environments[], rows[]', async () => {
    const body = await getJson('/api/matrix');
    expect(typeof body.generated_at).toBe('string');
    expect(Array.isArray(body.environments)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('every row has a service and a slots map of {current: DeploymentEvent}', async () => {
    await resetAll();
    const svc = `mx-${Date.now()}`;
    await ingestEvent({ service: svc, environment: 'prod' });
    const { rows } = await getJson('/api/matrix');
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(typeof row.service).toBe('string');
      expect(row.slots && typeof row.slots === 'object').toBe(true);
      for (const slot of Object.values(row.slots) as any[]) {
        expect(typeof slot.current.id).toBe('string');
        expect(STATUSES).toContain(slot.current.status);
      }
    }
  });

  it('current is the latest event by happened_at', async () => {
    await resetAll();
    const svc = `cur-${Date.now()}`;
    await ingestEvent({ service: svc, environment: 'dev', status: 'success', happened_at: '2026-01-01T00:00:00.000Z' });
    await ingestEvent({ service: svc, environment: 'dev', status: 'failure', happened_at: '2026-06-01T00:00:00.000Z' });
    const { rows } = await getJson(`/api/matrix?service=${svc}`);
    expect(rows[0].slots.dev.current.status).toBe('failure');
  });

  it('last_successful is present when current is a non-success over a prior success', async () => {
    await resetAll();
    const svc = `ls-${Date.now()}`;
    await ingestEvent({ service: svc, environment: 'dev', status: 'success', happened_at: '2026-01-01T00:00:00.000Z' });
    await ingestEvent({ service: svc, environment: 'dev', status: 'failure', happened_at: '2026-06-01T00:00:00.000Z' });
    const { rows } = await getJson(`/api/matrix?service=${svc}`);
    const slot = rows[0].slots.dev;
    expect(slot.current.status).toBe('failure');
    expect(slot.last_successful).toBeDefined();
    expect(slot.last_successful.status).toBe('success');
  });

  it('last_successful is omitted when current is itself a success', async () => {
    await resetAll();
    const svc = `oks-${Date.now()}`;
    await ingestEvent({ service: svc, environment: 'dev', status: 'success' });
    const { rows } = await getJson(`/api/matrix?service=${svc}`);
    const slot = rows[0].slots.dev;
    expect(slot.current.status).toBe('success');
    expect(slot.last_successful).toBeUndefined();
  });

  it('service filter limits rows to the named service', async () => {
    await resetAll();
    const a = `flt-a-${Date.now()}`;
    const b = `flt-b-${Date.now()}`;
    await ingestEvent({ service: a });
    await ingestEvent({ service: b });
    const { rows } = await getJson(`/api/matrix?service=${a}`);
    expect(rows.length).toBe(1);
    expect(rows[0].service).toBe(a);
  });

  it('emits a weak ETag and honours If-None-Match with 304', async () => {
    await resetAll();
    await ingestEvent();
    const first = await get('/api/matrix');
    const etag  = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await get('/api/matrix', { 'If-None-Match': etag as string });
    expect(second.status).toBe(304);
  });
});
