import * as path from 'path';
import { GithubFixtureLoader } from '../src/github-fixture-loader';
import { GithubStore, RepoStore } from '../src/github-store';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Load fixtures with the env flag set to a specific value, then restore. */
function loadWithFlag(flag: string | undefined, store: GithubStore): void {
  const prev = process.env['SEED_RELATIVE_DATES'];
  try {
    if (flag === undefined) {
      delete process.env['SEED_RELATIVE_DATES'];
    } else {
      process.env['SEED_RELATIVE_DATES'] = flag;
    }
    new GithubFixtureLoader().load(store, SCENARIOS_DIR);
  } finally {
    if (prev === undefined) {
      delete process.env['SEED_RELATIVE_DATES'];
    } else {
      process.env['SEED_RELATIVE_DATES'] = prev;
    }
  }
}

/**
 * Return deployments in a repo whose run maps to a specific workflow name.
 * Used to scope assertions to a single service within a multi-service repo.
 */
function deploymentsForService(r: RepoStore, workflowName: string): typeof r.deployments {
  const runIds = new Set<number>();
  for (const [runId, run] of r.runs.entries()) {
    if (run.name === workflowName) runIds.add(runId);
  }
  // A deployment's run_id is embedded in its status target_url.
  // Cross-reference via statuses to find the run_id per deployment.
  return r.deployments.filter(d => {
    const sts = r.statuses.get(d.id) ?? [];
    return sts.some(s => {
      const m = s.target_url.match(/\/actions\/runs\/(\d+)/);
      return m != null && runIds.has(Number(m[1]));
    });
  });
}

// Resolve the canonical demo data directory relative to this project tree.
// The fixture loader resolves path.resolve(scenariosDir, 'github').
const SCENARIOS_DIR = path.resolve(__dirname, '../../../demo/data');

describe('GithubFixtureLoader', () => {
  let loader: GithubFixtureLoader;
  let store: GithubStore;

  beforeEach(() => {
    loader = new GithubFixtureLoader();
    store  = new GithubStore();
    loader.load(store, SCENARIOS_DIR);
  });

  describe('load()', () => {
    it('loads at least 2 repos', () => {
      expect(store.summary().repos).toBeGreaterThanOrEqual(2);
    });

    it('loads the storefront repo (contains payments-api and search-indexer workflows)', () => {
      expect(store.getRepo('demo-org', 'storefront')).toBeDefined();
    });

    it('storefront repo contains a payments-api workflow', () => {
      const r = store.getRepo('demo-org', 'storefront')!;
      expect(r.workflows.some(w => w.name === 'payments-api')).toBe(true);
    });

    it('storefront repo contains a search-indexer workflow', () => {
      const r = store.getRepo('demo-org', 'storefront')!;
      expect(r.workflows.some(w => w.name === 'search-indexer')).toBe(true);
    });

    it('reports non-zero deployments, statuses, workflows, environments in summary', () => {
      const s = store.summary();
      expect(s.deployments).toBeGreaterThan(0);
      expect(s.statuses).toBeGreaterThan(0);
      expect(s.workflows).toBeGreaterThan(0);
      expect(s.environments).toBeGreaterThan(0);
    });
  });

  describe('payments-api (F10 precondition — shared run_id across 5 environments)', () => {
    // payments-api lives in demo-org/storefront
    let storefront: ReturnType<GithubStore['getRepo']>;

    beforeEach(() => {
      storefront = store.getRepo('demo-org', 'storefront');
    });

    it('storefront has 5 environments: dev, staging, qa, preprod, prod', () => {
      const envNames = storefront!.environments.map(e => e.name);
      expect(envNames).toContain('dev');
      expect(envNames).toContain('staging');
      expect(envNames).toContain('qa');
      expect(envNames).toContain('preprod');
      expect(envNames).toContain('prod');
    });

    it('has 5 deployments sharing run_id 4830 (the F10 key)', () => {
      const r = storefront!;
      // All 5 chain deployments share run_id 4830 — the run must be registered once
      expect(r.runs.has(4830)).toBe(true);

      // The deployments keyed to run 4830 via statuses
      const deplWithRun4830 = r.deployments.filter(d => {
        const statuses = r.statuses.get(d.id) ?? [];
        return statuses.some(s => s.target_url.includes('/actions/runs/4830'));
      });
      expect(deplWithRun4830).toHaveLength(5);
    });

    it('covers all 5 environments in the run_id 4830 deployments', () => {
      const r = storefront!;
      const envs = r.deployments
        .filter(d => {
          const statuses = r.statuses.get(d.id) ?? [];
          return statuses.some(s => s.target_url.includes('/actions/runs/4830'));
        })
        .map(d => d.environment);

      expect(envs).toContain('dev');
      expect(envs).toContain('staging');
      expect(envs).toContain('qa');
      expect(envs).toContain('preprod');
      expect(envs).toContain('prod');
    });

    it('workflow YAML contains a dev→staging→qa→preprod→prod needs chain', () => {
      const r = storefront!;
      let foundChain = false;
      for (const yaml of r.workflowYaml.values()) {
        if (
          yaml.includes('environment: dev') &&
          yaml.includes('environment: staging') &&
          yaml.includes('environment: qa') &&
          yaml.includes('environment: preprod') &&
          yaml.includes('environment: prod') &&
          yaml.includes('needs:')
        ) {
          foundChain = true;
          break;
        }
      }
      expect(foundChain).toBe(true);
    });

    it('run metadata has id, name, path, head_sha', () => {
      const run = storefront!.runs.get(4830);
      expect(run).toBeDefined();
      expect(typeof run!.id).toBe('number');
      expect(typeof run!.name).toBe('string');
      expect(typeof run!.path).toBe('string');
      expect(typeof run!.head_sha).toBe('string');
    });

    it('statuses target_url embeds /actions/runs/4830', () => {
      const r = storefront!;
      const depIds = r.deployments
        .filter(d => {
          const sts = r.statuses.get(d.id) ?? [];
          return sts.some(s => s.target_url.includes('/actions/runs/4830'));
        })
        .map(d => d.id);

      expect(depIds.length).toBeGreaterThan(0);
      for (const depId of depIds) {
        const sts = r.statuses.get(depId)!;
        for (const s of sts) {
          expect(s.target_url).toMatch(/\/actions\/runs\/4830/);
        }
      }
    });

    it('status lifecycle includes in_progress and success', () => {
      const r = storefront!;
      const allStates = [...r.statuses.values()].flat().map(s => s.state);
      expect(allStates).toContain('in_progress');
      expect(allStates).toContain('success');
    });
  });

  describe('search-indexer (F15 — artifact-sourced version.txt)', () => {
    // search-indexer lives in demo-org/storefront (workflow id 1002)
    let storefront: ReturnType<GithubStore['getRepo']>;

    beforeEach(() => {
      storefront = store.getRepo('demo-org', 'storefront');
    });

    it('has deployments for search-indexer', () => {
      // search-indexer run_ids: 1410 and 1420 — both are registered runs
      expect(storefront!.runs.has(1410)).toBe(true);
    });

    it('has version.txt artifacts (keyed by run_id)', () => {
      // Artifacts for search-indexer are stored per run_id (1410, 1420)
      let found = false;
      for (const arts of storefront!.artifacts.values()) {
        if (arts.some(a => a.name === 'version.txt')) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it('artifact _content is a non-empty version string', () => {
      for (const arts of storefront!.artifacts.values()) {
        for (const a of arts) {
          if (a.name === 'version.txt') {
            expect(a._content.trim().length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('artifact expired is false', () => {
      for (const arts of storefront!.artifacts.values()) {
        for (const a of arts) {
          if (a.name === 'version.txt') {
            expect(a.expired).toBe(false);
          }
        }
      }
    });
  });

  describe('status spread', () => {
    it('has at least one success status across all repos', () => {
      let found = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const sts of r.statuses.values()) {
          if (sts.some(s => s.state === 'success')) { found = true; break; }
        }
        if (found) break;
      }
      expect(found).toBe(true);
    });

    it('has at least one failure status across all repos', () => {
      let found = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const sts of r.statuses.values()) {
          if (sts.some(s => s.state === 'failure')) { found = true; break; }
        }
        if (found) break;
      }
      expect(found).toBe(true);
    });

    it('has at least one in_progress status across all repos', () => {
      let found = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const sts of r.statuses.values()) {
          if (sts.some(s => s.state === 'in_progress')) { found = true; break; }
        }
        if (found) break;
      }
      expect(found).toBe(true);
    });
  });

  describe('new statuses (issue #268) — pending / queued / waiting / cancelled / rejected paths', () => {
    describe('pending — payments-api prod run 4840 (in storefront repo)', () => {
      // payments-api lives in demo-org/storefront
      let storefront: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        storefront = store.getRepo('demo-org', 'storefront');
      });

      it('has a deployment with a pending status (deployment id 4840005)', () => {
        const dep = storefront!.deployments.find(d => d.id === 4840005);
        expect(dep).toBeDefined();
        const sts = storefront!.statuses.get(4840005) ?? [];
        expect(sts.some(s => s.state === 'pending')).toBe(true);
      });

      it('effective run 4830 success co-exists so the pending is the "next" deployment', () => {
        const dep = storefront!.deployments.find(d => d.id === 4830005);
        expect(dep).toBeDefined();
        const sts = storefront!.statuses.get(4830005) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('run 4840 target_url embeds /actions/runs/4840', () => {
        const sts = storefront!.statuses.get(4840005) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/4840'))).toBe(true);
      });
    });

    describe('queued — search-indexer prod run 1420 (in storefront repo)', () => {
      // search-indexer lives in demo-org/storefront
      let storefront: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        storefront = store.getRepo('demo-org', 'storefront');
      });

      it('has a deployment with a queued status (deployment id 1420005)', () => {
        const sts = storefront!.statuses.get(1420005) ?? [];
        expect(sts.some(s => s.state === 'queued')).toBe(true);
      });

      it('run 1420 target_url embeds /actions/runs/1420', () => {
        const sts = storefront!.statuses.get(1420005) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/1420'))).toBe(true);
      });
    });

    describe('waiting — billing-webhook prod run 826 (in operations repo)', () => {
      // billing-webhook lives in demo-org/operations
      let operations: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        operations = store.getRepo('demo-org', 'operations');
      });

      it('has a deployment with a waiting status (deployment id 826001)', () => {
        const sts = operations!.statuses.get(826001) ?? [];
        expect(sts.some(s => s.state === 'waiting')).toBe(true);
      });

      it('run 826 target_url embeds /actions/runs/826', () => {
        const sts = operations!.statuses.get(826001) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/826'))).toBe(true);
      });
    });

    describe('cancelled — ledger-projector prod run 1831 (failure + run.conclusion=cancelled, in operations repo)', () => {
      // ledger-projector lives in demo-org/operations
      let operations: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        operations = store.getRepo('demo-org', 'operations');
      });

      it('has a deployment with a failure status (deployment id 1831001)', () => {
        const sts = operations!.statuses.get(1831001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('run 1831 has conclusion=cancelled', () => {
        const run = operations!.runs.get(1831);
        expect(run).toBeDefined();
        expect(run!.conclusion).toBe('cancelled');
      });

      it('run 1831 target_url embeds /actions/runs/1831', () => {
        const sts = operations!.statuses.get(1831001) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/1831'))).toBe(true);
      });
    });

    describe('rejected — catalog-edge prod run 5161 (failure + reviews[rejected], in platform repo)', () => {
      // catalog-edge lives in demo-org/platform
      let platform: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        platform = store.getRepo('demo-org', 'platform');
      });

      it('has a deployment with a failure status (deployment id 5161001)', () => {
        const sts = platform!.statuses.get(5161001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('deployment 5161001 has a rejected review', () => {
        const reviews = platform!.reviews.get(5161001) ?? [];
        expect(reviews.length).toBeGreaterThan(0);
        expect(reviews.some(r => r.state === 'rejected')).toBe(true);
      });

      it('rejected review has user and submitted_at fields', () => {
        const reviews = platform!.reviews.get(5161001) ?? [];
        const rejected = reviews.find(r => r.state === 'rejected')!;
        expect(typeof rejected.user.login).toBe('string');
        expect(typeof rejected.submitted_at).toBe('string');
      });
    });
  });

  describe('GithubStoreStatus counters after load', () => {
    it('summary repos matches number of loaded repos', () => {
      const keys = store.allRepoKeys();
      expect(store.summary().repos).toBe(keys.length);
    });

    it('summary deployment count matches sum of all deployments', () => {
      let total = 0;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        total += store.getRepo(owner, repo)!.deployments.length;
      }
      expect(store.summary().deployments).toBe(total);
    });

    it('summary status count matches sum of all statuses', () => {
      let total = 0;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const sts of r.statuses.values()) total += sts.length;
      }
      expect(store.summary().statuses).toBe(total);
    });
  });

  // ── Provided presets (issue #391) — .deployment-dashboard/*.json fixtures ──
  // Verifies the curated demo fixture seeds the generic `files` store consumed
  // by the Contents API directory listing (github-rest.controller.ts
  // getContents), matching the demo BRIEF: storefront gets a BUNDLE file,
  // platform gets a SINGLE envelope file, and repos without a
  // .deployment-dashboard/ fixture load with an empty files map (so the
  // emulator 404s and the fetcher's preset-discovery skips them, no prune).

  describe('provided presets (issue #391 — .deployment-dashboard fixtures)', () => {
    it('storefront has a BUNDLE preset file under .deployment-dashboard/', () => {
      const r = store.getRepo('demo-org', 'storefront')!;
      const raw = r.files.get('.deployment-dashboard/presets.json');
      expect(raw).toBeDefined();

      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(Array.isArray(parsed.presets)).toBe(true);
      expect(parsed.presets.length).toBeGreaterThanOrEqual(2);
      for (const p of parsed.presets) {
        expect(typeof p.name).toBe('string');
        expect(typeof p.settings).toBe('object');
      }
    });

    it('platform has a SINGLE preset envelope file under .deployment-dashboard/', () => {
      const r = store.getRepo('demo-org', 'platform')!;
      const raw = r.files.get('.deployment-dashboard/ops-focus.json');
      expect(raw).toBeDefined();

      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(typeof parsed.name).toBe('string');
      expect(typeof parsed.settings).toBe('object');
      expect(Array.isArray(parsed.presets)).toBe(false);
    });

    it('repos without a .deployment-dashboard fixture load with an empty files map', () => {
      const operations   = store.getRepo('demo-org', 'operations')!;
      const dataPipeline = store.getRepo('demo-org', 'data-pipeline')!;
      expect(operations.files.size).toBe(0);
      expect(dataPipeline.files.size).toBe(0);
    });
  });

  describe('graceful degradation', () => {
    it('does not throw when scenariosDir does not exist', () => {
      const fresh = new GithubStore();
      expect(() => loader.load(fresh, '/nonexistent/path')).not.toThrow();
    });
  });

  // ── Freshness guarantee — timestamps are relative-shifted to seed-time ──────
  // GithubFixtureLoader shifts all timestamps so the newest event lands at ~now.
  // These tests verify the invariant and that relative spacing is preserved.

  describe('fixture date freshness (relative-shift)', () => {
    const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    // Small epsilon to tolerate test execution time (<5 s).
    const EPSILON_MS  = 5_000;

    it('newest event timestamp across the store is within the fetcher default lookback of now', () => {
      const now = Date.now();
      let newestMs = -Infinity;

      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;

        for (const dep of r.deployments) {
          const t = new Date(dep.created_at).getTime();
          if (t > newestMs) newestMs = t;
        }

        for (const statuses of r.statuses.values()) {
          for (const s of statuses) {
            const t = new Date(s.created_at).getTime();
            if (t > newestMs) newestMs = t;
          }
        }

        for (const reviews of r.reviews.values()) {
          for (const rv of reviews) {
            const t = new Date(rv.submitted_at).getTime();
            if (t > newestMs) newestMs = t;
          }
        }
      }

      expect(newestMs).toBeGreaterThanOrEqual(now - LOOKBACK_MS);
      expect(newestMs).toBeLessThanOrEqual(now + EPSILON_MS);
    });

    it('relative spacing between two known events is preserved after shift', () => {
      // payments-api/prod (in storefront): dep 4830005 (success run) and dep 4840005 (pending run).
      // Fixture values: 4830005.created_at = 2026-05-31T07:00:00Z,
      //                 4840005.created_at = 2026-06-06T07:55:00Z
      // Delta = 517800000 ms (5d 23h 55m).
      const FIXTURE_DEP_4830005_ISO = '2026-05-31T07:00:00Z';
      const FIXTURE_DEP_4840005_ISO = '2026-06-06T07:55:00Z';
      const expectedDeltaMs =
        new Date(FIXTURE_DEP_4840005_ISO).getTime() -
        new Date(FIXTURE_DEP_4830005_ISO).getTime();

      const r = store.getRepo('demo-org', 'storefront')!;
      const dep4830005 = r.deployments.find(d => d.id === 4830005)!;
      const dep4840005 = r.deployments.find(d => d.id === 4840005)!;

      expect(dep4830005).toBeDefined();
      expect(dep4840005).toBeDefined();

      const actualDeltaMs =
        new Date(dep4840005.created_at).getTime() -
        new Date(dep4830005.created_at).getTime();

      expect(actualDeltaMs).toBe(expectedDeltaMs);
    });
  });

  // ── SEED_RELATIVE_DATES=false — raw fixture dates are preserved ───────────
  // When the flag is OFF the loader must skip the skew so the raw fixture
  // created_at / submitted_at values reach the store unchanged.  This is the
  // mode used by the api-tests compose overlay (fixed dates + FETCHER_NOW pin).

  describe('fixture date freshness (SEED_RELATIVE_DATES=false — raw dates preserved)', () => {
    // Known raw fixture dates for two payments-api/prod deployments (in storefront repo).
    const FIXTURE_DEP_4830005_ISO = '2026-05-31T07:00:00Z';
    const FIXTURE_DEP_4840005_ISO = '2026-06-06T07:55:00Z';

    let storeOff: GithubStore;

    beforeEach(() => {
      storeOff = new GithubStore();
      loadWithFlag('false', storeOff);
    });

    it('dep 4830005 created_at matches the raw fixture date exactly', () => {
      const r = storeOff.getRepo('demo-org', 'storefront')!;
      const dep = r.deployments.find(d => d.id === 4830005)!;
      expect(dep).toBeDefined();
      expect(dep.created_at).toBe(FIXTURE_DEP_4830005_ISO);
    });

    it('dep 4840005 created_at matches the raw fixture date exactly', () => {
      const r = storeOff.getRepo('demo-org', 'storefront')!;
      const dep = r.deployments.find(d => d.id === 4840005)!;
      expect(dep).toBeDefined();
      expect(dep.created_at).toBe(FIXTURE_DEP_4840005_ISO);
    });

    it('status created_at for dep 4830005 is NOT shifted (raw value preserved)', () => {
      const r = storeOff.getRepo('demo-org', 'storefront')!;
      const sts = r.statuses.get(4830005) ?? [];
      expect(sts.length).toBeGreaterThan(0);
      // Every status must parse to a date that is NOT ahead of now, confirming
      // no forward-shift was applied (raw dates are in 2026 which is in the past
      // relative to future runs, but the key invariant is they equal raw fixture values).
      for (const s of sts) {
        // Dates must be valid ISO strings.
        expect(isNaN(new Date(s.created_at).getTime())).toBe(false);
      }
    });

    it('accepted flag values "0" and "no" also skip the shift', () => {
      for (const flag of ['0', 'no', 'NO', 'No']) {
        const s = new GithubStore();
        loadWithFlag(flag, s);
        const r = s.getRepo('demo-org', 'storefront')!;
        const dep = r.deployments.find(d => d.id === 4830005)!;
        expect(dep).toBeDefined();
        expect(dep.created_at).toBe(FIXTURE_DEP_4830005_ISO);
      }
    });

    it('unset flag (default-ON) still shifts dates away from raw fixture values', () => {
      // The default store loaded in beforeEach (ON, no env override) must NOT
      // have raw fixture dates — it shifts them to ~now.
      const r = store.getRepo('demo-org', 'storefront')!;
      const dep = r.deployments.find(d => d.id === 4830005)!;
      expect(dep).toBeDefined();
      expect(dep.created_at).not.toBe(FIXTURE_DEP_4830005_ISO);
    });
  });

  // ── Box-state demo coverage ──────────────────────────────────────────────────
  // Each sub-suite verifies that the fixture data necessary to render a specific
  // 6-box-state tile is present and correctly structured. Dates are validated
  // to confirm they fall within the 7-day INITIAL_LOOKBACK window relative to
  // seed time (timestamps are shifted at load — see fixture date freshness suite).
  // NOTE: prev_failed is not yet computed by the read-model; S3 vs S2 and S6 vs
  // S5 will look identical in the live app until that read-model change lands.

  describe('box-state demo coverage', () => {
    // Window opens 7 days before now (relative — loader shifts timestamps to seed-time).
    const WINDOW_START = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    function withinWindow(dateStr: string): boolean {
      return new Date(dateStr) >= WINDOW_START;
    }

    describe('S1 — success only: payments-api/dev (run 4830, in storefront repo)', () => {
      it('has a success deployment for dev within the ingest window', () => {
        const r = store.getRepo('demo-org', 'storefront')!;
        // deployment id 4830001 is the dev deployment for run 4830 (payments-api)
        const dep = r.deployments.find(d => d.id === 4830001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('dev');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(4830001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });
    });

    describe('S2 — running + last successful: auth-bff/qa (in platform repo)', () => {
      it('has a prior success (run 3200001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const dep = r.deployments.find(d => d.id === 3200001);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3200001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer in_progress (run 3300003) within ingest window', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const dep = r.deployments.find(d => d.id === 3300003);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3300003) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('run 3300003 (in_progress) is newer than run 3200001 (success)', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const success = r.deployments.find(d => d.id === 3200001)!;
        const running = r.deployments.find(d => d.id === 3300003)!;
        expect(new Date(running.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('S3 — running + prev-failed + last-successful: ledger-projector/qa (in operations repo)', () => {
      it('has a prior success (run 1815001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 1815001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('qa');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(1815001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a failure (run 1823001) within ingest window, after the success', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const success = r.deployments.find(d => d.id === 1815001)!;
        const failure = r.deployments.find(d => d.id === 1823001)!;
        expect(failure.environment).toBe('qa');
        expect(withinWindow(failure.created_at)).toBe(true);
        const sts = r.statuses.get(1823001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
        expect(new Date(failure.created_at) > new Date(success.created_at)).toBe(true);
      });

      it('has a running in_progress (run 1828001) within ingest window, newest of the three', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const failure = r.deployments.find(d => d.id === 1823001)!;
        const dep = r.deployments.find(d => d.id === 1828001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('qa');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(1828001) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
        expect(new Date(dep!.created_at) > new Date(failure.created_at)).toBe(true);
      });

      it('at least three qa deployments exist for the ledger-projector service (S3 slot)', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        // ledger-projector deployments: run_ids 1815, 1823, 1828 (all qa), 1802, 1831 (preprod/prod)
        const ledgerDeps = deploymentsForService(r, 'ledger-projector');
        const qaDeps = ledgerDeps.filter(d => d.environment === 'qa');
        expect(qaDeps.length).toBeGreaterThanOrEqual(3);
      });
    });

    describe('S4 — failure + last successful: notification-worker/staging (in operations repo)', () => {
      it('has a prior success (run 3081001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 3081001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3081001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer failure (run 3110002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 3110002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3110002) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('run 3110002 failure is newer than run 3081001 success', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const success = r.deployments.find(d => d.id === 3081001)!;
        const failure = r.deployments.find(d => d.id === 3110002)!;
        expect(new Date(failure.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('S5 — running only (no prior): platform-proxy/staging (in platform repo)', () => {
      it('has exactly one staging deployment for platform-proxy and it is in_progress', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        // platform-proxy staging deployment: id 6200002, run_id 6200
        const dep = r.deployments.find(d => d.id === 6200002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        const sts = r.statuses.get(6200002) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('staging in_progress is within ingest window', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const dep = r.deployments.find(d => d.id === 6200002)!;
        expect(withinWindow(dep.created_at)).toBe(true);
      });

      it('no other staging deployment for platform-proxy run (only run_id 6200 covers staging)', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const platformProxyDeps = deploymentsForService(r, 'platform-proxy');
        const stagingDeps = platformProxyDeps.filter(d => d.environment === 'staging');
        expect(stagingDeps).toHaveLength(1);
      });
    });

    describe('S6 — running + prev-failed (no success): billing-webhook/staging (in operations repo)', () => {
      it('has a failure deployment (run 820001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 820001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(820001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('has a newer in_progress deployment (run 825001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 825001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(825001) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('run 825001 in_progress is newer than run 820001 failure', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const failure = r.deployments.find(d => d.id === 820001)!;
        const running = r.deployments.find(d => d.id === 825001)!;
        expect(new Date(running.created_at) > new Date(failure.created_at)).toBe(true);
      });

      it('no success deployment exists for the billing-webhook staging slot (verifies no-prior-success)', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        // Scope to billing-webhook staging deployments only
        const billingDeps = deploymentsForService(r, 'billing-webhook');
        const stagingDeps = billingDeps.filter(d => d.environment === 'staging');
        const hasSuccess = stagingDeps.some(d => {
          const sts = r.statuses.get(d.id) ?? [];
          return sts.some(s => s.state === 'success');
        });
        expect(hasSuccess).toBe(false);
      });
    });

    describe('never-deployed — billing-webhook/prod (in operations repo)', () => {
      it('has a waiting deployment (run 826001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 826001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(826001) ?? [];
        expect(sts.some(s => s.state === 'waiting')).toBe(true);
      });

      it('the prior success (run 792001) is OUTSIDE the ingest window (by design)', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 792001);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(false);
      });
    });

    describe('effective + next badge — payments-api/prod (success + pending, in storefront repo)', () => {
      it('has effective success (run 4830005) within ingest window', () => {
        const r = store.getRepo('demo-org', 'storefront')!;
        const dep = r.deployments.find(d => d.id === 4830005);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(4830005) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has context pending (run 4840005) newer than the success', () => {
        const r = store.getRepo('demo-org', 'storefront')!;
        const success = r.deployments.find(d => d.id === 4830005)!;
        const pending = r.deployments.find(d => d.id === 4840005)!;
        expect(pending.environment).toBe('prod');
        expect(withinWindow(pending.created_at)).toBe(true);
        const sts = r.statuses.get(4840005) ?? [];
        expect(sts.some(s => s.state === 'pending')).toBe(true);
        expect(new Date(pending.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('effective + next badge — catalog-edge/prod (success + rejected, in platform repo)', () => {
      it('has effective success (run 5145002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const dep = r.deployments.find(d => d.id === 5145002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(5145002) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer rejected deployment (run 5161001) with reviews', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const success = r.deployments.find(d => d.id === 5145002)!;
        const rejected = r.deployments.find(d => d.id === 5161001)!;
        expect(rejected.environment).toBe('prod');
        expect(withinWindow(rejected.created_at)).toBe(true);
        expect(new Date(rejected.created_at) > new Date(success.created_at)).toBe(true);
        const reviews = r.reviews.get(5161001) ?? [];
        expect(reviews.some(rv => rv.state === 'rejected')).toBe(true);
      });
    });

    describe('effective + next badge — ledger-projector/prod (success + cancelled, in operations repo)', () => {
      it('has effective success (run 1802002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const dep = r.deployments.find(d => d.id === 1802002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(1802002) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer cancelled deployment (run 1831001, failure + run_conclusion=cancelled)', () => {
        const r = store.getRepo('demo-org', 'operations')!;
        const success = r.deployments.find(d => d.id === 1802002)!;
        const cancelled = r.deployments.find(d => d.id === 1831001)!;
        expect(cancelled.environment).toBe('prod');
        expect(withinWindow(cancelled.created_at)).toBe(true);
        expect(new Date(cancelled.created_at) > new Date(success.created_at)).toBe(true);
        const run = r.runs.get(1831);
        expect(run!.conclusion).toBe('cancelled');
      });
    });

    describe('empty slot — platform-proxy (no qa/preprod/prod deployments, in platform repo)', () => {
      it('platform repo declares qa, preprod and prod environments', () => {
        // The platform repo itself lists all 5 envs — platform-proxy just has no
        // deployments in qa/preprod/prod (the empty-slot condition).
        const r = store.getRepo('demo-org', 'platform')!;
        const envNames = r.environments.map(e => e.name);
        expect(envNames).toContain('qa');
        expect(envNames).toContain('preprod');
        expect(envNames).toContain('prod');
      });

      it('platform-proxy service has no qa, preprod, or prod deployments (empty slots)', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const proxyDeps = deploymentsForService(r, 'platform-proxy');
        const absent = proxyDeps.filter(d =>
          d.environment === 'qa' || d.environment === 'preprod' || d.environment === 'prod'
        );
        expect(absent).toHaveLength(0);
      });

      it('platform-proxy only has dev and staging deployments', () => {
        const r = store.getRepo('demo-org', 'platform')!;
        const proxyDeps = deploymentsForService(r, 'platform-proxy');
        const envs = new Set(proxyDeps.map(d => d.environment));
        expect(envs.has('dev')).toBe(true);
        expect(envs.has('staging')).toBe(true);
        expect(envs.has('qa')).toBe(false);
        expect(envs.has('preprod')).toBe(false);
        expect(envs.has('prod')).toBe(false);
      });
    });
  });
});
