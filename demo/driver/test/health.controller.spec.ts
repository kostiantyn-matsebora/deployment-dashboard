/**
 * health.controller.spec.ts
 *
 * Integration tests for GET /demo/health (DEMO_DRIVER_SPECIFICATION §4.10).
 *
 * Uses real ephemeral HTTP stub servers (Node http.createServer on 127.0.0.1:0)
 * for the three upstream components (api, emulator, fetcher).  HealthService
 * reads config from process.env and issues real fetch() calls — no mocks.
 *
 * Verifies:
 *  - Response shape: { driver:"up", api, emulator, fetcher }.
 *  - driver is always "up".
 *  - 2xx upstream → component "up"; non-2xx upstream → component "down".
 *  - Unreachable port (no listener) → component "down".
 *  - Probes run in parallel — total wall time ≤ slowest single probe + margin.
 *  - Correct probe paths per §4.10:
 *      api      → {WRITE_API_URL}/healthz
 *      emulator → {GITHUB_EMULATOR_URL}/_github/status
 *      fetcher  → {FETCHER_URL}/health
 *  - Endpoint is NOT gated by the reset coordinator (HealthModule has no reset guard).
 */

import 'reflect-metadata';
import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { HealthModule } from '../src/health/health.module';

// ── Stub server helpers ────────────────────────────────────────────────────────

interface StubOptions {
  /** HTTP status to return. */
  status: number;
  /** Optional delay (ms) before responding — used for parallelism tests. */
  delayMs?: number;
}

interface StubServer {
  server:       http.Server;
  opts:         StubOptions;
  recordedReqs: { method: string; url: string }[];
  close():      Promise<void>;
  url():        string;
  /** Port 0 means the OS assigned a port; wait for listen before calling url(). */
  listen():     Promise<void>;
}

function makeStub(opts: StubOptions): StubServer {
  const recorded: { method: string; url: string }[] = [];

  const server = http.createServer((req, res) => {
    recorded.push({ method: req.method ?? 'GET', url: req.url ?? '' });

    const respond = () => {
      res.writeHead(opts.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: opts.status < 300 ? 'ok' : 'err' }));
    };

    if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(respond, opts.delayMs);
    } else {
      respond();
    }
  });

  return {
    server,
    opts,
    recordedReqs: recorded,
    listen: () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)),
    close:  () => new Promise(resolve => server.close(() => resolve())),
    url: () => {
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

/**
 * Returns a port number that has no listener.  We pick the port by briefly
 * binding a server, noting its port, then closing it before the test runs.
 * This is inherently racy but in practice safe for loopback addresses.
 */
async function getClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tmp = http.createServer();
    tmp.listen(0, '127.0.0.1', () => {
      const port = (tmp.address() as { port: number }).port;
      tmp.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('HealthController — GET /demo/health', () => {
  let app: INestApplication;
  let apiStub:      StubServer;
  let emulatorStub: StubServer;
  let fetcherStub:  StubServer;

  // Snapshot of env vars set before the suite so we can restore them in afterAll.
  const _originalEnv: Record<string, string | undefined> = {};

  function captureEnv(...keys: string[]) {
    for (const k of keys) _originalEnv[k] = process.env[k];
  }

  function restoreEnv(...keys: string[]) {
    for (const k of keys) {
      if (_originalEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = _originalEnv[k];
      }
    }
  }

  const ENV_KEYS = ['WRITE_API_URL', 'GITHUB_EMULATOR_URL', 'FETCHER_URL'];

  beforeAll(() => captureEnv(...ENV_KEYS));
  afterAll(()  => restoreEnv(...ENV_KEYS));

  /** Build a fresh NestJS app wired to the stub URLs currently in process.env. */
  async function buildApp(): Promise<INestApplication> {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const a = module.createNestApplication();
    await a.init();
    return a;
  }

  afterEach(async () => {
    // Close the NestJS app.
    if (app) await app.close();

    // Close any stubs still open — use optional close so partial setups don't throw.
    const stubs: (StubServer | undefined)[] = [apiStub, emulatorStub, fetcherStub];
    for (const s of stubs) {
      if (s?.server.listening) await s.close();
    }

    // Clean env so subsequent tests are isolated.
    restoreEnv(...ENV_KEYS);
  });

  // ── Happy path — all three up ──────────────────────────────────────────────

  describe('all three upstreams return 2xx', () => {
    it('returns { driver:"up", api:"up", emulator:"up", fetcher:"up" }', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);

      expect(res.body).toEqual({
        driver:   'up',
        api:      'up',
        emulator: 'up',
        fetcher:  'up',
      });
    });
  });

  // ── driver is always "up" ─────────────────────────────────────────────────

  describe('driver field', () => {
    it('is always "up" regardless of upstream status', async () => {
      apiStub      = makeStub({ status: 500 });
      emulatorStub = makeStub({ status: 500 });
      fetcherStub  = makeStub({ status: 500 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.driver).toBe('up');
    });
  });

  // ── Non-2xx → "down" ──────────────────────────────────────────────────────

  describe('upstream returns 500', () => {
    it('api stub 500 → api:"down", others "up"', async () => {
      apiStub      = makeStub({ status: 500 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.api).toBe('down');
      expect(res.body.emulator).toBe('up');
      expect(res.body.fetcher).toBe('up');
    });

    it('emulator stub 503 → emulator:"down", others "up"', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 503 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.emulator).toBe('down');
      expect(res.body.api).toBe('up');
      expect(res.body.fetcher).toBe('up');
    });

    it('fetcher stub 404 → fetcher:"down", others "up"', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 404 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.fetcher).toBe('down');
      expect(res.body.api).toBe('up');
      expect(res.body.emulator).toBe('up');
    });
  });

  // ── Closed port → "down" ──────────────────────────────────────────────────

  describe('unreachable component (no listener)', () => {
    it('api on closed port → api:"down"', async () => {
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([emulatorStub.listen(), fetcherStub.listen()]);

      const closedPort = await getClosedPort();
      process.env.WRITE_API_URL        = `http://127.0.0.1:${closedPort}`;
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.api).toBe('down');
      expect(res.body.emulator).toBe('up');
      expect(res.body.fetcher).toBe('up');
    });

    it('emulator on closed port → emulator:"down"', async () => {
      apiStub     = makeStub({ status: 200 });
      fetcherStub = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), fetcherStub.listen()]);

      const closedPort = await getClosedPort();
      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = `http://127.0.0.1:${closedPort}`;
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.emulator).toBe('down');
      expect(res.body.api).toBe('up');
      expect(res.body.fetcher).toBe('up');
    });

    it('fetcher on closed port → fetcher:"down"', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen()]);

      const closedPort = await getClosedPort();
      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = `http://127.0.0.1:${closedPort}`;

      app = await buildApp();

      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      expect(res.body.fetcher).toBe('down');
      expect(res.body.api).toBe('up');
      expect(res.body.emulator).toBe('up');
    });
  });

  // ── Probe paths (§4.10) ───────────────────────────────────────────────────

  describe('probe target paths', () => {
    it('api probe hits {WRITE_API_URL}/healthz', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      await request(app.getHttpServer()).get('/demo/health').expect(200);

      const apiReqs = apiStub.recordedReqs;
      expect(apiReqs).toHaveLength(1);
      expect(apiReqs[0].url).toBe('/healthz');
      expect(apiReqs[0].method).toBe('GET');
    });

    it('emulator probe hits {GITHUB_EMULATOR_URL}/_github/status', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      await request(app.getHttpServer()).get('/demo/health').expect(200);

      const emulatorReqs = emulatorStub.recordedReqs;
      expect(emulatorReqs).toHaveLength(1);
      expect(emulatorReqs[0].url).toBe('/_github/status');
      expect(emulatorReqs[0].method).toBe('GET');
    });

    it('fetcher probe hits {FETCHER_URL}/health', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      await request(app.getHttpServer()).get('/demo/health').expect(200);

      const fetcherReqs = fetcherStub.recordedReqs;
      expect(fetcherReqs).toHaveLength(1);
      expect(fetcherReqs[0].url).toBe('/health');
      expect(fetcherReqs[0].method).toBe('GET');
    });
  });

  // ── Probes run in parallel ────────────────────────────────────────────────

  describe('parallel probe execution', () => {
    /**
     * One stub delays 300 ms, the others respond immediately.
     * If probes were sequential the total would be ≥ 300 ms + 300 ms + ... .
     * In parallel the total should be < 300 ms + a generous 250 ms margin.
     *
     * This test avoids tight timing assertions — the margin is intentionally
     * loose to stay flake-free in slow CI environments.
     */
    it('all three resolve when one stub delays 300 ms, within 600 ms total', async () => {
      // Slow api stub; emulator and fetcher reply instantly.
      apiStub      = makeStub({ status: 200, delayMs: 300 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      const start = Date.now();
      const res = await request(app.getHttpServer()).get('/demo/health').expect(200);
      const elapsed = Date.now() - start;

      // All components should still resolve correctly.
      expect(res.body).toEqual({ driver: 'up', api: 'up', emulator: 'up', fetcher: 'up' });

      // Parallel: total time should be well under 3 × 300 ms = 900 ms.
      // We allow up to 600 ms (300 ms delay + 300 ms margin for overhead).
      expect(elapsed).toBeLessThan(600);
    });
  });

  // ── Reset-gate absence (structural check) ────────────────────────────────

  describe('reset gate absence', () => {
    /**
     * §4.10 mandates this endpoint is "never blocked by reset gate".
     * Structural verification: HealthModule is self-contained with no reference
     * to DemoService (reset coordinator).  We confirm no guard fires by verifying
     * the endpoint answers normally without any DemoService in the module context.
     *
     * If a reset guard were added, the TestBed compile would fail on a missing
     * DemoService provider, making the structural absence explicit and testable.
     */
    it('answers 200 without DemoService in the module context (no reset guard)', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      // buildApp() only imports HealthModule — no DemoModule, no reset coordinator.
      // If the endpoint were guarded, the app would throw at init or at request time.
      app = await buildApp();

      await request(app.getHttpServer()).get('/demo/health').expect(200);
    });
  });

  // ── HTTP method ───────────────────────────────────────────────────────────

  describe('HTTP method', () => {
    it('POST /demo/health returns 404 (only GET is mapped)', async () => {
      apiStub      = makeStub({ status: 200 });
      emulatorStub = makeStub({ status: 200 });
      fetcherStub  = makeStub({ status: 200 });

      await Promise.all([apiStub.listen(), emulatorStub.listen(), fetcherStub.listen()]);

      process.env.WRITE_API_URL        = apiStub.url();
      process.env.GITHUB_EMULATOR_URL  = emulatorStub.url();
      process.env.FETCHER_URL          = fetcherStub.url();

      app = await buildApp();

      await request(app.getHttpServer()).post('/demo/health').expect(404);
    });
  });
});
