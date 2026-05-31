import {
  generateRandomEvent,
  generateRandomChain,
  generateRandomEvents,
} from '../src/scenarios/random-event-generator';

// ── generateRandomEvent (used by EmitService — standalone, no parents) ────────

describe('generateRandomEvent', () => {
  it('returns an object with all required DeploymentEventIngest fields', () => {
    const ev = generateRandomEvent();
    expect(ev).toMatchObject({
      deployment_id: expect.any(String),
      service:       expect.any(String),
      environment:   expect.any(String),
      status:        expect.any(String),
      happened_at:   expect.any(String),
    });
  });

  it('status is a valid enum value', () => {
    const valid = ['in-progress', 'success', 'failure'];
    for (let i = 0; i < 30; i++) {
      expect(valid).toContain(generateRandomEvent().status);
    }
  });

  it('happened_at is a valid ISO 8601 date in the past (within 2 h)', () => {
    const before = Date.now();
    const { happened_at } = generateRandomEvent();
    const ts = new Date(happened_at as string).getTime();
    expect(ts).toBeLessThanOrEqual(before);
    expect(ts).toBeGreaterThan(before - 2 * 60 * 60 * 1_000);
  });

  it('deployment_id is unique across consecutive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRandomEvent().deployment_id));
    expect(ids.size).toBe(50);
  });

  it('does not include elapsed_minutes in the payload', () => {
    expect(generateRandomEvent()).not.toHaveProperty('elapsed_minutes');
  });
});

// ── generateRandomChain ────────────────────────────────────────────────────────

describe('generateRandomChain', () => {
  it('returns at least 2 events (minimum chain length)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomChain().length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns at most 5 events (ENV_ORDER length)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateRandomChain().length).toBeLessThanOrEqual(5);
    }
  });

  it('all events in a chain share the same service, run_number, and sha', () => {
    const chain = generateRandomChain();
    const { service, run_number, sha } = chain[0];
    for (const ev of chain) {
      expect(ev.service).toBe(service);
      expect(ev.run_number).toBe(run_number);
      expect(ev.sha).toBe(sha);
    }
  });

  it('environments advance in canonical order (no repetition, no reversal)', () => {
    const ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];
    const chain = generateRandomChain();
    const envIdxs = chain.map(ev => ORDER.indexOf(ev.environment as string));
    for (let i = 1; i < envIdxs.length; i++) {
      expect(envIdxs[i]).toBeGreaterThan(envIdxs[i - 1]);
    }
  });

  it('first event has empty parent_deployments', () => {
    const chain = generateRandomChain();
    expect(chain[0].parent_deployments).toEqual([]);
  });

  it('each subsequent event references its immediate predecessor', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const chain = generateRandomChain();
      for (let i = 1; i < chain.length; i++) {
        const parents = chain[i].parent_deployments as string[];
        expect(parents).toHaveLength(1);
        expect(parents[0]).toBe(chain[i - 1].deployment_id);
      }
    }
  });

  it('only the tip (last event) can be non-success', () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const chain = generateRandomChain();
      for (let i = 0; i < chain.length - 1; i++) {
        expect(chain[i].status).toBe('success');
      }
    }
  });

  it('happened_at decreases toward the tip (root is oldest)', () => {
    const chain = generateRandomChain();
    for (let i = 1; i < chain.length; i++) {
      const prev = new Date(chain[i - 1].happened_at as string).getTime();
      const curr = new Date(chain[i].happened_at as string).getTime();
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it('all events have the required DeploymentEventIngest fields', () => {
    for (const ev of generateRandomChain()) {
      expect(ev.deployment_id).toBeTruthy();
      expect(ev.service).toBeTruthy();
      expect(ev.environment).toBeTruthy();
      expect(ev.status).toBeTruthy();
      expect(ev.happened_at).toBeTruthy();
    }
  });
});

// ── generateRandomEvents ──────────────────────────────────────────────────────

describe('generateRandomEvents', () => {
  it('returns at least count events (chains are never split)', () => {
    for (const n of [1, 10, 50]) {
      expect(generateRandomEvents(n).length).toBeGreaterThanOrEqual(n);
    }
  });

  it('does not overshoot by more than chain-max-length − 1 (4)', () => {
    const n = 20;
    const events = generateRandomEvents(n);
    expect(events.length).toBeLessThanOrEqual(n + 4);
  });

  it('returns empty array for count=0', () => {
    expect(generateRandomEvents(0)).toHaveLength(0);
  });

  it('every event has the required fields', () => {
    for (const ev of generateRandomEvents(10)) {
      expect(ev.deployment_id).toBeTruthy();
      expect(ev.service).toBeTruthy();
      expect(ev.environment).toBeTruthy();
      expect(ev.status).toBeTruthy();
      expect(ev.happened_at).toBeTruthy();
    }
  });

  it('contains events with non-empty parent_deployments (chains are present)', () => {
    const events = generateRandomEvents(5);
    const withParents = events.filter(
      ev => (ev.parent_deployments as string[]).length > 0,
    );
    expect(withParents.length).toBeGreaterThan(0);
  });
});
