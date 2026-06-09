import { describe, it, expect } from 'vitest';
import {
  computeBadge,
  applyEventDelta,
  seedSlotStatusFromMatrix,
  slotKey,
  isEffective,
} from './badge';
import type { MatrixResponse, MatrixSlot } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────

/** Build a minimal MatrixResponse from a flat list of (service, env, status) triples. */
function makeMatrixResponse(
  slots: Array<{ service: string; env: string; status: 'in-progress' | 'success' | 'failure' | null }>,
): MatrixResponse {
  const rowMap: Record<string, Record<string, MatrixSlot>> = {};
  for (const { service, env, status } of slots) {
    if (!rowMap[service]) rowMap[service] = {};
    rowMap[service][env] = status
      ? { current: { id: 'id1', status, version: null, happened_at: '' } }
      : {};
  }
  return {
    generated_at: '2026-01-01T00:00:00Z',
    environments: [...new Set(slots.map(s => s.env))],
    rows: Object.entries(rowMap).map(([service, slotsMap]) => ({ service, slots: slotsMap })),
  };
}

// ── isEffective ───────────────────────────────────────────────────────────

describe('isEffective', () => {
  it('returns true for effective statuses', () => {
    expect(isEffective('in-progress')).toBe(true);
    expect(isEffective('success')).toBe(true);
    expect(isEffective('failure')).toBe(true);
  });

  it('returns false for non-effective statuses', () => {
    for (const s of ['pending', 'queued', 'waiting', 'cancelled', 'rejected'] as const) {
      expect(isEffective(s)).toBe(false);
    }
  });
});

// ── computeBadge ──────────────────────────────────────────────────────────

describe('computeBadge', () => {
  it('returns idle when map is empty', () => {
    expect(computeBadge({})).toEqual({ mode: 'idle', count: 0 });
  });

  it('returns idle when all slots are success', () => {
    expect(computeBadge({ 'svc|prod': 'success', 'svc|staging': 'success' })).toEqual({ mode: 'idle', count: 0 });
  });

  it('returns in-progress with count when no failures', () => {
    expect(computeBadge({ 'a|prod': 'in-progress', 'b|prod': 'in-progress' })).toEqual({ mode: 'in-progress', count: 2 });
  });

  it('returns failure with correct count', () => {
    expect(computeBadge({ 'a|prod': 'failure', 'b|prod': 'success' })).toEqual({ mode: 'failure', count: 1 });
  });

  it('failure takes precedence over in-progress', () => {
    const map = { 'a|prod': 'in-progress' as const, 'b|prod': 'failure' as const };
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });

  it('counts multiple failures', () => {
    const map = { 'a|prod': 'failure' as const, 'b|prod': 'failure' as const };
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 2 });
  });

  // ── enabledStatuses gating ─────────────────────────────────────────────

  it('failure-disabled: failure slots do not count; returns idle when only failures present', () => {
    const map = { 'a|prod': 'failure' as const, 'b|prod': 'failure' as const };
    expect(computeBadge(map, ['success', 'in-progress'])).toEqual({ mode: 'idle', count: 0 });
  });

  it('failure-disabled: in-progress slots still count', () => {
    const map = { 'a|prod': 'failure' as const, 'b|prod': 'in-progress' as const };
    expect(computeBadge(map, ['in-progress', 'success'])).toEqual({ mode: 'in-progress', count: 1 });
  });

  it('in-progress-disabled: in-progress slots do not count; returns idle when only in-progress', () => {
    const map = { 'a|prod': 'in-progress' as const, 'b|prod': 'in-progress' as const };
    expect(computeBadge(map, ['success', 'failure'])).toEqual({ mode: 'idle', count: 0 });
  });

  it('in-progress-disabled: failure slots still count', () => {
    const map = { 'a|prod': 'in-progress' as const, 'b|prod': 'failure' as const };
    expect(computeBadge(map, ['success', 'failure'])).toEqual({ mode: 'failure', count: 1 });
  });

  it('empty enabledStatuses: all slots filtered → idle', () => {
    const map = { 'a|prod': 'failure' as const, 'b|prod': 'in-progress' as const };
    expect(computeBadge(map, [])).toEqual({ mode: 'idle', count: 0 });
  });

  it('all enabled (undefined): same as no-filter baseline', () => {
    const map = { 'a|prod': 'failure' as const, 'b|prod': 'in-progress' as const };
    expect(computeBadge(map, undefined)).toEqual({ mode: 'failure', count: 1 });
  });
});

// ── seedSlotStatusFromMatrix — real MatrixResponse envelope ───────────────

describe('seedSlotStatusFromMatrix', () => {
  it('returns empty map when rows is empty', () => {
    const response: MatrixResponse = { generated_at: '2026-01-01T00:00:00Z', environments: [], rows: [] };
    expect(seedSlotStatusFromMatrix(response)).toEqual({});
  });

  it('skips slots with no current entry', () => {
    const response = makeMatrixResponse([{ service: 'svc', env: 'prod', status: null }]);
    expect(seedSlotStatusFromMatrix(response)).toEqual({});
  });

  it('maps effective-status slots from rows[].slots record', () => {
    const response = makeMatrixResponse([
      { service: 'svc-a', env: 'prod', status: 'success' },
      { service: 'svc-b', env: 'staging', status: 'in-progress' },
      { service: 'svc-c', env: 'prod', status: 'failure' },
    ]);
    expect(seedSlotStatusFromMatrix(response)).toEqual({
      'svc-a|prod': 'success',
      'svc-b|staging': 'in-progress',
      'svc-c|prod': 'failure',
    });
  });

  it('handles multiple environments per service row', () => {
    // Single row with two env slots.
    const response: MatrixResponse = {
      generated_at: '2026-01-01T00:00:00Z',
      environments: ['prod', 'staging'],
      rows: [
        {
          service: 'api',
          slots: {
            prod: { current: { id: 'a', status: 'failure', version: null, happened_at: '' } },
            staging: { current: { id: 'b', status: 'in-progress', version: null, happened_at: '' } },
          },
        },
      ],
    };
    const result = seedSlotStatusFromMatrix(response);
    expect(result).toEqual({ 'api|prod': 'failure', 'api|staging': 'in-progress' });
  });

  it('watchFilter predicate limits which slots are seeded', () => {
    const response = makeMatrixResponse([
      { service: 'api', env: 'prod', status: 'failure' },
      { service: 'api', env: 'staging', status: 'in-progress' },
      { service: 'worker', env: 'prod', status: 'failure' },
    ]);
    // Watch only api|prod.
    const result = seedSlotStatusFromMatrix(response, (svc, env) => svc === 'api' && env === 'prod');
    expect(result).toEqual({ 'api|prod': 'failure' });
  });

  it('watchFilter: all filtered out → empty map', () => {
    const response = makeMatrixResponse([
      { service: 'api', env: 'prod', status: 'failure' },
    ]);
    const result = seedSlotStatusFromMatrix(response, () => false);
    expect(result).toEqual({});
  });

  it('badge counts from real envelope match expected: failure precedence over in-progress', () => {
    const response = makeMatrixResponse([
      { service: 'api', env: 'prod', status: 'failure' },
      { service: 'api', env: 'staging', status: 'in-progress' },
      { service: 'worker', env: 'prod', status: 'in-progress' },
    ]);
    const map = seedSlotStatusFromMatrix(response);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });
});

// ── applyEventDelta ───────────────────────────────────────────────────────

describe('applyEventDelta', () => {
  it('adds a new slot for an effective status', () => {
    const result = applyEventDelta({}, 'svc-a', 'prod', 'failure');
    expect(result[slotKey('svc-a', 'prod')]).toBe('failure');
  });

  it('updates an existing slot', () => {
    const initial = { 'svc-a|prod': 'in-progress' as const };
    const result = applyEventDelta(initial, 'svc-a', 'prod', 'success');
    expect(result['svc-a|prod']).toBe('success');
  });

  it('removes a slot for a non-effective status', () => {
    const initial = { 'svc-a|prod': 'in-progress' as const };
    const result = applyEventDelta(initial, 'svc-a', 'prod', 'cancelled');
    expect('svc-a|prod' in result).toBe(false);
  });

  it('does not mutate the input map', () => {
    const initial = { 'svc-a|prod': 'success' as const };
    applyEventDelta(initial, 'svc-a', 'prod', 'failure');
    expect(initial['svc-a|prod']).toBe('success');
  });

  it('leaves other slots untouched', () => {
    const initial = { 'svc-a|prod': 'success' as const, 'svc-b|staging': 'in-progress' as const };
    const result = applyEventDelta(initial, 'svc-a', 'prod', 'failure');
    expect(result['svc-b|staging']).toBe('in-progress');
  });
});
