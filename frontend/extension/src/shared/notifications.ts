// Pure notification-content mapper — no browser API dependencies; fully unit-testable.
// Spec: docs/design/components.md §Notification Toast
//
// NOTE: The mockup describes HTML role=status live-regions and inline links.
// Native browser notifications are NOT HTML — they use plain-text title+message fields.
// `browser.notifications.onClicked` → browser.tabs.create handles the click-to-open-run flow.

import type { DeploymentEvent } from './types';

export interface NotificationContent {
  title: string;
  message: string;
  /** The URL to open when the notification is clicked (run_url, or null if absent). */
  clickUrl: string | null;
}

/** Returns true if an environment name is considered production-like. */
export function isProdLike(environment: string): boolean {
  const lower = environment.toLowerCase();
  return lower === 'prod' || lower === 'production' || lower.startsWith('prod-');
}

/**
 * Maps a DeploymentEvent to notification content for all 8 statuses.
 * Never returns null — callers gate firing via isStatusEnabled(status, settings).
 */
export function buildNotification(event: DeploymentEvent): NotificationContent {
  const { service, environment, version, status, run_url, run_number } = event;
  const versionLabel = version ? ` ${version}` : '';
  const runLabel     = run_number ? ` (run #${run_number})` : '';
  const clickUrl     = run_url ?? null;
  const base         = `${service} · ${environment}`;

  if (status === 'success') {
    return { title: base, message: `${service}${versionLabel} succeeded${runLabel}`, clickUrl };
  }

  if (status === 'failure') {
    const isProd   = isProdLike(environment);
    const emphasis = isProd ? 'FAILED' : 'failed';
    return {
      title:   isProd ? `FAILED: ${base}` : base,
      message: `${service}${versionLabel} ${emphasis}${runLabel}`,
      clickUrl,
    };
  }

  if (status === 'in-progress') {
    return { title: base, message: `${service}${versionLabel} started${runLabel}`, clickUrl };
  }

  if (status === 'pending') {
    return { title: base, message: `${service}${versionLabel} pending${runLabel}`, clickUrl };
  }

  if (status === 'queued') {
    return { title: base, message: `${service}${versionLabel} queued${runLabel}`, clickUrl };
  }

  if (status === 'waiting') {
    return { title: base, message: `${service}${versionLabel} waiting${runLabel}`, clickUrl };
  }

  if (status === 'cancelled') {
    return { title: base, message: `${service}${versionLabel} cancelled${runLabel}`, clickUrl };
  }

  // rejected
  return { title: base, message: `${service}${versionLabel} rejected${runLabel}`, clickUrl };
}
