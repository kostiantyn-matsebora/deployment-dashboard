/**
 * Domain model — Deployment Dashboard.
 * Source of truth: docs/api/openapi.yaml + docs/design/data-model.md
 *
 * 11 visible fields (id is synthetic and never rendered in the UI):
 * service, environment, version, status, run_url, sha, run_number,
 * ref, actor, happened_at, parent_deployments
 */

export type Status = 'in-progress' | 'success' | 'failure';

export type Theme = 'dark' | 'light' | 'auto';

/** A single deployment event row (append-only log entry). */
export interface DeploymentEvent {
  /** Server-assigned UUIDv7 — synthetic, never rendered in the UI. */
  id: string;
  deployment_id: string;
  service: string;
  environment: string;
  version?: string;
  status: Status;
  happened_at: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
  ref?: string;
  sha?: string;
  parent_deployments?: string[];
}

/** One (service, environment) cell in the Matrix view. */
export interface MatrixSlot {
  /** Most recent event for this slot. */
  current: DeploymentEvent;
  /**
   * Most recent successful event. Omitted when current IS the last success
   * (i.e. current.status === 'success').
   */
  last_successful?: DeploymentEvent;
}

/** One service row in the Matrix view. */
export interface MatrixRow {
  service: string;
  /** Map of environment → slot. Missing keys = never deployed here. */
  slots: Record<string, MatrixSlot>;
}

/** Full matrix snapshot returned by GET /api/matrix. */
export interface Matrix {
  generated_at: string;
  /** Stable sorted column order. */
  environments: string[];
  rows: MatrixRow[];
}

/** Cursor-paginated list of deployment events. */
export interface DeploymentEventPage {
  items: DeploymentEvent[];
  next_cursor?: string | null;
}

/**
 * Six box states (SAD §7 / components.md §6 Box States).
 * Derived client-side from (current.status, last_successful presence).
 */
export type BoxState =
  | 's-success'        // S1 — last deployment succeeded
  | 's-run-last'       // S2 — in-progress; prev terminal = success
  | 's-run-fail-last'  // S3 — in-progress; prev terminal = failure; older success exists
  | 's-fail-last'      // S4 — failure; older success exists
  | 's-running-only'   // S5 — in-progress; no prior successful deployment
  | 's-run-fail-only'; // S6 — in-progress; prev terminal = failure; no success history

/**
 * Derive the box state from a matrix slot.
 * S3 (run-fail-last) cannot be distinguished from S2 (run-last) from slot
 * data alone — both have in-progress + last_successful. That distinction is
 * resolved from slot history in the P2 full Matrix implementation.
 */
export function deriveBoxState(slot: MatrixSlot): BoxState {
  const { current, last_successful } = slot;
  if (current.status === 'success') return 's-success';
  if (current.status === 'failure') return last_successful ? 's-fail-last' : 's-running-only'; // fallback
  // in-progress
  return last_successful ? 's-run-last' : 's-running-only';
}

/** Matrix visible field names (8 toggles, all ON by default). */
export const MATRIX_FIELDS = [
  'version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at', 'parent_deployments',
] as const;
export type MatrixField = typeof MATRIX_FIELDS[number];

/** Swimlanes visible field names (8 toggles, all ON by default). */
export const SWIMLANE_FIELDS = [
  'environment', 'version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at',
] as const;
export type SwimlaneField = typeof SWIMLANE_FIELDS[number];

/** Correlation predicates for the Swimlanes view. */
export const CORRELATION_PREDICATES = [
  'same sha', 'same run_number', 'same actor', 'same version', 'explicit parent',
] as const;
export type CorrelationPredicate = typeof CORRELATION_PREDICATES[number];

/** Time-window options for the Swimlanes correlation picker. */
export const TIME_WINDOWS = ['5 min', '1 hr', '1 day', '7 days'] as const;
export type TimeWindow = typeof TIME_WINDOWS[number];
