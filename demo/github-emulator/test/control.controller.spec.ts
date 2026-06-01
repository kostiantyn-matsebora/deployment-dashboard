/**
 * POST /_github/* are action-style control endpoints (not resource creation),
 * so they return 200. The handlers set res.status(200) explicitly before res.json()
 * (NestJS would otherwise default @Res() POST routes to 201).
 */

import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { GithubStoreService } from '../src/github-store.service';

/** Expected status for POST action endpoints (action-style → 200). */
const POST_EXPECTED_STATUS = 200;

describe('ControlController (/_github/*)', () => {
  let app: INestApplication;
  let storeService: GithubStoreService;

  beforeEach(async () => {
    // Disable startup seeding so each test starts with an empty store
    process.env.SEED_ON_STARTUP = 'false';

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    storeService = app.get(GithubStoreService);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.SEED_ON_STARTUP;
  });

  // ── GET /_github/status ────────────────────────────────────────────────────

  describe('GET /_github/status', () => {
    it('returns GithubStoreStatus shape with all required fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/_github/status')
        .expect(200);

      expect(typeof res.body.dataset).toBe('string');
      expect(typeof res.body.repos).toBe('number');
      expect(typeof res.body.deployments).toBe('number');
      expect(typeof res.body.statuses).toBe('number');
      expect(typeof res.body.workflows).toBe('number');
      expect(typeof res.body.environments).toBe('number');
      expect(typeof res.body.emitting).toBe('boolean');
      // seeded_at may be null
      expect('seeded_at' in res.body).toBe(true);
    });

    it('starts with empty counters when not seeded', async () => {
      const res = await request(app.getHttpServer())
        .get('/_github/status')
        .expect(200);

      expect(res.body.repos).toBe(0);
      expect(res.body.deployments).toBe(0);
    });
  });

  // ── POST /_github/seed ─────────────────────────────────────────────────────

  describe('POST /_github/seed', () => {
    it('seeds random dataset and returns updated status', async () => {
      const res = await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 2, reset: false })
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.repos).toBeGreaterThan(0);
      expect(res.body.dataset).toBe('random');
    });

    it('seeds demo dataset and returns updated status', async () => {
      const res = await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'demo', reset: false })
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.repos).toBeGreaterThanOrEqual(2);
      expect(res.body.dataset).toBe('demo');
    });

    it('reset:true clears the store before seeding', async () => {
      // First seed 5 services
      await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 5 });

      // Seed again with reset=true and count=1 — result should reflect only 1 service
      const res = await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 1, reset: true })
        .expect(POST_EXPECTED_STATUS);

      // After reset, only the 1-service random seed should be present
      expect(res.body.repos).toBe(1);
    });

    it('returns 400 for an invalid dataset value', async () => {
      await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'invalid' })
        .expect(400);
    });

    it('seeded_at is populated after seeding', async () => {
      const res = await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 1 })
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.seeded_at).not.toBeNull();
    });
  });

  // ── POST /_github/clear ────────────────────────────────────────────────────

  describe('POST /_github/clear', () => {
    it('empties the store and returns zeroed status', async () => {
      // Seed first
      await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 3 });

      const res = await request(app.getHttpServer())
        .post('/_github/clear')
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.repos).toBe(0);
      expect(res.body.deployments).toBe(0);
      expect(res.body.statuses).toBe(0);
    });

    it('seeded_at is null after clear', async () => {
      await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 1 });

      const res = await request(app.getHttpServer())
        .post('/_github/clear')
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.seeded_at).toBeNull();
    });
  });

  // ── GET /_github/emit ──────────────────────────────────────────────────────

  describe('GET /_github/emit', () => {
    it('returns { emitting: false } initially', async () => {
      const res = await request(app.getHttpServer())
        .get('/_github/emit')
        .expect(200);

      expect(res.body).toEqual({ emitting: false });
    });
  });

  // ── POST /_github/emit ─────────────────────────────────────────────────────

  describe('POST /_github/emit', () => {
    afterEach(async () => {
      // Always disable emit after each test to avoid timer leakage
      await request(app.getHttpServer())
        .post('/_github/emit')
        .send({ enabled: false });
    });

    it('enables emitting when { enabled: true }', async () => {
      const res = await request(app.getHttpServer())
        .post('/_github/emit')
        .send({ enabled: true })
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.emitting).toBe(true);
    });

    it('disables emitting when { enabled: false }', async () => {
      // Enable first
      await request(app.getHttpServer())
        .post('/_github/emit')
        .send({ enabled: true });

      const res = await request(app.getHttpServer())
        .post('/_github/emit')
        .send({ enabled: false })
        .expect(POST_EXPECTED_STATUS);

      expect(res.body.emitting).toBe(false);
    });

    it('toggles emitting when body has no enabled field', async () => {
      // starts false → toggle → true
      const res1 = await request(app.getHttpServer())
        .post('/_github/emit')
        .send({})
        .expect(POST_EXPECTED_STATUS);
      expect(res1.body.emitting).toBe(true);

      // toggle again → false
      const res2 = await request(app.getHttpServer())
        .post('/_github/emit')
        .send({})
        .expect(POST_EXPECTED_STATUS);
      expect(res2.body.emitting).toBe(false);
    });

    it('status reflects emitting state', async () => {
      await request(app.getHttpServer())
        .post('/_github/emit')
        .send({ enabled: true });

      const statusRes = await request(app.getHttpServer())
        .get('/_github/status')
        .expect(200);

      expect(statusRes.body.emitting).toBe(true);
    });
  });

  // ── Seed + clear mutate the store (integration assertions) ─────────────────

  describe('seed then clear cycle', () => {
    it('counters match seeded data, then drop to zero on clear', async () => {
      const seedRes = await request(app.getHttpServer())
        .post('/_github/seed')
        .send({ dataset: 'random', count: 2 })
        .expect(POST_EXPECTED_STATUS);

      expect(seedRes.body.repos).toBe(2);
      expect(seedRes.body.deployments).toBeGreaterThan(0);

      const clearRes = await request(app.getHttpServer())
        .post('/_github/clear')
        .expect(POST_EXPECTED_STATUS);

      expect(clearRes.body.repos).toBe(0);
      expect(clearRes.body.deployments).toBe(0);
      expect(clearRes.body.statuses).toBe(0);
    });
  });
});
