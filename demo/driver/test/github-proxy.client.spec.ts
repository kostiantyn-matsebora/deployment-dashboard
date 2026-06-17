/**
 * github-proxy.client.spec.ts
 *
 * Tests the GithubProxyClient HTTP client in isolation using a real minimal
 * HTTP server (not a mock) as the upstream to validate the forwarding behaviour.
 *
 * Verifies:
 *  - Correct upstream URL construction ({GITHUB_EMULATOR_URL}/_github/{path}).
 *  - Body passed through verbatim on POST.
 *  - Upstream non-2xx status surfaced as-is.
 *  - Network error (unreachable upstream) → 502.
 *  - Upstream timeout (fetch rejects with TimeoutError) → 504.
 */

import * as http from 'http';
import { GithubProxyClient } from '../src/github/github-proxy.client';
import { getConfig } from '../src/config/configuration';

// ── Minimal stub HTTP server ───────────────────────────────────────────────────

interface StubRequest {
  method: string;
  url:    string;
  body:   string;
}

/**
 * Creates an HTTP server that records the last request and returns a
 * configurable status + JSON body.
 */
function makeStubServer(
  status: number,
  responseBody: unknown,
): {
  server:    http.Server;
  lastReq:   () => StubRequest;
  close:     () => Promise<void>;
  baseUrl:   () => string;
} {
  let lastReq: StubRequest = { method: '', url: '', body: '' };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      lastReq = { method: req.method ?? '', url: req.url ?? '', body };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });

  return {
    server,
    lastReq:  () => lastReq,
    close:    () => new Promise(resolve => server.close(() => resolve())),
    baseUrl:  () => {
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function listenStub(stub: ReturnType<typeof makeStubServer>): Promise<void> {
  return new Promise(resolve => stub.server.listen(0, '127.0.0.1', resolve));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GithubProxyClient', () => {
  afterEach(() => {
    // Reset env so other tests are not affected
    delete process.env.GITHUB_EMULATOR_URL;
    delete process.env.GITHUB_EMULATOR_TIMEOUT_MS;
  });

  describe('GET requests', () => {
    it('forwards GET to {GITHUB_EMULATOR_URL}/_github/{path} and returns status+body', async () => {
      const stub = makeStubServer(200, { dataset: 'demo', repos: 2 });
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        const result = await client.get('status');

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ dataset: 'demo', repos: 2 });

        const req = stub.lastReq();
        expect(req.method).toBe('GET');
        expect(req.url).toBe('/_github/status');
      } finally {
        await stub.close();
      }
    });

    it('surfaces upstream non-2xx status as-is', async () => {
      const stub = makeStubServer(503, { message: 'unavailable' });
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        const result = await client.get('status');

        expect(result.status).toBe(503);
      } finally {
        await stub.close();
      }
    });

    it('returns 502 when the upstream is unreachable', async () => {
      process.env.GITHUB_EMULATOR_URL = 'http://127.0.0.1:1'; // nothing listening
      const client = new GithubProxyClient();
      const result = await client.get('status');

      expect(result.status).toBe(502);
    });
  });

  describe('POST requests', () => {
    it('forwards POST body verbatim to /_github/{path}', async () => {
      const payload  = { dataset: 'random', count: 3, reset: true };
      const stub     = makeStubServer(200, { repos: 3, dataset: 'random' });
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        await client.post('seed', payload);

        const req = stub.lastReq();
        expect(req.method).toBe('POST');
        expect(req.url).toBe('/_github/seed');
        expect(JSON.parse(req.body)).toMatchObject(payload);
      } finally {
        await stub.close();
      }
    });

    it('returns upstream status and body verbatim', async () => {
      const stub = makeStubServer(200, { emitting: true });
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        const result = await client.post('emit', { enabled: true });

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ emitting: true });
      } finally {
        await stub.close();
      }
    });

    it('surfaces upstream non-2xx on POST as-is', async () => {
      const stub = makeStubServer(400, { message: 'bad dataset' });
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        const result = await client.post('seed', { dataset: 'bad' });

        expect(result.status).toBe(400);
      } finally {
        await stub.close();
      }
    });

    it('returns 502 on POST when upstream is unreachable', async () => {
      process.env.GITHUB_EMULATOR_URL = 'http://127.0.0.1:1';
      const client = new GithubProxyClient();
      const result = await client.post('seed', {});

      expect(result.status).toBe(502);
    });
  });

  describe('URL construction', () => {
    it('uses GITHUB_EMULATOR_URL from config without double-slash', async () => {
      const stub = makeStubServer(200, {});
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        const client = new GithubProxyClient();
        await client.get('emit');

        const req = stub.lastReq();
        expect(req.url).toBe('/_github/emit');
        // URL must not contain double-slash (e.g. /_github//emit)
        expect(req.url).not.toContain('//');
      } finally {
        await stub.close();
      }
    });
  });

  describe('timeout handling', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      // Restore the real fetch after each substitution
      globalThis.fetch = originalFetch;
    });

    it('returns 504 when fetch rejects with a TimeoutError on GET', async () => {
      process.env.GITHUB_EMULATOR_URL     = 'http://127.0.0.1:1';
      process.env.GITHUB_EMULATOR_TIMEOUT_MS = '50';

      const timeoutError  = new Error('The operation was aborted due to timeout');
      timeoutError.name   = 'TimeoutError';
      globalThis.fetch    = () => Promise.reject(timeoutError);

      const client = new GithubProxyClient();
      const result = await client.get('status');

      expect(result.status).toBe(504);
      expect(result.body).toMatchObject({ error: 'upstream timeout' });
    });

    it('returns 504 when fetch rejects with a TimeoutError on POST', async () => {
      process.env.GITHUB_EMULATOR_URL     = 'http://127.0.0.1:1';
      process.env.GITHUB_EMULATOR_TIMEOUT_MS = '50';

      const timeoutError  = new Error('The operation was aborted due to timeout');
      timeoutError.name   = 'TimeoutError';
      globalThis.fetch    = () => Promise.reject(timeoutError);

      const client = new GithubProxyClient();
      const result = await client.post('emit', { enabled: true });

      expect(result.status).toBe(504);
      expect(result.body).toMatchObject({ error: 'upstream timeout' });
    });

    it('still returns 502 for non-timeout network errors', async () => {
      process.env.GITHUB_EMULATOR_URL = 'http://127.0.0.1:1';

      const networkError = new Error('connection refused');
      // name is 'Error', not 'TimeoutError' — should fall through to 502
      globalThis.fetch   = () => Promise.reject(networkError);

      const client = new GithubProxyClient();
      const result = await client.get('status');

      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ error: 'upstream network error' });
    });

    it('passes AbortSignal.timeout to fetch with the configured timeout', async () => {
      process.env.GITHUB_EMULATOR_URL        = 'http://127.0.0.1:1';
      process.env.GITHUB_EMULATOR_TIMEOUT_MS = '7000';

      let capturedSignal: AbortSignal | undefined;
      const stub = makeStubServer(200, {});
      await listenStub(stub);

      try {
        process.env.GITHUB_EMULATOR_URL = stub.baseUrl();
        globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
          capturedSignal = init?.signal ?? undefined;
          // delegate to the real fetch so the stub responds normally
          return originalFetch(url, { ...init, signal: undefined });
        };

        const client = new GithubProxyClient();
        await client.get('status');

        expect(capturedSignal).toBeDefined();
        expect(capturedSignal!.aborted).toBe(false);
      } finally {
        await stub.close();
      }
    });
  });
});
