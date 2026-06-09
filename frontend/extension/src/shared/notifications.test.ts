import { describe, it, expect } from 'vitest';
import { buildNotification, isProdLike } from './notifications';
import type { DeploymentEvent } from './types';

function makeEvent(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    id: 'evt-1',
    deployment_id: 'dep-1',
    service: 'api',
    environment: 'staging',
    version: 'v1.2.3',
    status: 'success',
    happened_at: '2024-06-09T10:00:00Z',
    run_url: 'https://ci.example.com/runs/42',
    run_number: '42',
    actor: 'alice',
    ref: null,
    sha: null,
    parent_deployments: null,
    progress_reporter: null,
    ...overrides,
  };
}

describe('isProdLike', () => {
  it('matches "prod"', () => expect(isProdLike('prod')).toBe(true));
  it('matches "production"', () => expect(isProdLike('production')).toBe(true));
  it('matches "prod-us-east"', () => expect(isProdLike('prod-us-east')).toBe(true));
  it('is case-insensitive', () => expect(isProdLike('PROD')).toBe(true));
  it('does not match "staging"', () => expect(isProdLike('staging')).toBe(false));
  it('does not match "preview"', () => expect(isProdLike('preview')).toBe(false));
});

describe('buildNotification', () => {
  // buildNotification is never null — callers gate firing via isStatusEnabled.

  it('in-progress: message contains "started"', () => {
    const n = buildNotification(makeEvent({ status: 'in-progress' }));
    expect(n.message).toContain('started');
    expect(n.title).toBe('api · staging');
  });

  it('pending: message contains "pending"', () => {
    const n = buildNotification(makeEvent({ status: 'pending' }));
    expect(n.message).toContain('pending');
  });

  it('queued: message contains "queued"', () => {
    const n = buildNotification(makeEvent({ status: 'queued' }));
    expect(n.message).toContain('queued');
  });

  it('waiting: message contains "waiting"', () => {
    const n = buildNotification(makeEvent({ status: 'waiting' }));
    expect(n.message).toContain('waiting');
  });

  it('cancelled: message contains "cancelled"', () => {
    const n = buildNotification(makeEvent({ status: 'cancelled' }));
    expect(n.message).toContain('cancelled');
  });

  it('rejected: message contains "rejected"', () => {
    const n = buildNotification(makeEvent({ status: 'rejected' }));
    expect(n.message).toContain('rejected');
  });

  it('version and run number appear in all statuses', () => {
    const n = buildNotification(makeEvent({ status: 'in-progress', version: 'v2.0.0', run_number: '99' }));
    expect(n.message).toContain('v2.0.0');
    expect(n.message).toContain('run #99');
  });

  it('clickUrl is set to run_url when present', () => {
    const n = buildNotification(makeEvent({ status: 'cancelled', run_url: 'https://ci.example.com/42' }));
    expect(n.clickUrl).toBe('https://ci.example.com/42');
  });

  it('clickUrl is null when run_url is absent', () => {
    const n = buildNotification(makeEvent({ status: 'pending', run_url: null }));
    expect(n.clickUrl).toBeNull();
  });

  describe('success', () => {
    it('builds title and message with version and run number', () => {
      const n = buildNotification(makeEvent({ status: 'success', environment: 'staging' }));
      expect(n).not.toBeNull();
      expect(n!.title).toBe('api · staging');
      expect(n!.message).toContain('succeeded');
      expect(n!.message).toContain('v1.2.3');
      expect(n!.message).toContain('run #42');
    });

    it('handles null version gracefully', () => {
      const n = buildNotification(makeEvent({ status: 'success', version: null, run_number: null }));
      expect(n!.message).toBe('api succeeded');
    });

    it('sets clickUrl to run_url', () => {
      const n = buildNotification(makeEvent({ status: 'success' }));
      expect(n!.clickUrl).toBe('https://ci.example.com/runs/42');
    });

    it('sets clickUrl to null when run_url is absent', () => {
      const n = buildNotification(makeEvent({ status: 'success', run_url: null }));
      expect(n!.clickUrl).toBeNull();
    });
  });

  describe('failure', () => {
    it('uses "failed" (lowercase) for non-prod environment', () => {
      const n = buildNotification(makeEvent({ status: 'failure', environment: 'staging' }));
      expect(n!.message).toContain('failed');
      expect(n!.message).not.toContain('FAILED');
    });

    it('uses "FAILED" emphasis and emphasised title for prod environment', () => {
      const n = buildNotification(makeEvent({ status: 'failure', environment: 'prod' }));
      expect(n!.message).toContain('FAILED');
      expect(n!.title).toContain('FAILED:');
    });

    it('uses emphasis for "production" environment', () => {
      const n = buildNotification(makeEvent({ status: 'failure', environment: 'production' }));
      expect(n!.title).toContain('FAILED:');
    });

    it('uses emphasis for "prod-us-east" environment', () => {
      const n = buildNotification(makeEvent({ status: 'failure', environment: 'prod-us-east' }));
      expect(n!.title).toContain('FAILED:');
    });
  });
});
