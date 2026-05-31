import {
  generateRandomEvent,
  generateRandomChain,
  generateRandomEvents,
  SERVICE_COUNT,
} from '../src/scenarios/random-event-generator';

// ── generateRandomEvent (EmitService one-shot, no parents) ────────────────────

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
  const SAMPLES = 60;

  it('returns at least 2 events (minimum chain length)', () => {
    for (let i = 0; i < SAMPLES; i++) {
      expect(generateRandomChain().length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns at most 5 events (ENV_ORDER length)', () => {
    for (let i = 0; i < SAMPLES; i++) {
      expect(generateRandomChain().length).toBeLessThanOrEqual(5);
    }
  });

  it('all events in a chain share the same service, run_number, and sha', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const chain = generateRandomChain();
      const { service, run_number, sha } = chain[0];
      for (const ev of chain) {
        expect(ev.service).toBe(service);
        expect(ev.run_number).toBe(run_number);
        expect(ev.sha).toBe(sha);
      }
    }
  });

  it('environments advance in canonical ENV_ORDER (no repetition, no reversal)', () => {
    const ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'];
    for (let i = 0; i < SAMPLES; i++) {
      const chain = generateRandomChain();
      const idxs  = chain.map(ev => ORDER.indexOf(ev.environment as string));
      for (let j = 1; j < idxs.length; j++) {
        expect(idxs[j]).toBeGreaterThan(idxs[j - 1]);
      }
    }
  });

  it('root event has empty parent_deployments', () => {
    for (let i = 0; i < SAMPLES; i++) {
      expect(generateRandomChain()[0].parent_deployments).toEqual([]);
    }
  });

  it('every non-root event has at least one parent_deployment', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const chain = generateRandomChain();
      for (let j = 1; j < chain.length; j++) {
        const parents = chain[j].parent_deployments as string[];
        expect(parents.length).toBeGreaterThan(0);
      }
    }
  });

  it('all parent_deployments reference valid deployment_ids within the same chain', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const chain = generateRandomChain();
      const ids   = new Set(chain.map(ev => ev.deployment_id as string));
      for (const ev of chain) {
        for (const p of ev.parent_deployments as string[]) {
          expect(ids.has(p)).toBe(true);
        }
      }
    }
  });

  it('each child has happened_at strictly greater than every parent (correct DAG time flow)', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const chain = generateRandomChain();
      const byId  = new Map(chain.map(ev => [ev.deployment_id as string, ev]));
      for (const ev of chain) {
        const evTime = new Date(ev.happened_at as string).getTime();
        for (const pid of ev.parent_deployments as string[]) {
          const parentTime = new Date(byId.get(pid)!.happened_at as string).getTime();
          expect(evTime).toBeGreaterThan(parentTime);
        }
      }
    }
  });

  it('only leaf nodes (no children) carry non-success status', () => {
    for (let i = 0; i < SAMPLES; i++) {
      const chain    = generateRandomChain();
      const hasChild = new Set<string>();
      for (const ev of chain) {
        for (const p of ev.parent_deployments as string[]) hasChild.add(p);
      }
      for (const ev of chain) {
        if (hasChild.has(ev.deployment_id as string)) {
          expect(ev.status).toBe('success');
        }
      }
    }
  });

  it('produces fan-out (one-to-many) topology in at least some chains', () => {
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const chain      = generateRandomChain();
      const childCount = new Map<string, number>();
      for (const ev of chain) {
        for (const p of ev.parent_deployments as string[]) {
          childCount.set(p, (childCount.get(p) ?? 0) + 1);
        }
      }
      if ([...childCount.values()].some(c => c >= 2)) found = true;
    }
    expect(found).toBe(true);
  });

  it('produces fan-in (many-to-one) topology in at least some chains', () => {
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      if (generateRandomChain().some(ev => (ev.parent_deployments as string[]).length >= 2)) {
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

// ── generateRandomEvents ──────────────────────────────────────────────────────

describe('generateRandomEvents', () => {
  it('returns empty array for count=0', () => {
    expect(generateRandomEvents(0)).toHaveLength(0);
  });

  it('generates at least 2 × count events (one scenario per service, each scenario ≥ 2 events)', () => {
    for (const n of [1, 3, SERVICE_COUNT]) {
      expect(generateRandomEvents(n).length).toBeGreaterThanOrEqual(n * 2);
    }
  });

  it('generates exactly count service scenarios', () => {
    // Each scenario shares a run_number within its chain.
    // Count distinct run_numbers = count distinct scenarios.
    for (const n of [1, 3, 5]) {
      const events = generateRandomEvents(n);
      const runs   = new Set(events.map(ev => ev.run_number as string));
      expect(runs.size).toBe(n);
    }
  });

  it('cycles through all services — no (service, env) duplicate within a single pass', () => {
    // One pass = SERVICE_COUNT scenarios.  Each service should appear at most once per pass.
    const events = generateRandomEvents(SERVICE_COUNT);
    const slots  = events.map(ev => `${ev.service as string}|${ev.environment as string}`);
    const unique = new Set(slots);
    // All (service, env) combos must be unique within the batch.
    expect(unique.size).toBe(slots.length);
  });

  it('contains events with non-empty parent_deployments (chains are linked)', () => {
    const withParents = generateRandomEvents(3)
      .filter(ev => (ev.parent_deployments as string[]).length > 0);
    expect(withParents.length).toBeGreaterThan(0);
  });

  it('every event has required fields', () => {
    for (const ev of generateRandomEvents(3)) {
      expect(ev.deployment_id).toBeTruthy();
      expect(ev.service).toBeTruthy();
      expect(ev.environment).toBeTruthy();
      expect(ev.status).toBeTruthy();
      expect(ev.happened_at).toBeTruthy();
    }
  });
});
