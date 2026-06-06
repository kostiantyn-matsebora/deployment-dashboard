/**
 * Domain model — Deployment Dashboard.
 * Source of truth: docs/api/openapi.yaml + docs/design/data-model.md
 *
 * 11 visible fields (id is synthetic and never rendered in the UI):
 * service, environment, version, status, run_url, sha, run_number,
 * ref, actor, happened_at, parent_deployments
 */

export type Status =
  | 'in-progress'
  | 'success'
  | 'failure'
  | 'pending'
  | 'queued'
  | 'waiting'
  | 'cancelled'
  | 'rejected';

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
  /** Most recent effective event (status: in-progress | success | failure). */
  current: DeploymentEvent;
  /**
   * Most recent successful event. Omitted when current IS the last success
   * (i.e. current.status === 'success').
   */
  last_successful?: DeploymentEvent;
  /**
   * True when there is at least one failure event between `current` and
   * `last_successful` (for in-progress current) or before the first event
   * (for in-progress with no success history).
   * Distinguishes S2 vs S3 and S5 vs S6.
   */
  prev_failed?: boolean;
  /**
   * The latest non-effective deployment beyond the live one —
   * status is one of pending | queued | waiting | cancelled | rejected.
   * Present only when such an event is newer (happened_at) than current.
   * Rendered as a secondary "next" context badge, never as the slot primary state.
   */
  next?: DeploymentEvent;
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
  | 's-success'          // S1 — last deployment succeeded
  | 's-run-last'         // S2 — in-progress; prev terminal = success
  | 's-run-fail-last'    // S3 — in-progress; prev terminal = failure; older success exists
  | 's-fail-last'        // S4 — failure; older success exists
  | 's-running-only'     // S5 — in-progress; no prior successful deployment
  | 's-run-fail-only'    // S6 — in-progress; no prior success; prev terminal = failure
  | 's-never-deployed';  // N  — context status; no effective baseline (first-ever gated deploy) // S6 — in-progress; prev terminal = failure; no success history

/**
 * Derive the box state from a matrix slot.
 * Uses `prev_failed` (populated by the server/mock) to distinguish:
 *   S2 vs S3 (both in-progress + last_successful)
 *   S5 vs S6 (both in-progress, no success history)
 */
/**
 * The five "context" statuses that are NOT primary tile states.
 * They appear as a secondary `.ctx-badge` pill on the tile/card.
 */
export type ContextStatus = 'pending' | 'queued' | 'waiting' | 'cancelled' | 'rejected';

/** Returns true when a status is a context (non-primary) status. */
export function isContextStatus(status: Status): status is ContextStatus {
  return (
    status === 'pending' ||
    status === 'queued' ||
    status === 'waiting' ||
    status === 'cancelled' ||
    status === 'rejected'
  );
}

export function deriveBoxState(slot: MatrixSlot): BoxState {
  const { current, last_successful, prev_failed } = slot;
  if (current.status === 'success') return 's-success';
  // Failure always maps to s-fail-last regardless of whether last_successful
  // is present. When last_successful is absent the tile renders as a full
  // failed tile (no split / bottom section).
  if (current.status === 'failure') return 's-fail-last';
  // Never-deployed: current is a context status (pending/queued/waiting/
  // cancelled/rejected) with NO effective baseline — first-ever gated deploy.
  // Renders as a neutral/grey tile with a status chip. DISTINCT from empty
  // slot ("—") and from a context next badge on an effective tile.
  if (isContextStatus(current.status)) {
    return last_successful ? 's-success' : 's-never-deployed';
  }
  // in-progress
  if (last_successful) return prev_failed ? 's-run-fail-last' : 's-run-last';
  return prev_failed ? 's-run-fail-only' : 's-running-only';
}

/** Matrix visible field names (7 toggles, all ON by default). */
export const MATRIX_FIELDS = [
  'version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at',
] as const;
export type MatrixField = typeof MATRIX_FIELDS[number];

/** Swimlanes visible field names (8 toggles, all ON by default). */
export const SWIMLANE_FIELDS = [
  'environment', 'version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at',
] as const;
export type SwimlaneField = typeof SWIMLANE_FIELDS[number];

/** Correlation predicates for the Swimlanes view. */
export const CORRELATION_PREDICATES = [
  'same sha', 'same run_number', 'same actor', 'same version', 'same ref', 'explicit parent',
] as const;
export type CorrelationPredicate = typeof CORRELATION_PREDICATES[number];

/** Time-window options for the Swimlanes correlation picker. */
export const TIME_WINDOWS = ['5 min', '1 hr', '1 day', '7 days'] as const;
export type TimeWindow = typeof TIME_WINDOWS[number];

// ── Operational telemetry — fetcher rate-limit reporting ──────────────────────

/**
 * Rate-limit snapshot stored in app state — combines the top-level `state`
 * field from the ComponentEventRecord envelope with the `payload` fields.
 * Shape convention from docs/api/api-guidelines.md §11 "Rate-limit report payload".
 * All numeric/time fields are null before the first GitHub API response.
 */
export interface RateLimitReport {
  /**
   * Fetcher lifecycle state from the ComponentEventRecord envelope.
   * "running" normally; "paused" during reset.
   */
  state: string;
  /** CI/CD adapter identifier (e.g. "github-actions"). Always present. */
  adapter: string;
  /** CI/CD API total hourly quota. Null before first GitHub response. */
  ci_limit: number | null;
  /** CI/CD-wide remaining quota (all token consumers). Null before first GitHub response. */
  ci_remaining: number | null;
  /** Fetcher self-throttle budget for this window. Null before first GitHub response. */
  own_budget: number | null;
  /** Fetcher's own request counter this window. Null before first GitHub response. */
  own_used: number | null;
  /** Window rollover instant (RFC 3339 UTC). Null before first GitHub response. */
  reset_at: string | null;
}

/**
 * Full ComponentEventRecord frame delivered by GET /api/control/events/stream.
 * Source: docs/api/api-guidelines.md §11 SSE component-events stream.
 */
export interface ComponentEventRecord {
  id: string;
  component_id: string;
  event_type: string;
  state: string;
  occurred_at: string;
  received_at: string;
  payload: Record<string, unknown> | null;
}
