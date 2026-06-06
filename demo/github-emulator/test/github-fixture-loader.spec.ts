import * as path from 'path';
import { GithubFixtureLoader } from '../src/github-fixture-loader';
import { GithubStore } from '../src/github-store';

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

    it('loads the payments-api repo', () => {
      expect(store.getRepo('demo-org', 'payments-api')).toBeDefined();
    });

    it('loads the search-indexer repo', () => {
      expect(store.getRepo('demo-org', 'search-indexer')).toBeDefined();
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
    let paymentsRepo: ReturnType<GithubStore['getRepo']>;

    beforeEach(() => {
      paymentsRepo = store.getRepo('demo-org', 'payments-api');
    });

    it('has 5 environments: dev, staging, qa, preprod, prod', () => {
      const envNames = paymentsRepo!.environments.map(e => e.name);
      expect(envNames).toContain('dev');
      expect(envNames).toContain('staging');
      expect(envNames).toContain('qa');
      expect(envNames).toContain('preprod');
      expect(envNames).toContain('prod');
    });

    it('has 5 deployments sharing run_id 4830 (the F10 key)', () => {
      const r = paymentsRepo!;
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
      const r = paymentsRepo!;
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
      const r = paymentsRepo!;
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
      const run = paymentsRepo!.runs.get(4830);
      expect(run).toBeDefined();
      expect(typeof run!.id).toBe('number');
      expect(typeof run!.name).toBe('string');
      expect(typeof run!.path).toBe('string');
      expect(typeof run!.head_sha).toBe('string');
    });

    it('statuses target_url embeds /actions/runs/4830', () => {
      const r = paymentsRepo!;
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
      const r = paymentsRepo!;
      const allStates = [...r.statuses.values()].flat().map(s => s.state);
      expect(allStates).toContain('in_progress');
      expect(allStates).toContain('success');
    });
  });

  describe('search-indexer (F15 — artifact-sourced version.txt)', () => {
    let idxRepo: ReturnType<GithubStore['getRepo']>;

    beforeEach(() => {
      idxRepo = store.getRepo('demo-org', 'search-indexer');
    });

    it('has deployments', () => {
      expect(idxRepo!.deployments.length).toBeGreaterThan(0);
    });

    it('has version.txt artifacts', () => {
      let found = false;
      for (const arts of idxRepo!.artifacts.values()) {
        if (arts.some(a => a.name === 'version.txt')) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it('artifact _content is a non-empty version string', () => {
      for (const arts of idxRepo!.artifacts.values()) {
        for (const a of arts) {
          if (a.name === 'version.txt') {
            expect(a._content.trim().length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('artifact expired is false', () => {
      for (const arts of idxRepo!.artifacts.values()) {
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
    describe('pending — payments-api prod run 4840', () => {
      let paymentsRepo: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        paymentsRepo = store.getRepo('demo-org', 'payments-api');
      });

      it('has a deployment with a pending status (deployment id 4840005)', () => {
        const dep = paymentsRepo!.deployments.find(d => d.id === 4840005);
        expect(dep).toBeDefined();
        const sts = paymentsRepo!.statuses.get(4840005) ?? [];
        expect(sts.some(s => s.state === 'pending')).toBe(true);
      });

      it('effective run 4830 success co-exists so the pending is the "next" deployment', () => {
        const dep = paymentsRepo!.deployments.find(d => d.id === 4830005);
        expect(dep).toBeDefined();
        const sts = paymentsRepo!.statuses.get(4830005) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('run 4840 target_url embeds /actions/runs/4840', () => {
        const sts = paymentsRepo!.statuses.get(4840005) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/4840'))).toBe(true);
      });
    });

    describe('queued — search-indexer prod run 1420', () => {
      let idxRepo: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        idxRepo = store.getRepo('demo-org', 'search-indexer');
      });

      it('has a deployment with a queued status (deployment id 1420005)', () => {
        const sts = idxRepo!.statuses.get(1420005) ?? [];
        expect(sts.some(s => s.state === 'queued')).toBe(true);
      });

      it('run 1420 target_url embeds /actions/runs/1420', () => {
        const sts = idxRepo!.statuses.get(1420005) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/1420'))).toBe(true);
      });
    });

    describe('waiting — billing-webhook prod run 826', () => {
      let hookRepo: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        hookRepo = store.getRepo('demo-org', 'billing-webhook');
      });

      it('has a deployment with a waiting status (deployment id 826001)', () => {
        const sts = hookRepo!.statuses.get(826001) ?? [];
        expect(sts.some(s => s.state === 'waiting')).toBe(true);
      });

      it('run 826 target_url embeds /actions/runs/826', () => {
        const sts = hookRepo!.statuses.get(826001) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/826'))).toBe(true);
      });
    });

    describe('cancelled — ledger-projector prod run 1831 (failure + run.conclusion=cancelled)', () => {
      let ledgerRepo: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        ledgerRepo = store.getRepo('demo-org', 'ledger-projector');
      });

      it('has a deployment with a failure status (deployment id 1831001)', () => {
        const sts = ledgerRepo!.statuses.get(1831001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('run 1831 has conclusion=cancelled', () => {
        const run = ledgerRepo!.runs.get(1831);
        expect(run).toBeDefined();
        expect(run!.conclusion).toBe('cancelled');
      });

      it('run 1831 target_url embeds /actions/runs/1831', () => {
        const sts = ledgerRepo!.statuses.get(1831001) ?? [];
        expect(sts.every(s => s.target_url.includes('/actions/runs/1831'))).toBe(true);
      });
    });

    describe('rejected — catalog-edge prod run 5161 (failure + reviews[rejected])', () => {
      let catalogRepo: ReturnType<GithubStore['getRepo']>;

      beforeEach(() => {
        catalogRepo = store.getRepo('demo-org', 'catalog-edge');
      });

      it('has a deployment with a failure status (deployment id 5161001)', () => {
        const sts = catalogRepo!.statuses.get(5161001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('deployment 5161001 has a rejected review', () => {
        const reviews = catalogRepo!.reviews.get(5161001) ?? [];
        expect(reviews.length).toBeGreaterThan(0);
        expect(reviews.some(r => r.state === 'rejected')).toBe(true);
      });

      it('rejected review has user and submitted_at fields', () => {
        const reviews = catalogRepo!.reviews.get(5161001) ?? [];
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

  describe('graceful degradation', () => {
    it('does not throw when scenariosDir does not exist', () => {
      const fresh = new GithubStore();
      expect(() => loader.load(fresh, '/nonexistent/path')).not.toThrow();
    });
  });

  // ── Box-state demo coverage (ingest-window 2026-05-30 → 2026-06-06) ────────
  // Each sub-suite verifies that the fixture data necessary to render a specific
  // 6-box-state tile is present and correctly structured. Dates are validated
  // to confirm they fall within the 7-day INITIAL_LOOKBACK window.
  // NOTE: prev_failed is not yet computed by the read-model; S3 vs S2 and S6 vs
  // S5 will look identical in the live app until that read-model change lands.

  describe('box-state demo coverage', () => {
    const WINDOW_START = new Date('2026-05-30T00:00:00Z');

    function withinWindow(dateStr: string): boolean {
      return new Date(dateStr) >= WINDOW_START;
    }

    describe('S1 — success only: payments-api/dev (run 4830)', () => {
      it('has a success deployment for dev within the ingest window', () => {
        const r = store.getRepo('demo-org', 'payments-api')!;
        // deployment id 4830001 is the dev deployment for run 4830
        const dep = r.deployments.find(d => d.id === 4830001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('dev');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(4830001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });
    });

    describe('S2 — running + last successful: auth-bff/qa', () => {
      it('has a prior success (run 3200001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'auth-bff')!;
        const dep = r.deployments.find(d => d.id === 3200001);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3200001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer in_progress (run 3300003) within ingest window', () => {
        const r = store.getRepo('demo-org', 'auth-bff')!;
        const dep = r.deployments.find(d => d.id === 3300003);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3300003) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('run 3300003 (in_progress) is newer than run 3200001 (success)', () => {
        const r = store.getRepo('demo-org', 'auth-bff')!;
        const success = r.deployments.find(d => d.id === 3200001)!;
        const running = r.deployments.find(d => d.id === 3300003)!;
        expect(new Date(running.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('S3 — running + prev-failed + last-successful: ledger-projector/qa', () => {
      it('has a prior success (run 1815001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
        const dep = r.deployments.find(d => d.id === 1815001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('qa');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(1815001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a failure (run 1823001) within ingest window, after the success', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
        const success = r.deployments.find(d => d.id === 1815001)!;
        const failure = r.deployments.find(d => d.id === 1823001)!;
        expect(failure.environment).toBe('qa');
        expect(withinWindow(failure.created_at)).toBe(true);
        const sts = r.statuses.get(1823001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
        expect(new Date(failure.created_at) > new Date(success.created_at)).toBe(true);
      });

      it('has a running in_progress (run 1828001) within ingest window, newest of the three', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
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

      it('three qa deployments exist for the S3 slot', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
        const qaDeps = r.deployments.filter(d => d.environment === 'qa');
        expect(qaDeps.length).toBeGreaterThanOrEqual(3);
      });
    });

    describe('S4 — failure + last successful: notification-worker/staging', () => {
      it('has a prior success (run 3081001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'notification-worker')!;
        const dep = r.deployments.find(d => d.id === 3081001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3081001) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer failure (run 3110002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'notification-worker')!;
        const dep = r.deployments.find(d => d.id === 3110002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(3110002) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('run 3110002 failure is newer than run 3081001 success', () => {
        const r = store.getRepo('demo-org', 'notification-worker')!;
        const success = r.deployments.find(d => d.id === 3081001)!;
        const failure = r.deployments.find(d => d.id === 3110002)!;
        expect(new Date(failure.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('S5 — running only (no prior): platform-proxy/staging', () => {
      it('has exactly one staging deployment and it is in_progress', () => {
        const r = store.getRepo('demo-org', 'platform-proxy')!;
        const stagingDeps = r.deployments.filter(d => d.environment === 'staging');
        expect(stagingDeps).toHaveLength(1);
        const sts = r.statuses.get(stagingDeps[0].id) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('staging in_progress is within ingest window', () => {
        const r = store.getRepo('demo-org', 'platform-proxy')!;
        const dep = r.deployments.find(d => d.environment === 'staging')!;
        expect(withinWindow(dep.created_at)).toBe(true);
      });
    });

    describe('S6 — running + prev-failed (no success): billing-webhook/staging', () => {
      it('has a failure deployment (run 820001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const dep = r.deployments.find(d => d.id === 820001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(820001) ?? [];
        expect(sts.some(s => s.state === 'failure')).toBe(true);
      });

      it('has a newer in_progress deployment (run 825001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const dep = r.deployments.find(d => d.id === 825001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('staging');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(825001) ?? [];
        expect(sts.some(s => s.state === 'in_progress')).toBe(true);
        expect(sts.every(s => s.state !== 'success' && s.state !== 'failure')).toBe(true);
      });

      it('run 825001 in_progress is newer than run 820001 failure', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const failure = r.deployments.find(d => d.id === 820001)!;
        const running = r.deployments.find(d => d.id === 825001)!;
        expect(new Date(running.created_at) > new Date(failure.created_at)).toBe(true);
      });

      it('no success deployment exists for the staging slot (verifies no-prior-success)', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const stagingDeps = r.deployments.filter(d => d.environment === 'staging');
        const hasSuccess = stagingDeps.some(d => {
          const sts = r.statuses.get(d.id) ?? [];
          return sts.some(s => s.state === 'success');
        });
        expect(hasSuccess).toBe(false);
      });
    });

    describe('never-deployed — billing-webhook/prod', () => {
      it('has a waiting deployment (run 826001) within ingest window', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const dep = r.deployments.find(d => d.id === 826001);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(826001) ?? [];
        expect(sts.some(s => s.state === 'waiting')).toBe(true);
      });

      it('the prior success (run 792001) is OUTSIDE the ingest window (by design)', () => {
        const r = store.getRepo('demo-org', 'billing-webhook')!;
        const dep = r.deployments.find(d => d.id === 792001);
        expect(dep).toBeDefined();
        expect(withinWindow(dep!.created_at)).toBe(false);
      });
    });

    describe('effective + next badge — payments-api/prod (success + pending)', () => {
      it('has effective success (run 4830005) within ingest window', () => {
        const r = store.getRepo('demo-org', 'payments-api')!;
        const dep = r.deployments.find(d => d.id === 4830005);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(4830005) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has context pending (run 4840005) newer than the success', () => {
        const r = store.getRepo('demo-org', 'payments-api')!;
        const success = r.deployments.find(d => d.id === 4830005)!;
        const pending = r.deployments.find(d => d.id === 4840005)!;
        expect(pending.environment).toBe('prod');
        expect(withinWindow(pending.created_at)).toBe(true);
        const sts = r.statuses.get(4840005) ?? [];
        expect(sts.some(s => s.state === 'pending')).toBe(true);
        expect(new Date(pending.created_at) > new Date(success.created_at)).toBe(true);
      });
    });

    describe('effective + next badge — catalog-edge/prod (success + rejected)', () => {
      it('has effective success (run 5145002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'catalog-edge')!;
        const dep = r.deployments.find(d => d.id === 5145002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(5145002) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer rejected deployment (run 5161001) with reviews', () => {
        const r = store.getRepo('demo-org', 'catalog-edge')!;
        const success = r.deployments.find(d => d.id === 5145002)!;
        const rejected = r.deployments.find(d => d.id === 5161001)!;
        expect(rejected.environment).toBe('prod');
        expect(withinWindow(rejected.created_at)).toBe(true);
        expect(new Date(rejected.created_at) > new Date(success.created_at)).toBe(true);
        const reviews = r.reviews.get(5161001) ?? [];
        expect(reviews.some(rv => rv.state === 'rejected')).toBe(true);
      });
    });

    describe('effective + next badge — ledger-projector/prod (success + cancelled)', () => {
      it('has effective success (run 1802002) within ingest window', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
        const dep = r.deployments.find(d => d.id === 1802002);
        expect(dep).toBeDefined();
        expect(dep!.environment).toBe('prod');
        expect(withinWindow(dep!.created_at)).toBe(true);
        const sts = r.statuses.get(1802002) ?? [];
        expect(sts.some(s => s.state === 'success')).toBe(true);
      });

      it('has a newer cancelled deployment (run 1831001, failure + run_conclusion=cancelled)', () => {
        const r = store.getRepo('demo-org', 'ledger-projector')!;
        const success = r.deployments.find(d => d.id === 1802002)!;
        const cancelled = r.deployments.find(d => d.id === 1831001)!;
        expect(cancelled.environment).toBe('prod');
        expect(withinWindow(cancelled.created_at)).toBe(true);
        expect(new Date(cancelled.created_at) > new Date(success.created_at)).toBe(true);
        const run = r.runs.get(1831);
        expect(run!.conclusion).toBe('cancelled');
      });
    });

    describe('empty slot — platform-proxy (qa/preprod/prod not declared)', () => {
      it('platform-proxy only declares dev and staging environments', () => {
        const r = store.getRepo('demo-org', 'platform-proxy')!;
        const envNames = r.environments.map(e => e.name);
        expect(envNames).toContain('dev');
        expect(envNames).toContain('staging');
        expect(envNames).not.toContain('qa');
        expect(envNames).not.toContain('preprod');
        expect(envNames).not.toContain('prod');
      });

      it('has no deployments for qa, preprod, or prod (empty slots)', () => {
        const r = store.getRepo('demo-org', 'platform-proxy')!;
        const absent = r.deployments.filter(d =>
          d.environment === 'qa' || d.environment === 'preprod' || d.environment === 'prod'
        );
        expect(absent).toHaveLength(0);
      });
    });
  });
});
