/**
 * Ops probes — GET /healthz, GET /readyz (openapi.yaml §ops), proxied by the
 * gateway (GW4).
 */
import { get } from './helpers';

describe('GET /healthz', () => {
  it('200 with { status: "ok" }', async () => {
    const res = await get('/healthz');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});

describe('GET /readyz', () => {
  it('200 with status "ready" and a checks map of ok/fail', async () => {
    const res = await get('/readyz');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.checks && typeof body.checks === 'object').toBe(true);
    expect(Object.values(body.checks).every((v) => v === 'ok' || v === 'fail')).toBe(true);
  });
});
