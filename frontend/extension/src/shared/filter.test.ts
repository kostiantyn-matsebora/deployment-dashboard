import { describe, it, expect } from 'vitest';
import { isWatched, isStatusEnabled, isInScope } from './filter';
import { ALL_STATUSES } from './types';

describe('isWatched — exclude mode (default)', () => {
  const base = { filterMode: 'exclude' as const };

  it('watches everything when both lists are empty', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: [] })).toBe(true);
  });

  it('excludes a service that appears in the services list', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(false);
  });

  it('excludes an environment that appears in the environments list', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });

  it('watches when service is excluded but environment is not in list', () => {
    expect(isWatched('svc-b', 'staging', { ...base, services: ['svc-a'], environments: [] })).toBe(true);
  });

  it('excludes when both service AND environment are in their respective lists', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('watches service not in list even if other services are listed', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(true);
  });

  it('excludes when only environment matches', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });
});

describe('isWatched — include mode', () => {
  const base = { filterMode: 'include' as const };

  it('watches nothing when both lists are empty', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: [] })).toBe(false);
  });

  it('watches nothing when only services list is populated', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: [] })).toBe(false);
  });

  it('watches nothing when only environments list is populated', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: [], environments: ['prod'] })).toBe(false);
  });

  it('watches when both service AND environment are in their respective lists', () => {
    expect(isWatched('svc-a', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(true);
  });

  it('does not watch when service is included but environment is not', () => {
    expect(isWatched('svc-a', 'staging', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('does not watch when environment is included but service is not', () => {
    expect(isWatched('svc-b', 'prod', { ...base, services: ['svc-a'], environments: ['prod'] })).toBe(false);
  });

  it('watches multiple services/environments when all listed', () => {
    expect(
      isWatched('svc-b', 'staging', { ...base, services: ['svc-a', 'svc-b'], environments: ['prod', 'staging'] }),
    ).toBe(true);
  });
});

// ── isStatusEnabled ────────────────────────────────────────────────────────

describe('isStatusEnabled', () => {
  it('returns true when status is in the list', () => {
    expect(isStatusEnabled('success', { statuses: ['success', 'failure'] })).toBe(true);
    expect(isStatusEnabled('failure', { statuses: ['success', 'failure'] })).toBe(true);
  });

  it('returns false when status is not in the list', () => {
    expect(isStatusEnabled('pending', { statuses: ['success', 'failure'] })).toBe(false);
    expect(isStatusEnabled('in-progress', { statuses: ['success'] })).toBe(false);
  });

  it('returns false when statuses list is empty', () => {
    expect(isStatusEnabled('success', { statuses: [] })).toBe(false);
  });

  it('returns true for all 8 statuses when all are listed', () => {
    for (const s of ALL_STATUSES) {
      expect(isStatusEnabled(s, { statuses: [...ALL_STATUSES] })).toBe(true);
    }
  });
});

// ── isInScope ──────────────────────────────────────────────────────────────

describe('isInScope', () => {
  const openSettings = {
    filterMode: 'exclude' as const,
    services: [],
    environments: [],
    statuses: [...ALL_STATUSES],
  };

  it('returns true when watched and status is enabled', () => {
    expect(isInScope('api', 'prod', 'success', openSettings)).toBe(true);
  });

  it('returns false when service is excluded', () => {
    const s = { ...openSettings, services: ['api'] };
    expect(isInScope('api', 'prod', 'success', s)).toBe(false);
  });

  it('returns false when environment is excluded', () => {
    const s = { ...openSettings, environments: ['prod'] };
    expect(isInScope('api', 'prod', 'success', s)).toBe(false);
  });

  it('returns false when status is disabled', () => {
    const s = { ...openSettings, statuses: ['failure'] };
    expect(isInScope('api', 'prod', 'success', s)).toBe(false);
  });

  it('returns false when both watch scope and status filter exclude the item', () => {
    const s = { ...openSettings, services: ['api'], statuses: ['failure'] };
    expect(isInScope('api', 'prod', 'success', s)).toBe(false);
  });

  it('returns true when include mode matches service+env and status is enabled', () => {
    const s = {
      filterMode: 'include' as const,
      services: ['api'],
      environments: ['prod'],
      statuses: ['success', 'failure'],
    };
    expect(isInScope('api', 'prod', 'success', s)).toBe(true);
    expect(isInScope('api', 'prod', 'failure', s)).toBe(true);
  });

  it('returns false when include mode matches but status is disabled', () => {
    const s = {
      filterMode: 'include' as const,
      services: ['api'],
      environments: ['prod'],
      statuses: ['failure'],
    };
    expect(isInScope('api', 'prod', 'success', s)).toBe(false);
  });
});
