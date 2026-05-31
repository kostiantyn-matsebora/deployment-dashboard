/**
 * ControlEventsReadClient unit tests.
 *
 * Uses the globalThis.fetch seam (same pattern as control-events.client.spec.ts
 * and control-api.client.spec.ts siblings).
 *
 * Covers (per §9):
 * - Whitelisted query params forwarded; undefined params omitted; non-whitelisted dropped.
 * - Upstream 200 body returned verbatim (ComponentEventPage shape).
 * - Non-2xx upstream (422, 500) surfaced as-is — does NOT throw.
 * - Network error surfaced as status 502 synthetic error.
 */

import { ControlEventsReadClient } from '../src/control/control-events-read.client';

const BASE_URL = 'http://localhost:3000';

/** Minimal ComponentEventPage fixture. */
const PAGE_BODY = {
  items: [
    {
      id:           'row-1',
      component_id: 'demo-driver',
      event_type:   'reset-ack',
      state:        'paused',
      occurred_at:  '2026-05-31T10:00:00Z',
      received_at:  '2026-05-31T10:00:01Z',
      payload:      null,
    },
  ],
  next_cursor: null,
};

function makeClient(): ControlEventsReadClient {
  return new ControlEventsReadClient();
}

function stubFetch(status: number, body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: jest.fn().mockResolvedValue(body),
  });
}

describe('ControlEventsReadClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.WRITE_API_URL = BASE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.WRITE_API_URL;
  });

  // ── URL construction — query param whitelist ───────────────────────────────

  describe('query param forwarding', () => {
    it('sends all five whitelisted params when all are provided', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await makeClient().list({
        component_id: 'demo-driver',
        event_type:   'reset-ack',
        since:        '2026-05-31T00:00:00Z',
        cursor:       'tok_abc',
        limit:        '20',
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('component_id=demo-driver');
      expect(url).toContain('event_type=reset-ack');
      expect(url).toContain('since=2026-05-31T00%3A00%3A00Z');
      expect(url).toContain('cursor=tok_abc');
      expect(url).toContain('limit=20');
    });

    it('omits undefined params from the URL', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await makeClient().list({ component_id: 'demo-driver' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('component_id=demo-driver');
      expect(url).not.toContain('event_type');
      expect(url).not.toContain('since');
      expect(url).not.toContain('cursor');
      expect(url).not.toContain('limit');
    });

    it('produces no query string when all params are undefined', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await makeClient().list({});

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toBe(`${BASE_URL}/api/control/events`);
    });

    it('does NOT forward non-whitelisted params present in the query object', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      // Cast to any to simulate a caller passing extra keys (e.g. from raw @Query()).
      await makeClient().list({ component_id: 'x', ...(({ evil: 'drop' }) as any) });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).not.toContain('evil');
    });

    it('targets the correct upstream path', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await makeClient().list({ limit: '10' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toMatch(/^http:\/\/localhost:3000\/api\/control\/events/);
    });

    it('uses GET method', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await makeClient().list({});

      const options = mockFetch.mock.calls[0][1];
      expect(options.method).toBe('GET');
    });
  });

  // ── Successful upstream response ───────────────────────────────────────────

  describe('upstream 200 response', () => {
    it('returns status 200 and the verbatim ComponentEventPage body', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({});

      expect(result.status).toBe(200);
      expect(result.body).toEqual(PAGE_BODY);
    });

    it('returns items array from the response body', async () => {
      const mockFetch = stubFetch(200, PAGE_BODY);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({});

      expect((result.body as typeof PAGE_BODY).items).toHaveLength(1);
      expect((result.body as typeof PAGE_BODY).items[0].component_id).toBe('demo-driver');
    });
  });

  // ── Non-2xx upstream responses — surfaced, never thrown ───────────────────

  describe('non-2xx upstream responses', () => {
    it('surfaces 422 status and body without throwing', async () => {
      const errBody = { type: 'about:blank', title: 'Unprocessable', status: 422 };
      const mockFetch = stubFetch(422, errBody);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({ since: 'not-a-date' });

      expect(result.status).toBe(422);
      expect(result.body).toEqual(errBody);
    });

    it('surfaces 500 status without throwing', async () => {
      const mockFetch = stubFetch(500, { error: 'internal' });
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({});

      expect(result.status).toBe(500);
    });

    it('surfaces 404 status without throwing', async () => {
      const mockFetch = stubFetch(404, null);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({});

      expect(result.status).toBe(404);
    });

    it('does not throw for any non-2xx status', async () => {
      const mockFetch = stubFetch(503, null);
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      await expect(makeClient().list({})).resolves.toBeDefined();
    });
  });

  // ── Network error — surfaced as 502 ───────────────────────────────────────

  describe('network error', () => {
    it('returns status 502 when fetch rejects (network-level failure)', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(
        new Error('ECONNREFUSED'),
      ) as unknown as typeof globalThis.fetch;

      const result = await makeClient().list({});

      expect(result.status).toBe(502);
    });

    it('does not throw on network error', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(
        new Error('ECONNREFUSED'),
      ) as unknown as typeof globalThis.fetch;

      await expect(makeClient().list({})).resolves.toBeDefined();
    });

    it('returns a body object on network error (not null)', async () => {
      globalThis.fetch = jest.fn().mockRejectedValue(
        new Error('Network'),
      ) as unknown as typeof globalThis.fetch;

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await makeClient().list({});
      warnSpy.mockRestore();

      expect(result.body).toBeDefined();
    });
  });
});
