// Regression tests for B1: badge seed must respect watch scope.
// Verifies that seedSlotStatusFromMatrix with a watchFilter predicate produces
// counts only from watched slots — matching the seedBadgeFromMatrix logic in background.ts.

import { describe, it, expect } from 'vitest';
import { seedSlotStatusFromMatrix, computeBadge, applyEventDelta } from './badge';
import { isWatched } from './filter';
import { ALL_STATUSES } from './types';
import type { MatrixResponse, ExtensionSettings } from './types';

// ── Fixture — mirrors the real /api/matrix envelope ─────────────────────

const MATRIX_RESPONSE: MatrixResponse = {
  generated_at: '2026-01-01T00:00:00Z',
  environments: ['prod', 'staging'],
  rows: [
    {
      service: 'api',
      slots: {
        prod:    { current: { id: 'a1', status: 'failure',     version: null, happened_at: '' } },
        staging: { current: { id: 'a2', status: 'in-progress', version: null, happened_at: '' } },
      },
    },
    {
      service: 'worker',
      slots: {
        prod:    { current: { id: 'w1', status: 'failure', version: null, happened_at: '' } },
        staging: { current: { id: 'w2', status: 'success', version: null, happened_at: '' } },
      },
    },
  ],
};

const BASE_SETTINGS: Pick<ExtensionSettings, 'statuses' | 'popupCount'> = {
  statuses:   [...ALL_STATUSES],
  popupCount: 5,
};

/** Replicates the seedBadgeFromMatrix logic from background.ts. */
function seedWithFilter(response: MatrixResponse, settings: ExtensionSettings) {
  return seedSlotStatusFromMatrix(
    response,
    (service, environment) => isWatched(service, environment, settings),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('badge seed with watch filter (B1 regression)', () => {
  it('with no filter (exclude mode, empty lists): includes all slots', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'exclude', services: [], environments: [],
    };
    const map = seedWithFilter(MATRIX_RESPONSE, settings);
    // All 4 slots: api|prod(failure) api|staging(in-progress) worker|prod(failure) worker|staging(success)
    expect(Object.keys(map)).toHaveLength(4);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 2 });
  });

  it('exclude mode: excludes the "staging" environment', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'exclude', services: [], environments: ['staging'],
    };
    const map = seedWithFilter(MATRIX_RESPONSE, settings);
    // staging slots excluded → api|prod (failure) + worker|prod (failure)
    expect(Object.keys(map)).toHaveLength(2);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 2 });
    expect('api|staging' in map).toBe(false);
    expect('worker|staging' in map).toBe(false);
  });

  it('exclude mode: excludes "api" service — badge counts only worker slots', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'exclude', services: ['api'], environments: [],
    };
    const map = seedWithFilter(MATRIX_RESPONSE, settings);
    // worker|prod (failure) + worker|staging (success) remain
    expect(Object.keys(map)).toHaveLength(2);
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });

  it('include mode: watches only api+prod — badge shows only that slot', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'include', services: ['api'], environments: ['prod'],
    };
    const map = seedWithFilter(MATRIX_RESPONSE, settings);
    // only api|prod watched
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['api|prod']).toBe('failure');
    expect(computeBadge(map)).toEqual({ mode: 'failure', count: 1 });
  });

  it('include mode: empty lists → no slots watched → idle badge', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'include', services: [], environments: [],
    };
    const map = seedWithFilter(MATRIX_RESPONSE, settings);
    expect(Object.keys(map)).toHaveLength(0);
    expect(computeBadge(map)).toEqual({ mode: 'idle', count: 0 });
  });

  it('without the filter, the badge would be inflated (documents the B1 bug)', () => {
    const settings: ExtensionSettings = {
      ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
      filterMode: 'include', services: ['api'], environments: ['prod'],
    };
    const buggyMap = seedSlotStatusFromMatrix(MATRIX_RESPONSE); // no filter
    const fixedMap = seedWithFilter(MATRIX_RESPONSE, settings);
    expect(computeBadge(buggyMap).count).toBe(2);
    expect(computeBadge(fixedMap).count).toBe(1);
  });
});

// ── B2 regression: live-event delta must respect watch scope ─────────────

describe('B2 regression: applyEventDelta must only run for watched service+env', () => {
  /**
   * Simulates the background.ts handleDeploymentEvent logic for live SSE events:
   * only apply the slot-status delta when isWatched returns true.
   */
  function applyDeltaIfWatched(
    slotStatus: Record<string, 'in-progress' | 'success' | 'failure'>,
    service: string,
    environment: string,
    status: Parameters<typeof applyEventDelta>[3],
    settings: ExtensionSettings,
  ) {
    if (!isWatched(service, environment, settings)) return slotStatus;
    return applyEventDelta(slotStatus, service, environment, status);
  }

  const OPEN_SETTINGS: ExtensionSettings = {
    ...BASE_SETTINGS, dashboardUrl: 'http://x', watching: true,
    filterMode: 'exclude', services: [], environments: [],
  };

  it('excluded service: badge count unchanged after live failure event', () => {
    const initial = { 'worker|prod': 'success' as const };
    const settings: ExtensionSettings = {
      ...OPEN_SETTINGS,
      services: ['api'],  // api excluded
    };
    // Simulate a failure event arriving for the excluded 'api' service
    const updated = applyDeltaIfWatched(initial, 'api', 'prod', 'failure', settings);
    // badge should still be idle — 'api' is excluded, so its failure must not be counted
    expect(computeBadge(updated)).toEqual({ mode: 'idle', count: 0 });
    expect('api|prod' in updated).toBe(false);
  });

  it('excluded environment: badge count unchanged after live failure event', () => {
    const initial = { 'api|staging': 'success' as const };
    const settings: ExtensionSettings = {
      ...OPEN_SETTINGS,
      environments: ['prod'],  // prod excluded
    };
    const updated = applyDeltaIfWatched(initial, 'api', 'prod', 'failure', settings);
    expect(computeBadge(updated)).toEqual({ mode: 'idle', count: 0 });
    expect('api|prod' in updated).toBe(false);
  });

  it('watched service+env: delta IS applied', () => {
    const initial = {};
    const updated = applyDeltaIfWatched(initial, 'api', 'prod', 'failure', OPEN_SETTINGS);
    expect(computeBadge(updated)).toEqual({ mode: 'failure', count: 1 });
    expect(updated['api|prod']).toBe('failure');
  });

  it('mixed: excluded service event does not inflate badge alongside a real failure', () => {
    const initial = { 'worker|prod': 'failure' as const };
    const settings: ExtensionSettings = {
      ...OPEN_SETTINGS,
      services: ['api'],  // api excluded
    };
    // api|prod failure arrives — must be ignored
    const updated = applyDeltaIfWatched(initial, 'api', 'prod', 'failure', settings);
    // badge should still show exactly 1 failure (worker only)
    expect(computeBadge(updated)).toEqual({ mode: 'failure', count: 1 });
  });
});
