import {
  generateRandomEvent,
  generateRandomChain,
  generateRandomEvents,
  SERVICE_COUNT,
} from '../src/scenarios/random-event-generator';

// ── generateRandomEvent (EmitService one-shot, no parents) ────────────────────

/** Asserts every DeploymentEventIngest field that the generator must populate. */
function assertWireShape(ev: Record<string, unknown>): void {
  // Required fields
  expect(typeof ev.deployment_id).toBe('string');
  expect(typeof ev.service).toBe('string');
  expect(typeof ev.environment).toBe('string');
  expect(typeof ev.status).toBe('string');
  expect(typeof ev.happened_at).toBe('string');
  // Optional fields the generator MUST always populate
  expect(typeof ev.version).toBe('string');
  expect(typeof ev.actor).toBe('string');
  expect(typeof ev.run_number).toBe('string');
  expect(typeof ev.run_url).toBe('string');
  expect(typeof ev.ref).toBe('string');
  expect(typeof ev.sha).toBe('string');
  expect(Array.isArray(ev.parent_deployments)).toBe(true);
  // run_url must be a plausible URI
  expect(ev.run_url as string).toMatch(/^https?:\/\//);
  // run_url must embed the same run identifier as run_number
  expect(ev.run_url as string).toContain(ev.run_number as string);
}

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

  it('populates all optional wire fields (run_url, ref, run_number, version, actor, sha)', () => {
    for (let i = 0; i < 10; i++) assertWireShape(generateRandomEvent());
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

  it('all events comply with the full DeploymentEventIngest wire shape (incl. run_url, ref)', () => {
    for (let i = 0; i < 10; i++) {
      for (const ev of generateRandomChain()) assertWireShape(ev);
    }
  });

  it('all events in a chain share the same run_url and ref (same pipeline run)', () => {
    for (let i = 0; i < 20; i++) {
      const chain = generateRandomChain();
      const { run_url, ref } = chain[0];
      for (const ev of chain) {
        expect(ev.run_url).toBe(run_url);
        expect(ev.ref).toBe(ref);
      }
    }
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

  it('generates exactly count primary-chain scenarios', () => {
    // Each scenario's primary chain shares one run_number (0–40 min old).
    // Historical events (2 h / 4 h old) have their own run_numbers — exclude them.
    const oneHourAgo = Date.now() - 60 * 60_000;
    for (const n of [1, 3, 5]) {
      const events      = generateRandomEvents(n);
      const primaryRuns = new Set(
        events
          .filter(ev => new Date(ev.happened_at as string).getTime() > oneHourAgo)
          .map(ev => ev.run_number as string),
      );
      expect(primaryRuns.size).toBe(n);
    }
  });

  it('each service has all 3 statuses (in-progress, success, failure) across its events', () => {
    const events    = generateRandomEvents(SERVICE_COUNT);
    const byService = new Map<string, Set<string>>();
    for (const ev of events) {
      const svc = ev.service as string;
      if (!byService.has(svc)) byService.set(svc, new Set());
      byService.get(svc)!.add(ev.status as string);
    }
    for (const [, statuses] of byService) {
      expect(statuses).toEqual(new Set(['in-progress', 'success', 'failure']));
    }
  });

  it('the most recent event per slot is the primary (< 1 h old); historical events are ≥ 1 h old', () => {
    const events     = generateRandomEvents(3);
    const bySlot     = new Map<string, number[]>();
    const oneHourAgo = Date.now() - 60 * 60_000;
    for (const ev of events) {
      const key = `${ev.service as string}|${ev.environment as string}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key)!.push(new Date(ev.happened_at as string).getTime());
    }
    for (const [, timestamps] of bySlot) {
      timestamps.sort((a, b) => b - a); // newest first
      expect(timestamps[0]).toBeGreaterThan(oneHourAgo);   // primary: fresh
      expect(timestamps[1]).toBeLessThan(oneHourAgo);       // historical: old
      expect(timestamps[2]).toBeLessThan(oneHourAgo);       // historical: older
    }
  });

  it('historical events form linear chains — non-root events have parent_deployments within the same run', () => {
    const events     = generateRandomEvents(3);
    const oneHourAgo = Date.now() - 60 * 60_000;
    const historical = events.filter(
      ev => new Date(ev.happened_at as string).getTime() < oneHourAgo,
    );
    expect(historical.length).toBeGreaterThan(0);

    // Group historical events by run_number.
    const byRun = new Map<string, Record<string, unknown>[]>();
    for (const ev of historical) {
      const run = ev.run_number as string;
      if (!byRun.has(run)) byRun.set(run, []);
      byRun.get(run)!.push(ev);
    }

    // Each run with > 1 event: non-root events must have a non-empty parent_deployments.
    for (const [, runEvents] of byRun) {
      if (runEvents.length <= 1) continue;
      // Sort oldest first (root first in the chain).
      runEvents.sort((a, b) =>
        new Date(a.happened_at as string).getTime() - new Date(b.happened_at as string).getTime(),
      );
      // Root: no parents.
      expect(runEvents[0].parent_deployments).toEqual([]);
      // Non-root: must have exactly one parent pointing to an event in the same run.
      const runIds = new Set(runEvents.map(ev => ev.deployment_id as string));
      for (let i = 1; i < runEvents.length; i++) {
        const parents = runEvents[i].parent_deployments as string[];
        expect(parents.length).toBe(1);
        expect(runIds.has(parents[0])).toBe(true);
      }
    }
  });

  it('historical events within a run share run_number, sha, version, ref, run_url', () => {
    const events     = generateRandomEvents(3);
    const oneHourAgo = Date.now() - 60 * 60_000;
    const historical = events.filter(
      ev => new Date(ev.happened_at as string).getTime() < oneHourAgo,
    );
    const byRun = new Map<string, Record<string, unknown>[]>();
    for (const ev of historical) {
      const run = ev.run_number as string;
      if (!byRun.has(run)) byRun.set(run, []);
      byRun.get(run)!.push(ev);
    }
    for (const [run, runEvents] of byRun) {
      if (runEvents.length <= 1) continue;
      const first = runEvents[0];
      for (const ev of runEvents) {
        expect(ev.run_number).toBe(run);
        expect(ev.sha).toBe(first.sha);
        expect(ev.version).toBe(first.version);
        expect(ev.ref).toBe(first.ref);
        expect(ev.run_url).toBe(first.run_url);
      }
    }
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
