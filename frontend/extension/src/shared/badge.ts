// Pure badge-state reducer — no browser API dependencies; fully unit-testable.
// Spec: docs/design/components.md §Toolbar Badge

import type { DeploymentStatus, MatrixSlot } from './types';

/** Effective statuses that contribute to the badge. */
type EffectiveStatus = 'in-progress' | 'success' | 'failure';

/** Resolved badge display state. */
export interface BadgeState {
  /** 'idle' → no overlay; 'in-progress' → amber; 'failure' → coral */
  mode: 'idle' | 'in-progress' | 'failure';
  count: number;
}

/**
 * Returns whether a deployment status is one of the three effective statuses
 * tracked in the slot-status map.
 */
export function isEffective(status: DeploymentStatus): status is EffectiveStatus {
  return status === 'in-progress' || status === 'success' || status === 'failure';
}

/**
 * Reduces a slot-status map to a BadgeState.
 * Failure takes precedence over in-progress per spec.
 */
export function computeBadge(slotStatus: Record<string, EffectiveStatus>): BadgeState {
  let inProgressCount = 0;
  let failureCount = 0;

  for (const status of Object.values(slotStatus)) {
    if (status === 'in-progress') inProgressCount++;
    else if (status === 'failure') failureCount++;
  }

  if (failureCount > 0) return { mode: 'failure', count: failureCount };
  if (inProgressCount > 0) return { mode: 'in-progress', count: inProgressCount };
  return { mode: 'idle', count: 0 };
}

/**
 * Seeds the slot-status map from GET /api/matrix response.
 * Only slots with an effective current status are stored.
 */
export function seedSlotStatusFromMatrix(
  slots: MatrixSlot[],
): Record<string, EffectiveStatus> {
  const result: Record<string, EffectiveStatus> = {};
  for (const slot of slots) {
    if (slot.current && isEffective(slot.current.status)) {
      result[slotKey(slot.service, slot.environment)] = slot.current.status;
    }
  }
  return result;
}

/**
 * Applies a live SSE event delta to the slot-status map.
 * Returns an updated copy; does not mutate the input.
 */
export function applyEventDelta(
  slotStatus: Record<string, EffectiveStatus>,
  service: string,
  environment: string,
  status: DeploymentStatus,
): Record<string, EffectiveStatus> {
  const updated = { ...slotStatus };
  const key = slotKey(service, environment);

  if (isEffective(status)) {
    updated[key] = status;
  } else {
    // Non-effective status (pending/queued/waiting/cancelled/rejected) —
    // remove the slot from the map so it no longer contributes to the badge.
    delete updated[key];
  }

  return updated;
}

export function slotKey(service: string, environment: string): string {
  return `${service}|${environment}`;
}
