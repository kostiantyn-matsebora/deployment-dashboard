/**
 * Unit tests for feed-group.util — groupFeedEvents, visibleIdentitiesFromEvents.
 */
import { describe, it, expect } from 'vitest';
import { groupFeedEvents, visibleIdentitiesFromEvents } from './feed-group.util';
import { DeploymentEvent } from '../models/deployment.model';

function ev(overrides: Partial<DeploymentEvent> & { id: string; deployment_id: string }): DeploymentEvent {
  return {
    service:     'payments-api',
    environment: 'prod',
    status:      'success',
    happened_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('groupFeedEvents', () => {
  it('returns an empty array for an empty input', () => {
    expect(groupFeedEvents([])).toEqual([]);
  });

  it('groups a single event into a single group', () => {
    const e = ev({ id: 'e1', deployment_id: 'dep-1' });
    const groups = groupFeedEvents([e]);
    expect(groups).toEqual([{ id: 'dep-1', events: [e] }]);
  });

  it('collects multiple events with the same deployment_id into one group, preserving order', () => {
    const e1 = ev({ id: 'e1', deployment_id: 'dep-1', status: 'success' });
    const e2 = ev({ id: 'e2', deployment_id: 'dep-1', status: 'in-progress' });
    const groups = groupFeedEvents([e1, e2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('dep-1');
    expect(groups[0].events).toEqual([e1, e2]);
  });

  it('orders groups by first (newest) occurrence in the input', () => {
    const a1 = ev({ id: 'a1', deployment_id: 'dep-a' });
    const b1 = ev({ id: 'b1', deployment_id: 'dep-b' });
    const a2 = ev({ id: 'a2', deployment_id: 'dep-a' });
    // Input is newest-first overall: dep-b's only event sits between dep-a's two.
    const groups = groupFeedEvents([a1, b1, a2]);
    expect(groups.map((g) => g.id)).toEqual(['dep-a', 'dep-b']);
    expect(groups[0].events).toEqual([a1, a2]);
    expect(groups[1].events).toEqual([b1]);
  });

  it('does not mutate the input array', () => {
    const events = [ev({ id: 'e1', deployment_id: 'dep-1' })];
    const copy = [...events];
    groupFeedEvents(events);
    expect(events).toEqual(copy);
  });
});

describe('visibleIdentitiesFromEvents', () => {
  it('returns an empty array for an empty input', () => {
    expect(visibleIdentitiesFromEvents([])).toEqual([]);
  });

  it('dedups repeated (service, namespace) pairs, first-seen order', () => {
    const events = [
      ev({ id: 'e1', deployment_id: 'dep-1', service: 'gateway', namespace: 'org-a' }),
      ev({ id: 'e2', deployment_id: 'dep-2', service: 'auth-bff', namespace: null }),
      ev({ id: 'e3', deployment_id: 'dep-3', service: 'gateway', namespace: 'org-a' }),
    ];
    expect(visibleIdentitiesFromEvents(events)).toEqual([
      { service: 'gateway', namespace: 'org-a' },
      { service: 'auth-bff', namespace: null },
    ]);
  });

  it('keeps the same bare service under different namespaces as distinct identities', () => {
    const events = [
      ev({ id: 'e1', deployment_id: 'dep-1', service: 'gateway', namespace: 'org-a' }),
      ev({ id: 'e2', deployment_id: 'dep-2', service: 'gateway', namespace: 'org-b' }),
    ];
    expect(visibleIdentitiesFromEvents(events)).toEqual([
      { service: 'gateway', namespace: 'org-a' },
      { service: 'gateway', namespace: 'org-b' },
    ]);
  });
});
