import { GithubRandomGenerator } from '../src/github-random-generator';
import { GithubStore } from '../src/github-store';

describe('GithubRandomGenerator', () => {
  let generator: GithubRandomGenerator;
  let store: GithubStore;

  beforeEach(() => {
    generator = new GithubRandomGenerator();
    store     = new GithubStore();
  });

  describe('generate()', () => {
    it('creates the requested number of repos (up to SERVICES.length)', () => {
      generator.generate(store, 3);
      expect(store.summary().repos).toBe(3);
    });

    it('caps at the number of defined services (10)', () => {
      generator.generate(store, 999);
      expect(store.summary().repos).toBeLessThanOrEqual(10);
    });

    it('each repo has environments', () => {
      generator.generate(store, 2);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        expect(r.environments.length).toBeGreaterThan(0);
      }
    });

    it('each repo has at least one workflow', () => {
      generator.generate(store, 3);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        expect(r.workflows.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('workflow YAML includes an environment needs chain (dev→staging→prod)', () => {
      generator.generate(store, 1);
      const [key] = store.allRepoKeys();
      const [owner, repo] = key.split('/');
      const r = store.getRepo(owner, repo)!;

      // At least one stored YAML must reference all three environments
      let foundChain = false;
      for (const yaml of r.workflowYaml.values()) {
        if (
          yaml.includes('environment: dev') &&
          yaml.includes('environment: staging') &&
          yaml.includes('environment: prod') &&
          yaml.includes('needs:')
        ) {
          foundChain = true;
          break;
        }
      }
      expect(foundChain).toBe(true);
    });

    it('each repo has at least one deployment', () => {
      generator.generate(store, 3);
      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        expect(r.deployments.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('deployments have all required fields', () => {
      generator.generate(store, 2);
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

    it('deployments carry a full in-progress → terminal status lifecycle', () => {
      generator.generate(store, 3);
      let foundFullLifecycle = false;

      for (const key of store.allRepoKeys()) {
        const [owner, repo] = key.split('/');
        const r = store.getRepo(owner, repo)!;
        for (const [, statusList] of r.statuses) {
          const states = statusList.map(s => s.state);
          if (states.includes('in_progress') && (states.includes('success') || states.includes('failure'))) {
            foundFullLifecycle = true;
          }
        }
      }

      expect(foundFullLifecycle).toBe(true);
    });

    it('each status has a target_url embedding /actions/runs/{run_id}', () => {
      generator.generate(store, 2);
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
      generator.generate(store, 3);
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
      generator.generate(store, 2);
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

    it('generates deterministic count of repos', () => {
      const count = 4;
      generator.generate(store, count);
      expect(store.summary().repos).toBe(count);
    });
  });

  describe('appendRandomEmit()', () => {
    it('appends a new deployment to an existing repo', () => {
      generator.generate(store, 1);
      const before = store.summary().deployments;
      generator.appendRandomEmit(store);
      expect(store.summary().deployments).toBeGreaterThan(before);
    });

    it('does nothing when the store is empty', () => {
      // Should not throw
      expect(() => generator.appendRandomEmit(store)).not.toThrow();
    });

    it('appended deployment has an in_progress status', () => {
      generator.generate(store, 1);
      const [key] = store.allRepoKeys();
      const [owner, repo] = key.split('/');
      const r = store.getRepo(owner, repo)!;
      const beforeCount = r.deployments.length;

      generator.appendRandomEmit(store);

      // The last deployment added
      const newDep = r.deployments.slice(beforeCount).pop();
      expect(newDep).toBeDefined();
      const statuses = r.statuses.get(newDep!.id)!;
      expect(statuses.some(s => s.state === 'in_progress')).toBe(true);
    });

    it('appended statuses include a terminal state', () => {
      generator.generate(store, 1);
      const [key] = store.allRepoKeys();
      const [owner, repo] = key.split('/');
      const r = store.getRepo(owner, repo)!;
      const beforeCount = r.deployments.length;

      generator.appendRandomEmit(store);

      const newDep = r.deployments.slice(beforeCount).pop();
      const statuses = r.statuses.get(newDep!.id)!;
      expect(statuses.some(s => s.state === 'success' || s.state === 'failure')).toBe(true);
    });
  });
});
