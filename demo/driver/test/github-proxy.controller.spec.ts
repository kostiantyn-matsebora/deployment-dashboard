/**
 * github-proxy.controller.spec.ts
 *
 * Integration test for GithubProxyController. Uses a real minimal HTTP server
 * as the upstream emulator (avoids cross-package dependency) and a real
 * NestJS TestBed for the driver controller.
 *
 * Verifies per DEMO_DRIVER_SPECIFICATION §10:
 *  - GET status + GET emit are forwarded verbatim (never blocked).
 *  - POST seed / clear / emit forward body+response verbatim when not blocked.
 *  - POST mutators return 503 RFC 9457 application/problem+json + Retry-After
 *    while DemoService.isBlocked() is true.
 *  - GET /demo/github/status is NOT blocked during reset.
 *  - Non-2xx upstream responses surfaced as-is.
 */

import 'reflect-metadata';
import * as http from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import { Subject } from 'rxjs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { GithubProxyController } from '../src/github/github-proxy.controller';
import { GithubProxyClient }     from '../src/github/github-proxy.client';
import { DemoService }           from '../src/demo/demo.service';

// ── Minimal stub emulator HTTP server ─────────────────────────────────────────

interface StubConfig {
  /** Status code to return for all requests. */
  status: number;
  /** Body to return for all requests. */
  body:   unknown;
}

interface StubServer {
  server:  http.Server;
  config:  StubConfig;
  close(): Promise<void>;
  url():   string;
}

function makeStubEmulator(initialStatus = 200, initialBody: unknown = {}): StubServer {
  const cfg: StubConfig = { status: initialStatus, body: initialBody };

  const server = http.createServer((req, res) => {
    res.writeHead(cfg.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cfg.body));
  });

  return {
    server,
    config: cfg,
    close: () => new Promise(resolve => server.close(() => resolve())),
    url:   () => {
      const addr = server.address() as { port: number };
      return `http://127.0.0.1:${addr.port}`;
    },
  };
}

// ── DemoService stub ──────────────────────────────────────────────────────────

let _blocked = false;

const demoServiceStub = {
  isBlocked:            () => _blocked,
  getRetryAfterSeconds: () => 90,
  stream$:              new Subject(),
};

// ── Minimal test module ───────────────────────────────────────────────────────

@Module({
  controllers: [GithubProxyController],
  providers: [
    GithubProxyClient,
    { provide: DemoService, useValue: demoServiceStub },
  ],
})
class ProxyTestModule {}

// ── Helpers ───────────────────────────────────────────────────────────────────

type SupertestResponse = Awaited<ReturnType<ReturnType<typeof request>['get']>>;

function expectResetBlockedResponse(res: SupertestResponse): void {
  expect(res.status).toBe(503);
  expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  expect(res.headers['retry-after']).toBeDefined();
  const retryAfter = parseInt(res.headers['retry-after'] as string, 10);
  expect(retryAfter).toBeGreaterThan(0);
  expect(res.body.type).toContain('reset-in-progress');
  expect(res.body.title).toBe('Reset in progress');
  expect(res.body.status).toBe(503);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GithubProxyController (integration)', () => {
  let driverApp: INestApplication;
  let stub:      StubServer;

  beforeEach(async () => {
    _blocked = false;

    // Start the stub emulator on a random port
    stub = makeStubEmulator(200, { dataset: 'demo', repos: 2, emitting: false });
    await new Promise<void>(resolve => stub.server.listen(0, '127.0.0.1', resolve));

    // Point the proxy client at the stub
    process.env.GITHUB_EMULATOR_URL = stub.url();

    // Build the driver controller app
    const module: TestingModule = await Test.createTestingModule({
      imports: [ProxyTestModule],
    }).compile();

    driverApp = module.createNestApplication();
    await driverApp.init();
  });

  afterEach(async () => {
    await driverApp.close();
    await stub.close();
    delete process.env.GITHUB_EMULATOR_URL;
  });

  // ── Read routes — never blocked ───────────────────────────────────────────

  describe('GET /demo/github/status', () => {
    it('forwards to upstream and returns 200 + body when not blocked', async () => {
      stub.config.body   = { dataset: 'demo', repos: 2, emitting: false };
      stub.config.status = 200;

      const res = await request(driverApp.getHttpServer())
        .get('/demo/github/status')
        .expect(200);

      expect(res.body).toMatchObject({ dataset: 'demo', repos: 2 });
    });

    it('is NOT blocked even when DemoService.isBlocked() is true', async () => {
      _blocked = true;
      await request(driverApp.getHttpServer())
        .get('/demo/github/status')
        .expect(200);
    });
  });

  describe('GET /demo/github/emit', () => {
    it('forwards to upstream and returns emitting status', async () => {
      stub.config.body   = { emitting: false };
      stub.config.status = 200;

      const res = await request(driverApp.getHttpServer())
        .get('/demo/github/emit')
        .expect(200);

      expect(res.body).toMatchObject({ emitting: false });
    });

    it('is NOT blocked during reset', async () => {
      _blocked = true;
      await request(driverApp.getHttpServer())
        .get('/demo/github/emit')
        .expect(200);
    });
  });

  // ── Mutator routes — forwarded when not blocked ───────────────────────────

  describe('POST /demo/github/seed (not blocked)', () => {
    it('forwards to upstream and returns upstream body', async () => {
      stub.config.body   = { dataset: 'random', repos: 3 };
      stub.config.status = 200;

      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/seed')
        .send({ dataset: 'random', count: 3 })
        .expect(200);

      expect(res.body).toMatchObject({ dataset: 'random', repos: 3 });
    });
  });

  describe('POST /demo/github/clear (not blocked)', () => {
    it('forwards to upstream and returns upstream body', async () => {
      stub.config.body   = { repos: 0, deployments: 0 };
      stub.config.status = 200;

      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/clear')
        .expect(200);

      expect(res.body).toMatchObject({ repos: 0 });
    });
  });

  describe('POST /demo/github/emit (not blocked)', () => {
    it('forwards to upstream and returns emitting true', async () => {
      stub.config.body   = { emitting: true };
      stub.config.status = 200;

      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/emit')
        .send({ enabled: true })
        .expect(200);

      expect(res.body).toMatchObject({ emitting: true });
    });
  });

  // ── Mutator routes — 503 when blocked ─────────────────────────────────────

  describe('reset-blocked gate (503 RFC 9457)', () => {
    beforeEach(() => { _blocked = true; });

    it('POST /demo/github/seed returns 503 while blocked', async () => {
      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/seed')
        .send({ dataset: 'random' });

      expectResetBlockedResponse(res);
    });

    it('POST /demo/github/clear returns 503 while blocked', async () => {
      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/clear');

      expectResetBlockedResponse(res);
    });

    it('POST /demo/github/emit returns 503 while blocked', async () => {
      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/emit')
        .send({ enabled: true });

      expectResetBlockedResponse(res);
    });

    it('GET /demo/github/status is NOT blocked (returns 200)', async () => {
      await request(driverApp.getHttpServer())
        .get('/demo/github/status')
        .expect(200);
    });

    it('GET /demo/github/emit is NOT blocked (returns 200)', async () => {
      await request(driverApp.getHttpServer())
        .get('/demo/github/emit')
        .expect(200);
    });
  });

  // ── Upstream non-2xx surfaced as-is ──────────────────────────────────────

  describe('upstream non-2xx passthrough', () => {
    it('surfaces upstream 400 as 400', async () => {
      stub.config.status = 400;
      stub.config.body   = { message: 'bad dataset' };

      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/seed')
        .send({ dataset: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ message: 'bad dataset' });
    });

    it('surfaces upstream 503 as 503', async () => {
      stub.config.status = 503;
      stub.config.body   = { error: 'unavailable' };

      const res = await request(driverApp.getHttpServer())
        .post('/demo/github/seed')
        .send({ dataset: 'demo' });

      expect(res.status).toBe(503);
    });
  });

  // ── Body forwarding ───────────────────────────────────────────────────────

  describe('request body forwarding', () => {
    it('POST body is forwarded verbatim to upstream', async () => {
      let receivedBody = '';
      const verifyServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          receivedBody = body;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        });
      });

      await new Promise<void>(r => verifyServer.listen(0, '127.0.0.1', r));
      const verifyAddr = (verifyServer.address() as { port: number }).port;

      process.env.GITHUB_EMULATOR_URL = `http://127.0.0.1:${verifyAddr}`;

      // Rebuild driver app with the new URL
      await driverApp.close();
      const module2: TestingModule = await Test.createTestingModule({
        imports: [ProxyTestModule],
      }).compile();
      const driverApp2 = module2.createNestApplication();
      await driverApp2.init();

      try {
        await request(driverApp2.getHttpServer())
          .post('/demo/github/seed')
          .send({ dataset: 'random', count: 5 });

        expect(JSON.parse(receivedBody)).toMatchObject({ dataset: 'random', count: 5 });
      } finally {
        await driverApp2.close();
        await new Promise<void>(r => verifyServer.close(() => r()));
      }
    });
  });
});
