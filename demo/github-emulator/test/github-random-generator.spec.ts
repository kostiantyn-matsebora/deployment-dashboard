import { GithubRandomGenerator } from '../src/github-random-generator';
import { GithubStore } from '../src/github-store';

// WINDOW_DAYS matches the constant in the generator (14).
const WINDOW_DAYS = 14;

describe('GithubRandomGenerator', () => {
  let generator: GithubRandomGenerator;
  let store: GithubStore;

  beforeEach(() => {
    generator = new GithubRandomGenerator();
    store     = new GithubStore();
  });

  describe('generate()', () => {
    it('creates one repo per SERVICES entry (up to 10)', () => {
      generator.generate(store, 3);
      // Always creates all 10 services; count drives chains, not repos.
      expect(store.summary().repos).toBeGreaterThanOrEqual(1);
      expect(store.summary().repos).toBeLessThanOrEqual(10);
    });

    it('always creates the full 10-service roster', () => {
      generator.generate(store, 5);
      expect(store.summary().repos).toBe(10);
    });

    it('each repo has all five environments (dev, staging, qa, preprod, prod)', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        const names = r.environments.map(e => e.name);
        expect(names).toContain('dev');
        expect(names).toContain('staging');
        expect(names).toContain('qa');
        expect(names).toContain('preprod');
        expect(names).toContain('prod');
      }
    });

    it('each repo has at least one workflow', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        expect(r.workflows.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('workflow YAML includes a full dev→staging→qa→preprod→prod needs chain', () => {
      generator.generate(store, 1);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;

        let foundFullChain = false;
        for (const yaml of r.workflowYaml.values()) {
          if (
            yaml.includes('environment: dev') &&
            yaml.includes('environment: staging') &&
            yaml.includes('environment: qa') &&
            yaml.includes('environment: preprod') &&
            yaml.includes('environment: prod') &&
            yaml.includes('needs:')
          ) {
            foundFullChain = true;
            break;
          }
        }
        expect(foundFullChain).toBe(true);
      }
    });

    it('each repo has at least one deployment', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        expect(r.deployments.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('deployments have all required fields', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          expect(typeof dep.id).toBe('number');
          expect(typeof dep.sha).toBe('string');
          expect(dep.sha.length).toBeGreaterThan(0);
          expect(typeof dep.ref).toBe('string');
          expect(typeof dep.environment).toBe('string');
          expect(dep.creator).toBeDefined();
          expect(typeof dep.creator.login).toBe('string');
          expect(typeof dep.created_at).toBe('string');
        }
      }
    });

    it('each status has a target_url embedding /actions/runs/{run_id}', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const statusList of r.statuses.values()) {
          for (const s of statusList) {
            expect(s.target_url).toMatch(/\/actions\/runs\/\d+/);
          }
        }
      }
    });

    it('each repo has a version.txt artifact (F15)', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        let hasVersionArtifact = false;
        for (const artifacts of r.artifacts.values()) {
          if (artifacts.some(a => a.name === 'version.txt' && a._content.length > 0)) {
            hasVersionArtifact = true;
            break;
          }
        }
        expect(hasVersionArtifact).toBe(true);
      }
    });

    it('workflow run metadata has all required fields', () => {
      generator.generate(store, 5);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const run of r.runs.values()) {
          expect(typeof run.id).toBe('number');
          expect(typeof run.name).toBe('string');
          expect(typeof run.path).toBe('string');
          expect(typeof run.head_sha).toBe('string');
        }
      }
    });

    // ── DORA / Analytics requirements ─────────────────────────────────────────

    it('deployment timestamps span more than one calendar day', () => {
      // Use a large count to ensure spread. The generator distributes over 14 days.
      generator.generate(store, 100);

      const daySet = new Set<string>();
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          // Day in UTC (YYYY-MM-DD)
          daySet.add(dep.created_at.slice(0, 10));
        }
      }
      expect(daySet.size).toBeGreaterThan(1);
    });

    it('all deployment timestamps fall within the past WINDOW_DAYS days', () => {
      generator.generate(store, 100);
      const windowStart = Date.now() - WINDOW_DAYS * 24 * 60 * 60_000;

      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          const ts = new Date(dep.created_at).getTime();
          expect(ts).toBeGreaterThanOrEqual(windowStart);
          expect(ts).toBeLessThanOrEqual(Date.now() + 1000); // +1s clock tolerance
        }
      }
    });

    it('qa and preprod environments appear across a 100-chain dataset', () => {
      // With 100 chains and realistic attrition (~70-75% advance), both stages
      // appear many times in a 10-repo dataset (~100 chains * 0.85 * 0.75 ≈ 64 qa).
      generator.generate(store, 100);

      const envsSeen = new Set<string>();
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          envsSeen.add(dep.environment);
        }
      }

      expect(envsSeen).toContain('qa');
      expect(envsSeen).toContain('preprod');
    });

    it('per-stage counts follow funnel attrition: dev ≥ staging ≥ qa ≥ preprod ≥ prod', () => {
      generator.generate(store, 200);

      const counts: Record<string, number> = { dev: 0, staging: 0, qa: 0, preprod: 0, prod: 0 };
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          if (dep.environment in counts) counts[dep.environment]++;
        }
      }

      expect(counts.dev).toBeGreaterThanOrEqual(counts.staging);
      expect(counts.staging).toBeGreaterThanOrEqual(counts.qa);
      expect(counts.qa).toBeGreaterThanOrEqual(counts.preprod);
      expect(counts.preprod).toBeGreaterThanOrEqual(counts.prod);

      // qa, preprod, prod counts must be strictly less than dev (real attrition)
      expect(counts.qa).toBeLessThan(counts.dev);
      expect(counts.prod).toBeLessThan(counts.dev);
    });

    it('at least one failure status exists across a 100-chain dataset', () => {
      // FAILURE_PROB = 15%; with 100+ chains it is near-certain to appear.
      generator.generate(store, 100);

      let hasFailure = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const statusList of r.statuses.values()) {
          if (statusList.some(s => s.state === 'failure')) {
            hasFailure = true;
            break;
          }
        }
        if (hasFailure) break;
      }
      expect(hasFailure).toBe(true);
    });

    it('parent_deployments chain: each repo has multiple deployments sharing a sha (promotions)', () => {
      // Each chain promotes the same sha through stages, so multiple deployments
      // will share the same sha — enabling fetcher parent_deployments resolution.
      generator.generate(store, 50);

      let foundMultiStageChain = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;

        const shaCount = new Map<string, number>();
        for (const dep of r.deployments) {
          shaCount.set(dep.sha, (shaCount.get(dep.sha) ?? 0) + 1);
        }
        // At least one sha promoted to 2+ stages
        if ([...shaCount.values()].some(n => n >= 2)) {
          foundMultiStageChain = true;
          break;
        }
      }
      expect(foundMultiStageChain).toBe(true);
    });

    it('count scales total deployment volume', () => {
      const smallStore = new GithubStore();
      const largeStore = new GithubStore();

      generator.generate(smallStore, 20);
      const gen2 = new GithubRandomGenerator();
      gen2.generate(largeStore, 100);

      expect(largeStore.summary().deployments).toBeGreaterThan(smallStore.summary().deployments);
    });

    it('multiple distinct actors appear across a 100-chain dataset', () => {
      generator.generate(store, 100);

      const actors = new Set<string>();
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const dep of r.deployments) {
          actors.add(dep.creator.login);
        }
      }
      // 7 possible actors; expect at least 3 to appear across 100+ deployments
      expect(actors.size).toBeGreaterThanOrEqual(3);
    });

    it('each deployment carries an in_progress status before the terminal one', () => {
      generator.generate(store, 10);
      let checkedAtLeastOne = false;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const [, statusList] of r.statuses) {
          expect(statusList.some(s => s.state === 'in_progress')).toBe(true);
          expect(statusList.some(s => s.state === 'success' || s.state === 'failure')).toBe(true);
          checkedAtLeastOne = true;
        }
      }
      expect(checkedAtLeastOne).toBe(true);
    });
  });

  describe('appendRandomEmit()', () => {
    it('appends a new deployment to an existing repo', () => {
      generator.generate(store, 5);
      const before = store.summary().deployments;
      generator.appendRandomEmit(store);
      expect(store.summary().deployments).toBeGreaterThan(before);
    });

    it('does nothing when the store is empty', () => {
      expect(() => generator.appendRandomEmit(store)).not.toThrow();
    });

    it('appended deployment has an in_progress status', () => {
      generator.generate(store, 5);

      // Snapshot all deployment counts before emit — appendRandomEmit picks a random repo
      const beforeCounts = new Map<string, number>();
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        beforeCounts.set(key, store.getRepo(owner, repo)!.deployments.length);
      }

      generator.appendRandomEmit(store);

      // Find the repo that received the new deployment
      let newDep: import('../src/github-store').GhDeployment | undefined;
      let newRepoStore: import('../src/github-store').RepoStore | undefined;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        const before = beforeCounts.get(key) ?? 0;
        if (r.deployments.length > before) {
          newDep = r.deployments.slice(before).pop();
          newRepoStore = r;
          break;
        }
      }

      expect(newDep).toBeDefined();
      const statuses = newRepoStore!.statuses.get(newDep!.id)!;
      expect(statuses.some(s => s.state === 'in_progress')).toBe(true);
    });

    it('appended statuses include a terminal state', () => {
      generator.generate(store, 5);

      const beforeCounts = new Map<string, number>();
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        beforeCounts.set(key, store.getRepo(owner, repo)!.deployments.length);
      }

      generator.appendRandomEmit(store);

      let newDep: import('../src/github-store').GhDeployment | undefined;
      let newRepoStore: import('../src/github-store').RepoStore | undefined;
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        const before = beforeCounts.get(key) ?? 0;
        if (r.deployments.length > before) {
          newDep = r.deployments.slice(before).pop();
          newRepoStore = r;
          break;
        }
      }

      expect(newDep).toBeDefined();
      const statuses = newRepoStore!.statuses.get(newDep!.id)!;
      expect(statuses.some(s => s.state === 'success' || s.state === 'failure')).toBe(true);
    });
  });
});
