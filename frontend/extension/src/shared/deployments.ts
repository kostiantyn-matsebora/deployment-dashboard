// Pure helpers for /api/deployments — no browser API dependencies; fully unit-testable.
// Spec: docs/design/components.md §Latest-Change Popup Panel

import type { DeploymentEvent, ExtensionSettings } from './types';
import { isInScope } from './filter';

/** GET /api/deployments response envelope — items newest-first. */
export interface DeploymentsResponse {
  items: DeploymentEvent[];
}

/**
 * Unwraps an `{ items: string[] }` envelope from /api/services or /api/environments.
 * Returns an empty array when the envelope is absent or malformed.
 * Single shared helper — avoids re-implementing the unwrap logic in each consumer.
 */
export function unwrapItems(body: unknown): string[] {
  return (body as { items?: string[] } | null)?.items ?? [];
}

/**
 * Picks the first N in-scope deployments from a /api/deployments response (newest-first).
 * An event is in-scope when isWatched(service, environment) AND isStatusEnabled(status).
 * Returns an empty array when the body is invalid or no in-scope items exist.
 */
export function pickTopN(
  body: unknown,
  settings: Pick<ExtensionSettings, 'filterMode' | 'services' | 'environments' | 'statuses'>,
  n: number,
): DeploymentEvent[] {
  const items = (body as DeploymentsResponse | null)?.items;
  if (!Array.isArray(items)) return [];
  const result: DeploymentEvent[] = [];
  for (const event of items) {
    if (result.length >= n) break;
    if (isInScope(event.service, event.environment, event.status, settings)) {
      result.push(event);
    }
  }
  return result;
}
