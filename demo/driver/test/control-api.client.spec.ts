import { ControlApiClient } from '../src/write-api/control-api.client';

const BASE_URL    = 'http://localhost:3002';
const CONTROL_KEY = 'ctrl-key';
const RESET_ID    = '01J9F4WZK3W9G2T6X4QH3DKQF6';

function makeFetch(status: number, body?: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    status,
    json: body !== undefined
      ? jest.fn().mockResolvedValue(body)
      : jest.fn().mockRejectedValue(new Error('no body')),
  });
}

function makeClient(mockFetch: jest.Mock) {
  return new ControlApiClient(BASE_URL, CONTROL_KEY, mockFetch as any);
}

describe('ControlApiClient', () => {
  it('POSTs to {WRITE_API_URL}/api/control/reset', async () => {
    const mockFetch = makeFetch(202, { reset_id: RESET_ID, state: 'draining' });
    await makeClient(mockFetch).resetApi();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/control/reset`,
      expect.any(Object),
    );
  });

  it('uses POST method', async () => {
    const mockFetch = makeFetch(202, { reset_id: RESET_ID, state: 'draining' });
    await makeClient(mockFetch).resetApi();
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('sends X-Control-API-Key header', async () => {
    const mockFetch = makeFetch(202, { reset_id: RESET_ID, state: 'draining' });
    await makeClient(mockFetch).resetApi();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Control-API-Key']).toBe(CONTROL_KEY);
  });

  it('does not send X-Api-Key header', async () => {
    const mockFetch = makeFetch(202, { reset_id: RESET_ID, state: 'draining' });
    await makeClient(mockFetch).resetApi();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Api-Key']).toBeUndefined();
  });

  it('returns ok=true on 202 and parses reset_id from ResetAccepted body', async () => {
    const mockFetch = makeFetch(202, { reset_id: RESET_ID, state: 'draining' });
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(true);
    expect(result.http_status).toBe(202);
    expect(result.reset_id).toBe(RESET_ID);
  });

  it('returns ok=true on 200 (still a 2xx)', async () => {
    const mockFetch = makeFetch(200, { reset_id: RESET_ID });
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(true);
  });

  it('returns ok=false on 401', async () => {
    const mockFetch = makeFetch(401);
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(401);
  });

  it('returns ok=false on 500', async () => {
    const mockFetch = makeFetch(500);
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(500);
  });

  it('returns ok=false with http_status=0 on network error', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await makeClient(mockFetch).resetApi();
    expect(result).toEqual({ ok: false, http_status: 0 });
  });

  it('makes exactly one attempt (no retry)', async () => {
    const mockFetch = makeFetch(500);
    await makeClient(mockFetch).resetApi();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns reset_id undefined when body JSON parse fails (non-JSON response)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 202,
      json:   jest.fn().mockRejectedValue(new SyntaxError('unexpected token')),
    });
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(true);
    expect(result.reset_id).toBeUndefined();
  });
});

// ── recoverApi (#423, D18) ──────────────────────────────────────────────────

const CORRELATION_ID = '01J9G5A1B2C3D4E5F6G7H8J9K0';
const SINCE           = '2026-07-19T10:00:00Z';

describe('ControlApiClient.recoverApi', () => {
  it('POSTs to {WRITE_API_URL}/api/control/recover', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/control/recover`,
      expect.any(Object),
    );
  });

  it('uses POST method', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('sends X-Control-API-Key header', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Control-API-Key']).toBe(CONTROL_KEY);
  });

  it('does not send X-Api-Key header', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Api-Key']).toBeUndefined();
  });

  it('sends Content-Type: application/json', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends the days_back body as JSON', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    await makeClient(mockFetch).recoverApi({ days_back: 7 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ days_back: 7 });
  });

  it('returns ok=true on 202 and parses correlation_id + since from RecoverAccepted body', async () => {
    const mockFetch = makeFetch(202, { correlation_id: CORRELATION_ID, state: 'draining', since: SINCE });
    const result = await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(result.ok).toBe(true);
    expect(result.http_status).toBe(202);
    expect(result.correlation_id).toBe(CORRELATION_ID);
    expect(result.since).toBe(SINCE);
  });

  it('returns ok=false on 409 (a control operation is already in flight)', async () => {
    const mockFetch = makeFetch(409);
    const result = await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(409);
    expect(result.correlation_id).toBeUndefined();
  });

  it('returns ok=false on 422 (invalid days_back / bound exceeded)', async () => {
    const mockFetch = makeFetch(422);
    const result = await makeClient(mockFetch).recoverApi({ days_back: 9999 });
    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(422);
  });

  it('returns ok=false with http_status=0 on network error', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(result).toEqual({ ok: false, http_status: 0 });
  });

  it('makes exactly one attempt (no retry)', async () => {
    const mockFetch = makeFetch(500);
    await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns correlation_id/since undefined when body JSON parse fails (non-JSON response)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      status: 202,
      json:   jest.fn().mockRejectedValue(new SyntaxError('unexpected token')),
    });
    const result = await makeClient(mockFetch).recoverApi({ days_back: 2 });
    expect(result.ok).toBe(true);
    expect(result.correlation_id).toBeUndefined();
    expect(result.since).toBeUndefined();
  });
});
