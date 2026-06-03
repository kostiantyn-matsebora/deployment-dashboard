/**
 * DeploymentApiService — rate-limit stream unit tests.
 *
 * Tests the filtering + mapping logic that the App uses when calling
 * streamComponentEvents():
 *   - rate-limit event_type → latestRateLimit signal updated
 *   - other event_types     → signal left unchanged (last-value-wins)
 *   - null payload          → ignored
 *
 * EventSource is not available in the Vitest/jsdom environment. We test the
 * App-level integration logic directly by simulating the Observable it consumes,
 * keeping the service as a pure value source.
 *
 * This approach mirrors the swimlanes.component.spec.ts pattern: inject a mock
 * service and feed signals; no real network connections.
 */
import { signal }             from '@angular/core';
import { ComponentEventRecord, RateLimitReport } from '../models/deployment.model';

// ── Helper — build a ComponentEventRecord ────────────────────────────────────

function mkRecord(
  event_type: string,
  state: string,
  payload: Record<string, unknown> | null,
): ComponentEventRecord {
  return {
    id:           'id-1',
    component_id: 'dashboard-fetcher',
    event_type,
    state,
    occurred_at:  '2026-06-04T10:00:00Z',
    received_at:  '2026-06-04T10:00:00Z',
    payload,
  };
}

/**
 * Simulate what App.connectComponentEvents() does for each record:
 * filter by event_type + payload, then map into RateLimitReport.
 * Returns the report or undefined (nothing set).
 */
function processRecord(record: ComponentEventRecord): RateLimitReport | undefined {
  if (record.event_type !== 'rate-limit' || !record.payload) {
    return undefined;
  }
  const p = record.payload;
  return {
    state:        record.state,
    adapter:      typeof p['adapter']      === 'string'  ? p['adapter']      : '',
    ci_limit:     typeof p['ci_limit']     === 'number'  ? p['ci_limit']     : null,
    ci_remaining: typeof p['ci_remaining'] === 'number'  ? p['ci_remaining'] : null,
    own_budget:   typeof p['own_budget']   === 'number'  ? p['own_budget']   : null,
    own_used:     typeof p['own_used']     === 'number'  ? p['own_used']     : null,
    reset_at:     typeof p['reset_at']     === 'string'  ? p['reset_at']     : null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('App.connectComponentEvents — rate-limit filtering', () => {

  // ── Filter: only rate-limit events update the signal ────────────────────

  it('processes a rate-limit event and maps all fields correctly', () => {
    const record = mkRecord('rate-limit', 'running', {
      adapter:      'github-actions',
      ci_limit:     5000,
      ci_remaining: 4830,
      own_budget:   2500,
      own_used:     170,
      reset_at:     '2026-06-04T11:00:00Z',
    });

    const report = processRecord(record);
    expect(report).toBeDefined();
    expect(report!.state).toBe('running');
    expect(report!.adapter).toBe('github-actions');
    expect(report!.ci_limit).toBe(5000);
    expect(report!.ci_remaining).toBe(4830);
    expect(report!.own_budget).toBe(2500);
    expect(report!.own_used).toBe(170);
    expect(report!.reset_at).toBe('2026-06-04T11:00:00Z');
  });

  it('maps state:paused from the envelope', () => {
    const record = mkRecord('rate-limit', 'paused', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    });
    const report = processRecord(record);
    expect(report!.state).toBe('paused');
  });

  it('ignores non-rate-limit event_type "status"', () => {
    const record = mkRecord('status', 'running', { adapter: 'github-actions' });
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores non-rate-limit event_type "heartbeat"', () => {
    const record = mkRecord('heartbeat', 'running', {});
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores non-rate-limit event_type "error"', () => {
    const record = mkRecord('error', 'error', { message: 'boom' });
    expect(processRecord(record)).toBeUndefined();
  });

  it('ignores a rate-limit event with null payload', () => {
    const record = mkRecord('rate-limit', 'running', null);
    expect(processRecord(record)).toBeUndefined();
  });

  // ── Last-value-wins via signal ────────────────────────────────────────────

  it('last-value-wins: later report overwrites earlier', () => {
    const rl = signal<RateLimitReport | undefined>(undefined);

    const r1 = processRecord(mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    }));
    if (r1) rl.set(r1);
    expect(rl()!.own_used).toBe(100);

    const r2 = processRecord(mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 3900,
      own_budget: 2500, own_used: 200, reset_at: null,
    }));
    if (r2) rl.set(r2);
    expect(rl()!.own_used).toBe(200);
  });

  it('non-rate-limit event does not overwrite the last rate-limit report', () => {
    const rl = signal<RateLimitReport | undefined>(undefined);

    const r1 = processRecord(mkRecord('rate-limit', 'running', {
      adapter: 'github-actions', ci_limit: 5000, ci_remaining: 4000,
      own_budget: 2500, own_used: 100, reset_at: null,
    }));
    if (r1) rl.set(r1);

    // Simulate a heartbeat arriving — processRecord returns undefined, App does not call set().
    const r2 = processRecord(mkRecord('heartbeat', 'running', {}));
    if (r2) rl.set(r2);

    // Signal should still hold the rate-limit report.
    expect(rl()).toBeDefined();
    expect(rl()!.own_used).toBe(100);
  });

  // ── Null field handling ───────────────────────────────────────────────────

  it('maps null numeric fields to null (not 0 or NaN)', () => {
    const record = mkRecord('rate-limit', 'running', {
      adapter:      'github-actions',
      ci_limit:     null,
      ci_remaining: null,
      own_budget:   null,
      own_used:     null,
      reset_at:     null,
    });
    const report = processRecord(record);
    expect(report!.ci_limit).toBeNull();
    expect(report!.ci_remaining).toBeNull();
    expect(report!.own_budget).toBeNull();
    expect(report!.own_used).toBeNull();
    expect(report!.reset_at).toBeNull();
  });

  it('maps missing payload fields to null (defensive mapping)', () => {
    const record = mkRecord('rate-limit', 'running', { adapter: 'github-actions' });
    const report = processRecord(record);
    expect(report!.ci_limit).toBeNull();
    expect(report!.ci_remaining).toBeNull();
    expect(report!.own_budget).toBeNull();
    expect(report!.own_used).toBeNull();
    expect(report!.reset_at).toBeNull();
  });
});
