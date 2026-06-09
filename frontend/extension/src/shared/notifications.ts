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
 * Maps a DeploymentEvent to notification content.
 * Returns null if the event does not warrant a notification (non-terminal statuses).
 */
export function buildNotification(event: DeploymentEvent): NotificationContent | null {
  const { service, environment, version, status, run_url, run_number } = event;
  const versionLabel = version ? ` ${version}` : '';
  const runLabel = run_number ? ` (run #${run_number})` : '';

  if (status === 'success') {
    return {
      title: `${service} · ${environment}`,
      message: `${service}${versionLabel} succeeded${runLabel}`,
      clickUrl: run_url ?? null,
    };
  }

  if (status === 'failure') {
    const isProd = isProdLike(environment);
    const emphasis = isProd ? 'FAILED' : 'failed';
    return {
      title: isProd
        ? `FAILED: ${service} · ${environment}`
        : `${service} · ${environment}`,
      message: `${service}${versionLabel} ${emphasis}${runLabel}`,
      clickUrl: run_url ?? null,
    };
  }

  // No notification for non-terminal statuses (in-progress, pending, queued, etc.)
  return null;
}
