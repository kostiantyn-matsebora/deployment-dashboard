import { WriteApiClient } from '../src/write-api/write-api.client';

const BASE_URL  = 'http://localhost:3000';
const API_KEY   = 'test-key';
const REPORTER  = 'demo-driver/demo-set';
const noSleep   = async () => {};

const sample = {
  deployment_id: 'gh-svc-dev-1',
  service:       'svc',
  environment:   'dev',
  status:        'success',
  happened_at:   '2026-01-01T00:00:00Z',
};

function makeClient(mockFetch: jest.Mock) {
  return new WriteApiClient(BASE_URL, API_KEY, REPORTER, mockFetch as any, noSleep);
}

describe('WriteApiClient', () => {

  it('POSTs to {WRITE_API_URL}/api/deployments', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 201 });
    await makeClient(mockFetch).postDeployment(sample);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/deployments`,
      expect.any(Object),
    );
  });

  it('sends X-Api-Key header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 201 });
    await makeClient(mockFetch).postDeployment(sample);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Api-Key']).toBe(API_KEY);
  });

  it('sends X-Progress-Reporter header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 201 });
    await makeClient(mockFetch).postDeployment(sample);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Progress-Reporter']).toBe(REPORTER);
  });

  it('returns ok=true on 201', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 201 });
    const result = await makeClient(mockFetch).postDeployment(sample);
    expect(result).toEqual({ ok: true, status: 201 });
  });

  it('does not retry on 4xx — single attempt', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 422 });
    const result = await makeClient(mockFetch).postDeployment(sample);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, status: 422 });
  });

  it('retries 3 times on 5xx then returns ok=false', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 503 });
    const result = await makeClient(mockFetch).postDeployment(sample);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ ok: false, status: 503 });
  });

  it('retries 3 times on network error then returns ok=false', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network'));
    const result = await makeClient(mockFetch).postDeployment(sample);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
  });

  it('succeeds on second attempt after first 5xx', async () => {
    const mockFetch = jest.fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 201 });
    const result = await makeClient(mockFetch).postDeployment(sample);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, status: 201 });
  });

  it('sends event body as JSON', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ status: 201 });
    await makeClient(mockFetch).postDeployment(sample);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ deployment_id: 'gh-svc-dev-1', service: 'svc' });
  });
});
