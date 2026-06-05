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
});
