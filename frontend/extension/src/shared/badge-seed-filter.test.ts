// Regression tests for B1: badge seed must respect watch scope.
// Verifies that the filter-then-seed pattern (background.ts seedBadgeFromMatrix)
// produces counts only from watched slots.

import { describe, it, expect } from 'vitest';
import { seedSlotStatusFromMatrix, computeBadge } from './badge';
import { isWatched } from './filter';
import type { MatrixSlot, ExtensionSettings } from './types';

function makeSlot(
  service: string,
  environment: string,
  status: 'in-progress' | 'success' | 'failure',
): MatrixSlot {
  return {
    service,
    environment,
    current: { id: 'id1', status, version: null, happened_at: '' },
    last_successful: null,
    next: null,
  };
}

/** Replicates the fixed seedBadgeFromMatrix filter logic from background.ts. */
function seedWithFilter(slots: MatrixSlot[], settings: ExtensionSettings) {
  const watchedSlots = slots.filter(s => isWatched(s.service, s.environment, settings));
  return seedSlotStatusFromMatrix(watchedSlots);
}

const ALL_SLOTS: MatrixSlot[] = [
  makeSlot('api', 'prod', 'failure'),
  makeSlot('api', 'staging', 'in-progress'),
  makeSlot('worker', 'prod', 'failure'),
  makeSlot('worker', 'staging', 'success'),
];

describe('badge seed with watch filter (B1 regression)', () => {
  it('with no filter (exclude mode, empty lists): includes all slots', () => {
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'exclude',
      services: [],
      environments: [],
    };
    const map = seedWithFilter(ALL_SLOTS, settings);
    expect(Object.keys(map)).toHaveLength(4);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 2 });
  });

  it('exclude mode: excludes the "staging" environment', () => {
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'exclude',
      services: [],
      environments: ['staging'],
    };
    const map = seedWithFilter(ALL_SLOTS, settings);
    // staging slots excluded → api|prod (failure) + worker|prod (failure)
    expect(Object.keys(map)).toHaveLength(2);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 2 });
    expect('api|staging' in map).toBe(false);
    expect('worker|staging' in map).toBe(false);
  });

  it('exclude mode: excludes "api" service — badge counts only worker slots', () => {
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'exclude',
      services: ['api'],
      environments: [],
    };
    const map = seedWithFilter(ALL_SLOTS, settings);
    // worker|prod (failure) + worker|staging (success) remain
    expect(Object.keys(map)).toHaveLength(2);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });

  it('include mode: watches only api+prod — badge shows only that slot', () => {
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'include',
      services: ['api'],
      environments: ['prod'],
    };
    const map = seedWithFilter(ALL_SLOTS, settings);
    // only api|prod watched
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['api|prod']).toBe('failure');
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });

  it('include mode: empty lists → no slots watched → idle badge', () => {
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'include',
      services: [],
      environments: [],
    };
    const map = seedWithFilter(ALL_SLOTS, settings);
    expect(Object.keys(map)).toHaveLength(0);
    expect(computeBadge(map)).toEqual({ mode: 'idle', count: 0 });
  });

  it('without the filter, the badge would be inflated (documents the B1 bug)', () => {
    // With an include filter watching only prod, the unfiltered seed would still
    // count staging slots — this shows what the bug looked like.
    const settings: ExtensionSettings = {
      dashboardUrl: 'http://x',
      watching: true,
      filterMode: 'include',
      services: ['api'],
      environments: ['prod'],
    };
    const buggyMap = seedSlotStatusFromMatrix(ALL_SLOTS); // no filter — old behaviour
    const fixedMap = seedWithFilter(ALL_SLOTS, settings);

    // Buggy: counts all failures (2), fixed: counts only watched failure (1)
    expect(computeBadge(buggyMap).count).toBe(2);
    expect(computeBadge(fixedMap).count).toBe(1);
  });
});
