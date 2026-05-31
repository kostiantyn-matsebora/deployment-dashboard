import { ControlApiClient } from '../src/write-api/control-api.client';

const BASE_URL     = 'http://localhost:3000';
const CONTROL_KEY  = 'ctrl-key';

function makeClient(mockFetch: jest.Mock) {
  return new ControlApiClient(BASE_URL, CONTROL_KEY, mockFetch as any);
}

describe('ControlApiClient', () => {
  it('POSTs to {WRITE_API_URL}/api/control/reset', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
    await makeClient(mockFetch).resetApi();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/control/reset`,
      expect.any(Object),
    );
  });

  it('uses POST method', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
    await makeClient(mockFetch).resetApi();
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('sends X-Control-API-Key header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
    await makeClient(mockFetch).resetApi();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Control-API-Key']).toBe(CONTROL_KEY);
  });

  it('does not send X-Api-Key header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
    await makeClient(mockFetch).resetApi();
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Api-Key']).toBeUndefined();
  });

  it('returns ok=true on 204', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 204 });
    const result = await makeClient(mockFetch).resetApi();
    expect(result).toEqual({ ok: true, http_status: 204 });
  });

  it('returns ok=true on 200', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 200 });
    const result = await makeClient(mockFetch).resetApi();
    expect(result.ok).toBe(true);
  });

  it('returns ok=false on 401', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 401 });
    const result = await makeClient(mockFetch).resetApi();
    expect(result).toEqual({ ok: false, http_status: 401 });
  });

  it('returns ok=false on 500', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 500 });
    const result = await makeClient(mockFetch).resetApi();
    expect(result).toEqual({ ok: false, http_status: 500 });
  });

  it('returns ok=false with http_status=0 on network error', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await makeClient(mockFetch).resetApi();
    expect(result).toEqual({ ok: false, http_status: 0 });
  });

  it('makes exactly one attempt (no retry)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 500 });
    await makeClient(mockFetch).resetApi();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
