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
  it('returns null for in-progress', () => {
    expect(buildNotification(makeEvent({ status: 'in-progress' }))).toBeNull();
  });

  it('returns null for pending', () => {
    expect(buildNotification(makeEvent({ status: 'pending' }))).toBeNull();
  });

  it('returns null for queued', () => {
    expect(buildNotification(makeEvent({ status: 'queued' }))).toBeNull();
  });

  it('returns null for cancelled', () => {
    expect(buildNotification(makeEvent({ status: 'cancelled' }))).toBeNull();
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
