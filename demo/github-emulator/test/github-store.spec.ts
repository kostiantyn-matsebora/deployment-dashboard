import { GithubStore } from '../src/github-store';
import { RateLimitBudget } from '../src/rate-limit-headers';

// ── GithubStore ───────────────────────────────────────────────────────────────

describe('GithubStore', () => {
  let store: GithubStore;

  beforeEach(() => {
    store = new GithubStore();
  });

  describe('initial state', () => {
    it('starts empty', () => {
      const s = store.summary();
      expect(s.repos).toBe(0);
      expect(s.deployments).toBe(0);
      expect(s.statuses).toBe(0);
      expect(s.workflows).toBe(0);
      expect(s.environments).toBe(0);
      expect(s.dataset).toBe('');
    });

    it('seededAt is null initially', () => {
      expect(store.seededAt).toBeNull();
    });
  });

  describe('getOrCreateRepo', () => {
    it('creates a repo on first call', () => {
      const repo = store.getOrCreateRepo('acme', 'api');
      expect(repo).toBeDefined();
      expect(repo.deployments).toHaveLength(0);
    });

    it('returns the same repo on subsequent calls', () => {
      const r1 = store.getOrCreateRepo('acme', 'api');
      const r2 = store.getOrCreateRepo('acme', 'api');
      expect(r1).toBe(r2);
    });

    it('treats different repos as distinct', () => {
      const r1 = store.getOrCreateRepo('acme', 'api');
      const r2 = store.getOrCreateRepo('acme', 'web');
      expect(r1).not.toBe(r2);
    });
  });

  describe('getRepo', () => {
    it('returns undefined for unknown repo', () => {
      expect(store.getRepo('x', 'y')).toBeUndefined();
    });

    it('returns the repo after creation', () => {
      store.getOrCreateRepo('acme', 'api');
      expect(store.getRepo('acme', 'api')).toBeDefined();
    });
  });

  describe('seed / mutate', () => {
    it('accumulates deployments across calls', () => {
      const r = store.getOrCreateRepo('acme', 'api');
      r.deployments.push({
        id: 1, sha: 'abc', ref: 'main', environment: 'dev',
        payload: null, creator: { login: 'alice' }, created_at: new Date().toISOString(),
      });
      r.deployments.push({
        id: 2, sha: 'abc', ref: 'main', environment: 'prod',
        payload: null, creator: { login: 'bob' }, created_at: new Date().toISOString(),
      });

      expect(store.summary().deployments).toBe(2);
    });

    it('summary counts statuses across all deployments', () => {
      const r = store.getOrCreateRepo('acme', 'api');
      r.statuses.set(1, [
        { id: 10, state: 'in_progress', target_url: '', creator: { login: 'a' }, created_at: '' },
        { id: 11, state: 'success',     target_url: '', creator: { login: 'a' }, created_at: '' },
      ]);
      r.statuses.set(2, [
        { id: 20, state: 'failure', target_url: '', creator: { login: 'b' }, created_at: '' },
      ]);

      expect(store.summary().statuses).toBe(3);
    });

    it('setDataset records name and seededAt', () => {
      store.setDataset('demo');
      expect(store.dataset).toBe('demo');
      expect(store.seededAt).not.toBeNull();
    });
  });

  describe('clear', () => {
    it('empties all repos and resets metadata', () => {
      store.getOrCreateRepo('acme', 'api');
      store.setDataset('demo');
      store.clear();

      expect(store.summary().repos).toBe(0);
      expect(store.dataset).toBe('');
      expect(store.seededAt).toBeNull();
    });

    it('is idempotent', () => {
      store.clear();
      store.clear();
      expect(store.summary().repos).toBe(0);
    });
  });

  describe('allRepoKeys', () => {
    it('returns keys in owner/repo format', () => {
      store.getOrCreateRepo('acme', 'api');
      store.getOrCreateRepo('acme', 'web');
      const keys = store.allRepoKeys();
      expect(keys).toContain('acme/api');
      expect(keys).toContain('acme/web');
    });
  });

  describe('store independence from external data', () => {
    it('is a standalone process-local store — mutating one instance does not affect another', () => {
      const storeA = new GithubStore();
      const storeB = new GithubStore();

      storeA.getOrCreateRepo('org', 'repo');
      expect(storeB.summary().repos).toBe(0);
    });
  });
});

// ── RateLimitBudget ───────────────────────────────────────────────────────────

describe('RateLimitBudget', () => {
  it('starts with full budget', () => {
    const budget = new RateLimitBudget(100);
    const snap = budget.snapshot();
    expect(snap.limit).toBe(100);
    expect(snap.used).toBe(0);
    expect(snap.remaining).toBe(100);
  });

  it('decrements remaining on each consume()', () => {
    const budget = new RateLimitBudget(100);
    budget.consume();
    budget.consume();
    const snap = budget.snapshot();
    expect(snap.used).toBe(2);
    expect(snap.remaining).toBe(98);
  });

  it('remaining never goes below 0', () => {
    const budget = new RateLimitBudget(2);
    budget.consume();
    budget.consume();
    budget.consume(); // beyond limit
    const snap = budget.snapshot();
    expect(snap.remaining).toBe(0);
    expect(snap.used).toBe(2); // clamped at limit
  });

  it('reset epoch is in the future (next hour boundary)', () => {
    const budget = new RateLimitBudget(100);
    const snap = budget.snapshot();
    expect(snap.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rolls over after an hour boundary (simulated via fake timers)', () => {
    jest.useFakeTimers();
    try {
      const budget = new RateLimitBudget(100);
      budget.consume();
      budget.consume();
      expect(budget.snapshot().used).toBe(2);

      // Advance past the hour boundary
      jest.advanceTimersByTime(3_600_001);

      // snapshot/consume triggers rollover
      budget.consume();
      expect(budget.snapshot().used).toBe(1); // rolled over: only the post-advance consume
    } finally {
      jest.useRealTimers();
    }
  });
});
