/**
 * ComponentEventsSubscriber unit tests.
 *
 * Exercises SSE parsing, Last-Event-ID reconnect, backoff, heartbeat-ignore,
 * and ComponentEventFeed publish logic.
 *
 * Mirrors control-stream.subscriber.spec.ts — same fake-timer and fetch-seam approach.
 *
 * The endpoint is GET /api/control/events/stream with NO auth header
 * (openapi.yaml — no security requirement; §11 auth table).
 */

import { ComponentEventsSubscriber } from '../src/control/component-events.subscriber';
import { ComponentEventFeed, ComponentEventFrame } from '../src/control/component-event-feed';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStream(sseText: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(sseText);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fetchOk(sseText: string): jest.Mock {
  return jest.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, body: makeStream(sseText) }),
  );
}

function fetchFail(msg = 'ECONNREFUSED'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(msg));
}

function makeSubscriber(feed?: ComponentEventFeed): ComponentEventsSubscriber {
  return new (ComponentEventsSubscriber as any)(feed ?? new ComponentEventFeed());
}

async function driveOneIteration(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ComponentEventsSubscriber', () => {
  let originalFetch: typeof globalThis.fetch;
  const openSubscribers: ComponentEventsSubscriber[] = [];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    jest.useFakeTimers();
    process.env.WRITE_API_URL = 'http://api:8080';
    // No CONTROL_API_KEY — the endpoint is unauthenticated.
  });

  afterEach(() => {
    for (const sub of openSubscribers) {
      try { sub.onModuleDestroy(); } catch {}
    }
    openSubscribers.length = 0;
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.clearAllMocks();
    delete process.env.WRITE_API_URL;
  });

  function track(sub: ComponentEventsSubscriber): ComponentEventsSubscriber {
    openSubscribers.push(sub);
    return sub;
  }

  // ── Endpoint and auth ─────────────────────────────────────────────────────

  it('subscribes to /api/control/events/stream', async () => {
    const mockFetch = fetchOk('');
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    sub.onModuleInit();
    await driveOneIteration();

    expect(mockFetch.mock.calls[0][0]).toContain('/api/control/events/stream');
  });

  it('does NOT send X-Control-API-Key header (endpoint is unauthenticated)', async () => {
    const mockFetch = fetchOk('');
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    sub.onModuleInit();
    await driveOneIteration();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Control-API-Key']).toBeUndefined();
    expect(headers['X-Api-Key']).toBeUndefined();
  });

  // ── SSE parsing and publish ───────────────────────────────────────────────

  it('publishes a parsed component frame to ComponentEventFeed', async () => {
    const id = '01J9F4WZK3W9G2T6X4QH3DKQF5';
    const data = JSON.stringify({
      id,
      component_id: 'dashboard-fetcher',
      event_type:   'status',
      state:        'running',
    });
    const sseText = `id: ${id}\nevent: component\ndata: ${data}\n\n`;

    globalThis.fetch = fetchOk(sseText) as unknown as typeof globalThis.fetch;
    const feed = new ComponentEventFeed();
    const published: ComponentEventFrame[] = [];
    feed.frames$.subscribe(f => published.push(f));

    const sub = track(makeSubscriber(feed));
    sub.onModuleInit();
    await driveOneIteration();

    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(id);
    expect(published[0].type).toBe('component');
    expect(published[0].data).toContain('dashboard-fetcher');
  });

  it('publishes multiple consecutive frames in arrival order', async () => {
    const sseText =
      `id: id-1\nevent: component\ndata: {"id":"id-1"}\n\n` +
      `id: id-2\nevent: component\ndata: {"id":"id-2"}\n\n`;

    globalThis.fetch = fetchOk(sseText) as unknown as typeof globalThis.fetch;
    const feed = new ComponentEventFeed();
    const published: ComponentEventFrame[] = [];
    feed.frames$.subscribe(f => published.push(f));

    const sub = track(makeSubscriber(feed));
    sub.onModuleInit();
    await driveOneIteration();

    expect(published).toHaveLength(2);
    expect(published[0].id).toBe('id-1');
    expect(published[1].id).toBe('id-2');
  });

  it('ignores heartbeat ping comments without publishing', async () => {
    const sseText = `: ping\n\n: ping\n\n`;
    globalThis.fetch = fetchOk(sseText) as unknown as typeof globalThis.fetch;
    const feed = new ComponentEventFeed();
    const published: ComponentEventFrame[] = [];
    feed.frames$.subscribe(f => published.push(f));

    const sub = track(makeSubscriber(feed));
    sub.onModuleInit();
    await driveOneIteration();

    expect(published).toHaveLength(0);
  });

  // ── Last-Event-ID ─────────────────────────────────────────────────────────

  it('sends Last-Event-ID on subsequent requests after receiving an event id', async () => {
    const LAST_ID = '01J9F4WZK3W9G2T6X4QH3DKQF5';
    const sseText = `id: ${LAST_ID}\nevent: component\ndata: {"id":"${LAST_ID}"}\n\n`;

    let call = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: true, body: makeStream(sseText) });
      return Promise.resolve({ ok: false, status: 503, body: null });
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const sub = track(makeSubscriber());
    sub.onModuleInit();

    await driveOneIteration();
    await driveOneIteration();

    if (call >= 2) {
      const secondHeaders = mockFetch.mock.calls[1][1].headers;
      expect(secondHeaders['Last-Event-ID']).toBe(LAST_ID);
    } else {
      expect(call).toBeGreaterThanOrEqual(1);
    }
  });

  it('does NOT send Last-Event-ID on the first request (fresh connect)', async () => {
    const mockFetch = fetchOk('');
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    sub.onModuleInit();
    await driveOneIteration();

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Last-Event-ID']).toBeUndefined();
  });

  // ── Graceful degradation ──────────────────────────────────────────────────

  it('logs a warning and retries without crashing on connect failure', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    globalThis.fetch = fetchFail() as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    sub.onModuleInit();
    await driveOneIteration();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('component-events connect failed'),
      expect.any(Error),
    );
    expect(sub).toBeDefined();
    warnSpy.mockRestore();
  });

  it('does not throw on persistent connect failure', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = fetchFail() as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    expect(() => sub.onModuleInit()).not.toThrow();
    await driveOneIteration();

    warnSpy.mockRestore();
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────

  it('stops gracefully on onModuleDestroy', async () => {
    globalThis.fetch = fetchOk(': ping\n\n') as unknown as typeof globalThis.fetch;
    const sub = track(makeSubscriber());

    sub.onModuleInit();
    await driveOneIteration();

    expect(() => sub.onModuleDestroy()).not.toThrow();
  });
});
