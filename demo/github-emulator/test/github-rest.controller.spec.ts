/**
 * github-rest.controller.spec.ts
 *
 * Tests all 9 emulated GitHub REST endpoints:
 *  GET /repos/:owner/:repo/deployments
 *  GET /repos/:owner/:repo/deployments/:id/statuses
 *  GET /repos/:owner/:repo/actions/runs/:run_id
 *  GET /repos/:owner/:repo/contents/:path?ref=
 *  GET /repos/:owner/:repo/actions/workflows
 *  GET /repos/:owner/:repo/environments
 *  GET /repos/:owner/:repo/actions/runs/:run_id/artifacts
 *  GET /repos/:owner/:repo/actions/artifacts/:artifact_id/zip
 *  GET /rate_limit
 *
 * Verifies:
 *  - Correct response shape (fields match GhModels in the fetcher).
 *  - X-RateLimit-* headers on every response.
 *  - Link: rel="next" when more pages remain; absent on last page.
 *  - GitHub-shaped 404 (NOT RFC 9457) for unknown resources.
 *  - target_url contains /actions/runs/{run_id}.
 *  - Artifact zip yields a single file whose content is the version string.
 */

import 'reflect-metadata';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip    = require('jszip') as typeof import('jszip');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request  = require('supertest') as typeof import('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { GithubStoreService } from '../src/github-store.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function expectRateLimitHeaders(headers: Record<string, string>): void {
  expect(headers['x-ratelimit-limit']).toBeDefined();
  expect(headers['x-ratelimit-remaining']).toBeDefined();
  expect(headers['x-ratelimit-used']).toBeDefined();
  expect(headers['x-ratelimit-reset']).toBeDefined();
}

const GITHUB_404_SHAPE = {
  message:           'Not Found',
  documentation_url: 'https://docs.github.com/rest',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GithubRestController', () => {
  let app:          INestApplication;
  let storeService: GithubStoreService;

  const OWNER = 'test-org';
  const REPO  = 'test-repo';
  const SHA   = 'abc1234';
  const RUN_ID = 9001;
  const DEP_ID = 7001;
  const ART_ID = 5001;
  const WF_PATH = '.github/workflows/deploy.yml';
  const WF_YAML = `name: test-svc
on:
  push:
    branches: [main]
jobs:
  deploy-dev:
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - run: echo hello
  deploy-prod:
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - run: echo prod
`;
  const VERSION_STRING = 'v1.2.3';

  beforeEach(async () => {
    process.env.SEED_ON_STARTUP = 'false';

    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    storeService = app.get(GithubStoreService);

    // Populate the store with deterministic test data
    const store = storeService.getStore();
    const repo  = store.getOrCreateRepo(OWNER, REPO);

    // Workflow
    repo.workflows.push({ id: 101, name: 'test-svc', path: WF_PATH, state: 'active' });

    // Workflow YAML keyed by path::sha
    repo.workflowYaml.set(`${WF_PATH}::${SHA}`, WF_YAML);

    // Run
    repo.runs.set(RUN_ID, { id: RUN_ID, name: 'test-svc', path: WF_PATH, head_sha: SHA });

    // Environments
    repo.environments.push({ name: 'dev' }, { name: 'prod' });

    // Deployment
    repo.deployments.push({
      id:          DEP_ID,
      sha:         SHA,
      ref:         'refs/heads/main',
      environment: 'dev',
      payload:     { version: 'v1.2.3' },
      creator:     { login: 'alice' },
      created_at:  '2026-05-31T10:00:00Z',
    });

    // Statuses — target_url must embed /actions/runs/{run_id}
    const TARGET_URL = `http://github.com/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`;
    repo.statuses.set(DEP_ID, [
      {
        id:         80001,
        state:      'in_progress',
        target_url: TARGET_URL,
        creator:    { login: 'alice' },
        created_at: '2026-05-31T10:00:30Z',
      },
      {
        id:         80002,
        state:      'success',
        target_url: TARGET_URL,
        creator:    { login: 'alice' },
        created_at: '2026-05-31T10:02:00Z',
      },
    ]);

    // Artifact
    repo.artifacts.set(RUN_ID, [{
      id:       ART_ID,
      name:     'version.txt',
      expired:  false,
      _content: VERSION_STRING,
    }]);
  });

  afterEach(async () => {
    await app.close();
    delete process.env.SEED_ON_STARTUP;
  });

  // ── GET /rate_limit ─────────────────────────────────────────────────────────

  describe('GET /rate_limit', () => {
    it('returns correct shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/rate_limit')
        .expect(200);

      expect(res.body.resources).toBeDefined();
      expect(res.body.resources.core).toBeDefined();
      const core = res.body.resources.core;
      expect(typeof core.limit).toBe('number');
      expect(typeof core.remaining).toBe('number');
      expect(typeof core.used).toBe('number');
      expect(typeof core.reset).toBe('number');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/rate_limit')
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });
  });

  // ── GET /repos/:owner/:repo/deployments ─────────────────────────────────────

  describe('GET /repos/:owner/:repo/deployments', () => {
    it('returns array of deployment objects with correct fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const dep = res.body[0];
      expect(typeof dep.id).toBe('number');
      expect(typeof dep.sha).toBe('string');
      expect(typeof dep.ref).toBe('string');
      expect(typeof dep.environment).toBe('string');
      expect(dep.creator).toBeDefined();
      expect(typeof dep.creator.login).toBe('string');
      expect(typeof dep.created_at).toBe('string');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('filters by environment query param', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments?environment=dev`)
        .expect(200);

      expect(res.body.every((d: { environment: string }) => d.environment === 'dev')).toBe(true);
    });

    it('returns empty array for non-matching environment filter', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments?environment=nonexistent-env`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get('/repos/unknown-org/unknown-repo/deployments')
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    describe('pagination', () => {
      beforeEach(() => {
        // Add more deployments so pagination can be tested
        const store = storeService.getStore();
        const repo  = store.getRepo(OWNER, REPO)!;
        for (let i = 2; i <= 5; i++) {
          repo.deployments.push({
            id:          DEP_ID + i,
            sha:         SHA,
            ref:         'refs/heads/main',
            environment: 'prod',
            payload:     null,
            creator:     { login: 'bob' },
            created_at:  `2026-05-31T0${i}:00:00Z`,
          });
        }
      });

      it('Link: rel="next" is present when more pages remain', async () => {
        const res = await request(app.getHttpServer())
          .get(`/repos/${OWNER}/${REPO}/deployments?per_page=2&page=1`)
          .expect(200);

        expect(res.body).toHaveLength(2);
        expect(res.headers['link']).toContain('rel="next"');
      });

      it('Link header is absent on the last page', async () => {
        const totalRes = await request(app.getHttpServer())
          .get(`/repos/${OWNER}/${REPO}/deployments`)
          .expect(200);

        const total = totalRes.body.length;

        // Fetch all in one page
        const lastPageRes = await request(app.getHttpServer())
          .get(`/repos/${OWNER}/${REPO}/deployments?per_page=${total}&page=1`)
          .expect(200);

        expect(lastPageRes.headers['link']).toBeUndefined();
      });
    });
  });

  // ── GET /repos/:owner/:repo/deployments/:id/statuses ───────────────────────

  describe('GET /repos/:owner/:repo/deployments/:id/statuses', () => {
    it('returns array of status objects with correct fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${DEP_ID}/statuses`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const s = res.body[0];
      expect(typeof s.id).toBe('number');
      expect(typeof s.state).toBe('string');
      expect(typeof s.target_url).toBe('string');
      expect(s.creator).toBeDefined();
      expect(typeof s.creator.login).toBe('string');
      expect(typeof s.created_at).toBe('string');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${DEP_ID}/statuses`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('target_url embeds /actions/runs/{run_id}', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${DEP_ID}/statuses`)
        .expect(200);

      for (const s of res.body) {
        expect(s.target_url).toMatch(/\/actions\/runs\/\d+/);
      }
    });

    it('returns statuses newest-first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${DEP_ID}/statuses`)
        .expect(200);

      const dates = res.body.map((s: { created_at: string }) => new Date(s.created_at).getTime());
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
      }
    });

    it('returns GitHub-shaped 404 for unknown deployment id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/99999999/statuses`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/deployments/${DEP_ID}/statuses`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── GET /repos/:owner/:repo/actions/runs/:run_id ────────────────────────────

  describe('GET /repos/:owner/:repo/actions/runs/:run_id', () => {
    it('returns run metadata with correct fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`)
        .expect(200);

      expect(res.body.id).toBe(RUN_ID);
      expect(typeof res.body.name).toBe('string');
      expect(typeof res.body.path).toBe('string');
      expect(typeof res.body.head_sha).toBe('string');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('returns GitHub-shaped 404 for unknown run_id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/999`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/actions/runs/${RUN_ID}`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── GET /repos/:owner/:repo/contents/:path?ref= ─────────────────────────────

  describe('GET /repos/:owner/:repo/contents/:path', () => {
    it('returns base64-encoded workflow YAML', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/contents/${WF_PATH}?ref=${SHA}`)
        .expect(200);

      expect(res.body.encoding).toBe('base64');
      expect(typeof res.body.content).toBe('string');

      const decoded = Buffer.from(res.body.content, 'base64').toString('utf-8');
      expect(decoded).toContain('environment: dev');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/contents/${WF_PATH}?ref=${SHA}`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('returns GitHub-shaped 404 for unknown path', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/contents/.github/workflows/nonexistent.yml?ref=${SHA}`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/contents/${WF_PATH}?ref=${SHA}`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    it('falls back to any ref when no ref is provided', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/contents/${WF_PATH}`)
        .expect(200);

      expect(res.body.encoding).toBe('base64');
    });
  });

  // ── GET /repos/:owner/:repo/actions/workflows ───────────────────────────────

  describe('GET /repos/:owner/:repo/actions/workflows', () => {
    it('returns total_count and workflows array with correct fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/workflows`)
        .expect(200);

      expect(typeof res.body.total_count).toBe('number');
      expect(Array.isArray(res.body.workflows)).toBe(true);
      const wf = res.body.workflows[0];
      expect(typeof wf.id).toBe('number');
      expect(typeof wf.name).toBe('string');
      expect(typeof wf.path).toBe('string');
      expect(typeof wf.state).toBe('string');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/workflows`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('total_count matches workflows array length', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/workflows`)
        .expect(200);

      expect(res.body.total_count).toBe(res.body.workflows.length);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get('/repos/x/y/actions/workflows')
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── GET /repos/:owner/:repo/environments ────────────────────────────────────

  describe('GET /repos/:owner/:repo/environments', () => {
    it('returns total_count and environments array with name field', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/environments`)
        .expect(200);

      expect(typeof res.body.total_count).toBe('number');
      expect(Array.isArray(res.body.environments)).toBe(true);
      for (const env of res.body.environments) {
        expect(typeof env.name).toBe('string');
      }
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/environments`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('total_count matches environments array length', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/environments`)
        .expect(200);

      expect(res.body.total_count).toBe(res.body.environments.length);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get('/repos/x/y/environments')
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── GET /repos/:owner/:repo/actions/runs/:run_id/artifacts ─────────────────

  describe('GET /repos/:owner/:repo/actions/runs/:run_id/artifacts', () => {
    it('returns total_count and artifacts array with correct fields', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/artifacts`)
        .expect(200);

      expect(typeof res.body.total_count).toBe('number');
      expect(Array.isArray(res.body.artifacts)).toBe(true);
      const art = res.body.artifacts[0];
      expect(typeof art.id).toBe('number');
      expect(typeof art.name).toBe('string');
      expect(typeof art.expired).toBe('boolean');
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/artifacts`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('does NOT expose _content in list response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/artifacts`)
        .expect(200);

      for (const art of res.body.artifacts) {
        expect('_content' in art).toBe(false);
      }
    });

    it('returns empty list for run with no artifacts', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/88888/artifacts`)
        .expect(200);

      // Unknown run_id → empty artifact list (not 404)
      expect(res.body.total_count).toBe(0);
      expect(res.body.artifacts).toHaveLength(0);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/actions/runs/${RUN_ID}/artifacts`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── GET /repos/:owner/:repo/actions/artifacts/:artifact_id/zip ─────────────

  describe('GET /repos/:owner/:repo/actions/artifacts/:artifact_id/zip', () => {
    it('returns application/zip', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/artifacts/${ART_ID}/zip`)
        .buffer(true)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/zip/);
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/artifacts/${ART_ID}/zip`)
        .buffer(true)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('zip contains a single file whose content is the version string', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/artifacts/${ART_ID}/zip`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const zip   = await new JSZip().loadAsync(res.body as Buffer);
      const files = Object.keys(zip.files);
      expect(files).toHaveLength(1);

      const content = await zip.files[files[0]].async('string');
      expect(content).toBe(VERSION_STRING);
    });

    it('returns GitHub-shaped 404 for unknown artifact id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/artifacts/99999/zip`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/actions/artifacts/${ART_ID}/zip`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });

  // ── Rate-limit decrement across requests ────────────────────────────────────

  describe('rate-limit decrement', () => {
    it('X-RateLimit-Used increases across consecutive requests', async () => {
      const res1 = await request(app.getHttpServer())
        .get('/rate_limit')
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .get('/rate_limit')
        .expect(200);

      const used1 = parseInt(res1.headers['x-ratelimit-used'] as string, 10);
      const used2 = parseInt(res2.headers['x-ratelimit-used'] as string, 10);
      expect(used2).toBeGreaterThan(used1);
    });
  });

  // ── Run conclusion (cancelled path) ─────────────────────────────────────────

  describe('GET /repos/:owner/:repo/actions/runs/:run_id — conclusion field', () => {
    const CANCELLED_RUN_ID = 9002;
    const CANCEL_DEP_ID    = 7002;

    beforeEach(() => {
      const store = storeService.getStore();
      const repo  = store.getRepo(OWNER, REPO)!;

      // A run that concluded as cancelled
      repo.runs.set(CANCELLED_RUN_ID, {
        id:         CANCELLED_RUN_ID,
        name:       'test-svc',
        path:       WF_PATH,
        head_sha:   SHA,
        conclusion: 'cancelled',
      });

      // Its deployment has a failure status (as GitHub writes it)
      const TARGET_URL = `http://github.com/repos/${OWNER}/${REPO}/actions/runs/${CANCELLED_RUN_ID}`;
      repo.deployments.push({
        id:          CANCEL_DEP_ID,
        sha:         SHA,
        ref:         'refs/heads/main',
        environment: 'staging',
        payload:     null,
        creator:     { login: 'alice' },
        created_at:  '2026-06-06T08:00:00Z',
      });
      repo.statuses.set(CANCEL_DEP_ID, [
        { id: 90001, state: 'in_progress', target_url: TARGET_URL, creator: { login: 'alice' }, created_at: '2026-06-06T08:00:30Z' },
        { id: 90002, state: 'failure',     target_url: TARGET_URL, creator: { login: 'alice' }, created_at: '2026-06-06T08:02:00Z' },
      ]);
    });

    it('returns conclusion=cancelled for a cancelled run', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${CANCELLED_RUN_ID}`)
        .expect(200);

      expect(res.body.conclusion).toBe('cancelled');
    });

    it('returns conclusion=null for an in-progress run (no conclusion set)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`)
        .expect(200);

      // The test-setup run does not set conclusion → emitted as null
      expect(res.body.conclusion).toBeNull();
    });

    it('carries X-RateLimit-* headers on conclusion response', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/actions/runs/${CANCELLED_RUN_ID}`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });
  });

  // ── GET /repos/:owner/:repo/deployments/:id/reviews (rejected path) ──────────

  describe('GET /repos/:owner/:repo/deployments/:id/reviews', () => {
    const REJECTED_DEP_ID = 7003;

    beforeEach(() => {
      const store = storeService.getStore();
      const repo  = store.getRepo(OWNER, REPO)!;

      // A deployment whose reviewer rejected the environment gate
      repo.deployments.push({
        id:          REJECTED_DEP_ID,
        sha:         SHA,
        ref:         'refs/heads/main',
        environment: 'prod',
        payload:     null,
        creator:     { login: 'alice' },
        created_at:  '2026-06-06T08:05:00Z',
      });
      repo.statuses.set(REJECTED_DEP_ID, [
        { id: 70031, state: 'in_progress', target_url: `http://github.com/repos/${OWNER}/${REPO}/actions/runs/9003`, creator: { login: 'alice' }, created_at: '2026-06-06T08:05:30Z' },
        { id: 70032, state: 'failure',     target_url: `http://github.com/repos/${OWNER}/${REPO}/actions/runs/9003`, creator: { login: 'alice' }, created_at: '2026-06-06T08:07:00Z' },
      ]);
      repo.reviews.set(REJECTED_DEP_ID, [
        { state: 'rejected', user: { login: 'sec-approver' }, submitted_at: '2026-06-06T08:06:45Z' },
      ]);
    });

    it('returns an array of review objects with state, user, submitted_at', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${REJECTED_DEP_ID}/reviews`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const review = res.body[0];
      expect(review.state).toBe('rejected');
      expect(review.user.login).toBe('sec-approver');
      expect(typeof review.submitted_at).toBe('string');
    });

    it('returns an empty array for a deployment with no reviews', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${DEP_ID}/reviews`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('carries X-RateLimit-* headers', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/${OWNER}/${REPO}/deployments/${REJECTED_DEP_ID}/reviews`)
        .expect(200);
      expectRateLimitHeaders(res.headers as Record<string, string>);
    });

    it('returns GitHub-shaped 404 for unknown repo', async () => {
      const res = await request(app.getHttpServer())
        .get(`/repos/x/y/deployments/${REJECTED_DEP_ID}/reviews`)
        .expect(404);

      expect(res.body).toMatchObject(GITHUB_404_SHAPE);
    });
  });
});
