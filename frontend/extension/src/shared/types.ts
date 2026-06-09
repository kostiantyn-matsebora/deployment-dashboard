// Wire types — field names match the deployment_events table columns exactly.
// Source of truth: docs/API_SPECIFICATION.md §4 + /api/events/stream (event: deployment).

export type DeploymentStatus =
  | 'pending'
  | 'queued'
  | 'waiting'
  | 'in-progress'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'rejected';

/** All 8 statuses in display order — used as the default allow-list. */
export const ALL_STATUSES: DeploymentStatus[] = [
  'pending', 'queued', 'waiting', 'in-progress',
  'success', 'failure', 'cancelled', 'rejected',
];

/** Payload of an SSE `event: deployment` message (JSON-serialised row). */
export interface DeploymentEvent {
  id: string;
  deployment_id: string;
  service: string;
  environment: string;
  version: string | null;
  status: DeploymentStatus;
  happened_at: string; // ISO 8601 timestamptz
  run_url: string | null;
  run_number: string | null;
  actor: string | null;
  ref: string | null;
  sha: string | null;
  parent_deployments: string[] | null;
  progress_reporter: string | null;
}

/**
 * One slot from the `slots` map inside a MatrixRow.
 * Key = environment name; shape from openapi MatrixSlot.
 * `current` is the most recent effective deployment (status: in-progress|success|failure).
 */
export interface MatrixSlot {
  current?: {
    id: string;
    status: 'in-progress' | 'success' | 'failure';
    version: string | null;
    happened_at: string;
  };
  last_successful?: {
    id: string;
    version: string | null;
    happened_at: string;
  };
  next?: {
    id: string;
    status: DeploymentStatus;
    version: string | null;
    happened_at: string;
  };
  prev_failed?: boolean;
}

/** One row from GET /api/matrix — openapi MatrixRow. */
export interface MatrixRow {
  service: string;
  /** Map of environment → MatrixSlot. Missing key = never deployed there. */
  slots: Record<string, MatrixSlot>;
}

/** GET /api/matrix response envelope — openapi Matrix. */
export interface MatrixResponse {
  generated_at: string;
  environments: string[];
  rows: MatrixRow[];
}

// ------------------------------------------------------------------
// Extension settings — persisted to storage.sync and storage.local.
// ------------------------------------------------------------------

/** Persisted to storage.sync — user-configurable settings. */
export interface ExtensionSettings {
  dashboardUrl: string;         // trailing slash stripped on save
  watching: boolean;            // master gate
  filterMode: 'exclude' | 'include';
  services: string[];           // selected items in the filter list
  environments: string[];       // selected items in the filter list
  statuses: string[];           // enabled-status allow-list (all 8 by default)
  popupCount: number;           // max events shown in popup list (default 5)
}

/** Persisted to storage.local — runtime/badge cache. */
export interface LocalState {
  lastEventId: string | null;
  /** Map of "service|environment" → effective status used to compute badge counts. */
  slotStatus: Record<string, 'in-progress' | 'success' | 'failure'>;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  dashboardUrl: '',
  watching: true,
  filterMode: 'exclude',
  services: [],
  environments: [],
  statuses: [...ALL_STATUSES],
  popupCount: 5,
};

export const DEFAULT_LOCAL_STATE: LocalState = {
  lastEventId: null,
  slotStatus: {},
};
