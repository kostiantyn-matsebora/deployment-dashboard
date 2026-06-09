import { describe, it, expect } from 'vitest';
import {
  computeBadge,
  applyEventDelta,
  seedSlotStatusFromMatrix,
  slotKey,
  isEffective,
} from './badge';
import type { MatrixSlot } from './types';

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
});

describe('seedSlotStatusFromMatrix', () => {
  const makeSlot = (service: string, environment: string, status: 'in-progress' | 'success' | 'failure' | null): MatrixSlot => ({
    service,
    environment,
    current: status ? { id: 'id1', status, version: null, happened_at: '' } : null,
    last_successful: null,
    next: null,
  });

  it('returns empty map when no slots', () => {
    expect(seedSlotStatusFromMatrix([])).toEqual({});
  });

  it('skips slots with null current', () => {
    const result = seedSlotStatusFromMatrix([makeSlot('svc', 'prod', null)]);
    expect(result).toEqual({});
  });

  it('maps effective status slots', () => {
    const slots = [
      makeSlot('svc-a', 'prod', 'success'),
      makeSlot('svc-b', 'staging', 'in-progress'),
      makeSlot('svc-c', 'prod', 'failure'),
    ];
    expect(seedSlotStatusFromMatrix(slots)).toEqual({
      'svc-a|prod': 'success',
      'svc-b|staging': 'in-progress',
      'svc-c|prod': 'failure',
    });
  });
});

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
