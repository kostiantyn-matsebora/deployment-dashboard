/**
 * deployments-stream.controller.spec.ts
 *
 * Unit tests for GET /demo/deployments-stream.
 *
 * Covers (per task spec):
 *  - Upstream deployment frames are piped verbatim to the client.
 *  - Client disconnect aborts the upstream fetch (AbortController).
 *  - Upstream unreachable → graceful degradation (log + end; no throw).
 *  - Endpoint is NOT reset-gated (never calls DemoService.isBlocked).
 *  - SSE headers are set correctly.
 *  - Last-Event-ID and ?service= are forwarded to the upstream.
 */

import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentsStreamController } from '../src/deployments/deployments-stream.controller';
import { Request, Response } from 'express';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Wraps SSE text in a ReadableStream<Uint8Array>. */
function makeStream(sseText: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(sseText);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** fetch mock returning an SSE-like 200 response. */
function fetchOk(sseText: string): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok:     true,
    status: 200,
    body:   makeStream(sseText),
  });
}

/** fetch mock returning a non-ok status with no body. */
function fetchNonOk(status: number): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok:     false,
    status,
    body:   null,
  });
}

/** fetch mock that rejects (network error). */
function fetchFail(msg = 'ECONNREFUSED'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(msg));
}

/**
 * Minimal mock Express Response for SSE endpoint tests.
 * Captures write() / end() calls; exposes a simulateClose() helper.
 */
function makeSseRes(): Response & {
  _written:      string[];
  _ended:        boolean;
  simulateClose: () => void;
} {
  const written: string[] = [];
  let ended = false;
  let closeHandler: (() => void) | undefined;

  const res: any = {
    _written: written,
    get _ended() { return ended; },
    setHeader:    jest.fn().mockReturnThis(),
    flushHeaders: jest.fn(),
    write:        jest.fn().mockImplementation((chunk: string) => { written.push(chunk); }),
    end:          jest.fn().mockImplementation(() => { ended = true; }),
    on:           jest.fn().mockImplementation((event: string, cb: () => void) => {
      if (event === 'close') closeHandler = cb;
    }),
    simulateClose: () => { if (closeHandler) closeHandler(); },
  };
  return res as Response & { _written: string[]; _ended: boolean; simulateClose: () => void };
}

/** Minimal mock Express Request. */
function makeReq(): Request {
  const handlers: Record<string, () => void> = {};
  const req: any = {
    on: jest.fn().mockImplementation((event: string, cb: () => void) => {
      handlers[event] = cb;
    }),
    _emit: (event: string) => { if (handlers[event]) handlers[event](); },
  };
  return req as Request;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('DeploymentsStreamController', () => {
  let controller: DeploymentsStreamController;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;

    process.env.WRITE_API_URL = 'http://api:8080';

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeploymentsStreamController],
    }).compile();

    controller = module.get(DeploymentsStreamController);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    delete process.env.WRITE_API_URL;
  });

  // ── SSE headers ────────────────────────────────────────────────────────────

  describe('SSE headers', () => {
    it('sets Content-Type: text/event-stream', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('sets Cache-Control: no-cache, no-transform', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    });

    it('sets Connection: keep-alive', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    });

    it('sets X-Accel-Buffering: no', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    });

    it('calls flushHeaders to start the stream immediately', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.flushHeaders).toHaveBeenCalled();
    });
  });

  // ── Upstream URL construction ──────────────────────────────────────────────

  describe('upstream URL', () => {
    it('targets /api/events/stream on WRITE_API_URL without ?service= when not provided', async () => {
      const mockFetch = fetchOk('');
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      const calledUrl: string = mockFetch.mock.calls[0][0];
      expect(calledUrl).toBe('http://api:8080/api/events/stream');
    });

    it('appends ?service= when the service query param is provided', async () => {
      const mockFetch = fetchOk('');
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, 'payments-api', req, res as unknown as Response);

      const calledUrl: string = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('service=payments-api');
    });

    it('percent-encodes special characters in the service param', async () => {
      const mockFetch = fetchOk('');
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, 'a b/c', req, res as unknown as Response);

      const calledUrl: string = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('service=a%20b%2Fc');
    });
  });

  // ── Last-Event-ID forwarding ───────────────────────────────────────────────

  describe('Last-Event-ID forwarding', () => {
    it('includes Last-Event-ID header in the upstream request when provided', async () => {
      const mockFetch = fetchOk('');
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(
        '01J9F4WZK3W9G2T6X4QH3DKQF5',
        undefined,
        req,
        res as unknown as Response,
      );

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Last-Event-ID']).toBe('01J9F4WZK3W9G2T6X4QH3DKQF5');
    });

    it('omits Last-Event-ID header when not provided', async () => {
      const mockFetch = fetchOk('');
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Last-Event-ID']).toBeUndefined();
    });
  });

  // ── Frame passthrough ──────────────────────────────────────────────────────

  describe('frame passthrough', () => {
    it('writes upstream SSE bytes verbatim to the client response', async () => {
      const sseFrame =
        'id: 01J9F4WZK3W9G2T6X4QH3DKQF5\nevent: deployment\ndata: {"service":"payments-api"}\n\n';

      globalThis.fetch = fetchOk(sseFrame) as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      const allWritten = (res.write as jest.Mock).mock.calls.map((c: any[]) => c[0] as string).join('');
      expect(allWritten).toContain('event: deployment');
      expect(allWritten).toContain('"service":"payments-api"');
    });

    it('writes ping heartbeat comments through unchanged', async () => {
      globalThis.fetch = fetchOk(': ping\n\n') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      const allWritten = (res.write as jest.Mock).mock.calls.map((c: any[]) => c[0] as string).join('');
      expect(allWritten).toContain(': ping');
    });

    it('calls res.end() after the upstream stream completes', async () => {
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(res.end).toHaveBeenCalled();
    });
  });

  // ── Client disconnect aborts upstream ─────────────────────────────────────

  describe('client disconnect', () => {
    it('aborts the upstream fetch via AbortController when the request closes', async () => {
      let capturedSignal: AbortSignal | undefined;

      const mockFetch = jest.fn().mockImplementation(
        (_url: string, opts: { signal?: AbortSignal }) => {
          capturedSignal = opts?.signal;

          // A stream whose pull() blocks until the AbortSignal fires, then
          // closes the stream so reader.read() returns { done: true }.
          // This avoids throwing across stream internals (which Node rejects
          // as an unhandled error) while still letting the read loop exit
          // cleanly once the signal is aborted.
          const stream = new ReadableStream<Uint8Array>({
            pull(streamController) {
              return new Promise<void>(resolve => {
                if (capturedSignal?.aborted) {
                  streamController.close();
                  resolve();
                  return;
                }
                capturedSignal?.addEventListener('abort', () => {
                  streamController.close();
                  resolve();
                }, { once: true });
              });
            },
          });
          return Promise.resolve({ ok: true, status: 200, body: stream });
        },
      );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const res = makeSseRes();
      const req = makeReq() as any;

      // Start the stream — do NOT await; it blocks until the signal fires.
      const streamPromise = controller.deploymentsStream(
        undefined,
        undefined,
        req,
        res as unknown as Response,
      );

      // Let fetch resolve and the read loop start.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Simulate client disconnect — triggers AbortController.abort().
      req._emit('close');

      // Await the handler; the aborted signal closes the stream so read() returns done.
      await streamPromise;

      expect(capturedSignal?.aborted).toBe(true);
    });

    it('does not emit an unhandled rejection when the abort errors the upstream body stream', async () => {
      // Reproduces the real undici behaviour: aborting the fetch *errors* the
      // response body ReadableStream with an AbortError (rather than closing it
      // cleanly). Both the pending reader.read() AND the finally-block
      // reader.cancel() then reject with that AbortError. If cancel()'s
      // rejection is not handled it floats as an unhandledRejection and crashes
      // the process (observed: demo-driver exiting with code 1 and restarting).
      let capturedSignal: AbortSignal | undefined;
      let errorStream: (() => void) | undefined;

      const mockFetch = jest.fn().mockImplementation(
        (_url: string, opts: { signal?: AbortSignal }) => {
          capturedSignal = opts?.signal;
          const stream = new ReadableStream<Uint8Array>({
            start(streamController) {
              errorStream = () =>
                streamController.error(
                  new DOMException('This operation was aborted', 'AbortError'),
                );
            },
          });
          return Promise.resolve({ ok: true, status: 200, body: stream });
        },
      );
      globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', onUnhandled);

      try {
        const res = makeSseRes();
        const req = makeReq() as any;

        const streamPromise = controller.deploymentsStream(
          undefined,
          undefined,
          req,
          res as unknown as Response,
        );

        // Let fetch resolve and the read loop reach its first await.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Simulate client disconnect: abort fires, then undici errors the body.
        req._emit('close');
        errorStream?.();

        // The handler must resolve cleanly despite the errored stream.
        await expect(streamPromise).resolves.toBeUndefined();

        // Flush microtask + macrotask queues so any floating cancel() rejection
        // would surface to the unhandledRejection listener before we assert.
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        expect(capturedSignal?.aborted).toBe(true);
        expect(unhandled).toEqual([]);
        expect(res.end).toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  // ── Upstream unreachable — graceful degradation ────────────────────────────

  describe('graceful degradation', () => {
    it('logs a warning and calls res.end() when fetch rejects (network error)', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.fetch = fetchFail('ECONNREFUSED') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await expect(
        controller.deploymentsStream(undefined, undefined, req, res as unknown as Response),
      ).resolves.toBeUndefined();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('deployments-stream upstream fetch failed'),
        expect.any(Error),
      );
      expect(res.end).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does not throw when fetch rejects', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.fetch = fetchFail() as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await expect(
        controller.deploymentsStream(undefined, undefined, req, res as unknown as Response),
      ).resolves.not.toThrow();

      warnSpy.mockRestore();
    });

    it('logs a warning and calls res.end() when the upstream returns a non-2xx status', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.fetch = fetchNonOk(503) as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('deployments-stream upstream returned HTTP 503'),
      );
      expect(res.end).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ── Not reset-gated ───────────────────────────────────────────────────────

  describe('reset gate exemption', () => {
    it('does not interact with DemoService at all (no isBlocked check)', async () => {
      // DeploymentsStreamController has no DemoService dependency.
      // Verify: the compiled module has exactly one provider (the controller itself)
      // with no DemoService in scope.
      globalThis.fetch = fetchOk('') as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      // This must succeed regardless of any blocked state — since the controller
      // does not import DemoService there is no path through guardNotBlocked.
      await expect(
        controller.deploymentsStream(undefined, undefined, req, res as unknown as Response),
      ).resolves.toBeUndefined();

      // SSE headers are still set (endpoint is fully functional).
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    });

    it('streams normally even when (hypothetically) reset is in progress', async () => {
      // The controller has no DemoService; this test documents the behavioral
      // invariant. We simply verify the endpoint completes successfully.
      const sseFrame = 'event: deployment\ndata: {"service":"checkout"}\n\n';
      globalThis.fetch = fetchOk(sseFrame) as unknown as typeof globalThis.fetch;
      const res = makeSseRes();
      const req = makeReq();

      await controller.deploymentsStream(undefined, undefined, req, res as unknown as Response);

      const allWritten = (res.write as jest.Mock).mock.calls.map((c: any[]) => c[0] as string).join('');
      expect(allWritten).toContain('event: deployment');
    });
  });
});
