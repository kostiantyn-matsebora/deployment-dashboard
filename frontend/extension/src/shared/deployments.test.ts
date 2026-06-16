// Unit tests for pickTopN — selects the top N in-scope deployments
// from a real GET /api/deployments { items: [...] } envelope (newest-first).
// In-scope = isWatched(service, env) AND isStatusEnabled(status).

import { describe, it, expect } from 'vitest';
import { pickTopN } from './deployments';
import { ALL_STATUSES } from './types';
import type { DeploymentEvent, ExtensionSettings } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEvent(
  service: string,
  environment: string,
  status: DeploymentEvent['status'] = 'success',
  happened_at = '2026-01-01T00:00:00Z',
): DeploymentEvent {
  return {
    id: `${service}-${environment}-${status}`,
    deployment_id: `d-${service}-${environment}`,
    service,
    environment,
    version: '1.0.0',
    status,
    happened_at,
    run_url: null,
    run_number: null,
    actor: null,
    ref: null,
    sha: null,
    parent_deployments: null,
    progress_reporter: null,
  };
}

const OPEN_SETTINGS: Pick<ExtensionSettings, 'filterMode' | 'services' | 'environments' | 'statuses'> = {
  filterMode:   'exclude',
  services:     [],
  environments: [],
  statuses:     [...ALL_STATUSES],
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('pickTopN', () => {
  it('returns [] for a null body', () => {
    expect(pickTopN(null, OPEN_SETTINGS, 5)).toEqual([]);
  });

  it('returns [] for a body with no items array', () => {
    expect(pickTopN({}, OPEN_SETTINGS, 5)).toEqual([]);
    expect(pickTopN({ items: null }, OPEN_SETTINGS, 5)).toEqual([]);
  });

  it('returns [] for an empty items array', () => {
    expect(pickTopN({ items: [] }, OPEN_SETTINGS, 5)).toEqual([]);
  });

  it('returns all items when fewer than N and all in-scope', () => {
    const items = [makeEvent('api', 'prod'), makeEvent('worker', 'staging')];
    expect(pickTopN({ items }, OPEN_SETTINGS, 5)).toHaveLength(2);
  });

  it('caps result at N', () => {
    const items = [
      makeEvent('a', 'prod'), makeEvent('b', 'prod'),
      makeEvent('c', 'prod'), makeEvent('d', 'prod'),
    ];
    expect(pickTopN({ items }, OPEN_SETTINGS, 2)).toHaveLength(2);
  });

  it('preserves newest-first order from the envelope', () => {
    const newest = makeEvent('api', 'prod',    'failure', '2026-06-09T12:00:00Z');
    const older  = makeEvent('api', 'staging', 'success', '2026-06-08T10:00:00Z');
    const result = pickTopN({ items: [newest, older] }, OPEN_SETTINGS, 5);
    expect(result[0]).toBe(newest);
    expect(result[1]).toBe(older);
  });

  it('skips items not in watch scope (service excluded)', () => {
    const excluded = makeEvent('api',    'prod',    'failure');
    const included = makeEvent('worker', 'staging', 'in-progress');
    const settings = { ...OPEN_SETTINGS, services: ['api'] };
    const result = pickTopN({ items: [excluded, included] }, settings, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(included);
  });

  it('skips items whose status is not in enabledStatuses', () => {
    const items = [
      makeEvent('api', 'prod', 'pending'),
      makeEvent('api', 'prod', 'success'),
    ];
    const settings = { ...OPEN_SETTINGS, statuses: ['success'] };
    const result = pickTopN({ items }, settings, 5);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('success');
  });

  it('returns [] when all items are filtered by status', () => {
    const items = [makeEvent('api', 'prod', 'pending'), makeEvent('api', 'prod', 'queued')];
    const settings = { ...OPEN_SETTINGS, statuses: ['success', 'failure'] };
    expect(pickTopN({ items }, settings, 5)).toEqual([]);
  });

  it('returns [] when all items are filtered by watch scope', () => {
    const items = [makeEvent('api', 'prod'), makeEvent('api', 'staging')];
    const settings = { ...OPEN_SETTINGS, services: ['api'] };
    expect(pickTopN({ items }, settings, 5)).toEqual([]);
  });

  it('handles a real /api/deployments envelope — newest-first, filters, caps at N', () => {
    const items: DeploymentEvent[] = [
      makeEvent('checkout', 'prod',    'in-progress', '2026-06-09T12:00:00Z'),
      makeEvent('checkout', 'staging', 'success',     '2026-06-09T11:00:00Z'),
      makeEvent('api',      'prod',    'failure',      '2026-06-09T10:00:00Z'),
      makeEvent('api',      'staging', 'pending',      '2026-06-09T09:00:00Z'),
      makeEvent('worker',   'prod',    'success',      '2026-06-09T08:00:00Z'),
      makeEvent('worker',   'staging', 'cancelled',    '2026-06-09T07:00:00Z'),
    ];
    // Exclude prod + only terminal/active statuses, cap at 3
    const settings = {
      ...OPEN_SETTINGS,
      environments: ['prod'],
      statuses: ['success', 'failure', 'in-progress'],
    };
    const result = pickTopN({ items }, settings, 3);
    // checkout|staging(success) qualifies; api|staging(pending) skipped; worker|staging(cancelled) skipped
    expect(result).toHaveLength(1);
    expect(result[0].service).toBe('checkout');
    expect(result[0].environment).toBe('staging');
    expect(result[0].status).toBe('success');
  });
});
