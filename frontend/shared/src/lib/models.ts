// Wire-format models — these mirror the JSON shape returned by the Read API
// (see docs/deployment-dashboard-architecture.md §7 "Matrix response shape").
// The API returns snake_case; we adapt at the boundary in the API client and
// expose camelCase to the rest of the SPA.
//
// FR-13 — every per-service entry carries two siblings: `envs` (the per-
// slot map, unchanged contract from FR-12) and `topology.edges` (the per-
// service env DAG; full snapshot, not a delta).
//
// SAD §7 "SSE topology semantics" — the SSE `slot-update` payload carries
// the slot state only. Topology is refreshed via a follow-up
// `GET /api/deployments?correlationAttribute=…` on every event.

export type DeploymentStatus = 'success' | 'failure' | 'in-progress';

/** A single terminal or in-progress deployment event (current / lastSuccessful). */
export interface DeploymentEvent {
  /** CI/CD-side identifier; surfaced in the history drawer (SAD §7 "Matrix response shape" field rules). */
  deploymentId: string;
  version: string;
  status?: DeploymentStatus;
  runUrl: string;
  runNumber: number;
  actor: string;
  deployedAt: string; // ISO-8601 UTC
  /** Explicit parent deployment_id values; empty when topology defers to the correlation fallback. */
  parentDeployments: readonly string[];
  /**
   * Free-form git ref (branch, PR, tag). Optional — server MAY omit the
   * property OR emit `null` when the stored value is null; clients MUST
   * treat absence and `null` as equivalent (SAD §7 "Matrix response shape"
   * field rules). Not rendered in any UI yet — wired through the data
   * flow for a later picker / drawer column.
   */
  ref?: string | null;
  /**
   * Commit SHA. Same omitted-or-`null`-when-absent rule as `ref`
   * (SAD §7 "Matrix response shape" field rules). Not rendered yet.
   */
  sha?: string | null;
}

/** A populated slot in the services x environments matrix. */
export interface SlotState {
  current: DeploymentEvent & { status: DeploymentStatus };
  /** Null when current.status === 'success' or no successful deployment exists. */
  lastSuccessful: DeploymentEvent | null;
  /** True when current.status === 'in-progress' AND prev terminal was failure. */
  previousFailed: boolean;
}

/** matrix[service][environment] === SlotState | null (null = never deployed). */
export type MatrixState = Record<string, Record<string, SlotState | null>>;

export interface ServiceDescriptor {
  id: string;
  name: string;
}

export interface EnvironmentDescriptor {
  id: string;
  label: string;
}

/** Edge in a per-service env DAG (FR-13). */
export interface Edge {
  from: string;
  to: string;
  source: 'explicit' | 'correlated';
}

/** Per-service topology snapshot — always present (possibly empty). */
export interface Topology {
  edges: readonly Edge[];
}

/** topology[service].edges — derived per-service, never global. */
export type TopologyState = Record<string, Topology>;

/**
 * Wire payload received over the SSE `slot-update` event channel.
 *
 * SAD §7 "SSE topology semantics" — slot state only; topology is fetched
 * via a follow-up GET on every event. The SPA never reads `topology` off
 * the SSE wire even if the server were to emit one defensively.
 */
export interface SlotUpdatePayload {
  service: string;
  environment: string;
  state: SlotState;
}

/** Per-slot history entry returned by GET /api/deployments/{s}/{e}/history. */
export interface HistoryEntry {
  deploymentId: string;
  version: string;
  status: DeploymentStatus;
  runUrl: string;
  runNumber: number;
  actor: string;
  deployedAt: string;
  parentDeployments: readonly string[];
  /** See `DeploymentEvent.ref` — same contract, not rendered yet. */
  ref?: string | null;
  /** See `DeploymentEvent.sha` — same contract, not rendered yet. */
  sha?: string | null;
}

/**
 * Server-side topology-correlation configuration surfaced by
 * GET /api/config/topology (FR-13). Read-only from the SPA's perspective —
 * the user's per-tab picker preference travels via `correlationAttribute`
 * on read endpoints (SAD §10 Decision #7) and lives in localStorage under
 * `dashboard.correlationAttribute`. The SPA renders `correlationAttribute`
 * here as the "system default" label in the picker.
 */
export interface TopologyConfig {
  correlationAttribute: string;
  perServiceOverrides: Readonly<Record<string, string>>;
}

// --- raw wire (snake_case) shapes ------------------------------------------

/** Raw snake_case shapes coming off the wire. Kept here for the adapter. */
export interface WireDeploymentEvent {
  deployment_id?: string;
  version: string;
  status?: DeploymentStatus;
  run_url: string;
  run_number: number;
  actor: string;
  deployed_at: string;
  parent_deployments?: readonly string[] | null;
  /**
   * Server MAY omit OR send `null` when the stored value is null
   * (SAD §7 "Matrix response shape" field rules). Both forms accepted here.
   */
  ref?: string | null;
  /** Same omitted-or-`null` rule as `ref` (SAD §7). */
  sha?: string | null;
}

export interface WireSlotState {
  current: WireDeploymentEvent & { status: DeploymentStatus };
  lastSuccessful: WireDeploymentEvent | null;
  previousFailed: boolean;
}

export interface WireEdge {
  from: string;
  to: string;
  source: 'explicit' | 'correlated';
}

export interface WireTopology {
  edges?: readonly WireEdge[] | null;
}

/**
 * Per-service envelope on the wire — `{ envs, topology }` (FR-13).
 * `envs` mirrors the legacy per-service slot map.
 */
export interface WireServiceEntry {
  envs: Record<string, WireSlotState | null>;
  topology?: WireTopology | null;
}

/**
 * New top-level matrix wire shape — keyed by service, each entry has
 * `{ envs, topology }`. See SAD §7 "Matrix response shape — per service".
 */
export type WireMatrix = Record<string, WireServiceEntry>;

/**
 * SSE slot-update wire payload — slot state only. The server MAY still emit
 * a `topology` field defensively during the contract transition; if so the
 * adapter ignores it (SAD §7 "SSE topology semantics" — single source of
 * truth, the matrix GET endpoint).
 */
export interface WireSlotUpdatePayload {
  service: string;
  environment: string;
  state: WireSlotState;
}

export interface WireHistoryEntry {
  deployment_id?: string;
  version: string;
  status: DeploymentStatus;
  run_url: string;
  run_number: number;
  actor: string;
  deployed_at: string;
  parent_deployments?: readonly string[] | null;
  /** Same omitted-or-`null`-when-absent rule as the matrix shape (SAD §7). */
  ref?: string | null;
  sha?: string | null;
}

export interface WireTopologyConfig {
  correlationAttribute: string;
  perServiceOverrides?: Readonly<Record<string, string>> | null;
}

// --- adapters --------------------------------------------------------------

export function adaptDeploymentEvent(wire: WireDeploymentEvent): DeploymentEvent {
  const out: DeploymentEvent = {
    deploymentId: wire.deployment_id ?? '',
    version: wire.version,
    status: wire.status,
    runUrl: wire.run_url,
    runNumber: wire.run_number,
    actor: wire.actor,
    deployedAt: wire.deployed_at,
    parentDeployments: wire.parent_deployments ?? []
  };
  // ref / sha — pass through verbatim. Preserve "absent" vs "null"
  // distinction: only set the property when present on the wire so a
  // missing field stays missing on the model (SAD §7 — clients MUST
  // treat absent and `null` as equivalent; preserving both is the
  // simplest way to honour that without lossy normalisation).
  if ('ref' in wire) out.ref = wire.ref;
  if ('sha' in wire) out.sha = wire.sha;
  return out;
}

export function adaptSlotState(wire: WireSlotState | null): SlotState | null {
  if (!wire) return null;
  return {
    current: { ...adaptDeploymentEvent(wire.current), status: wire.current.status },
    lastSuccessful: wire.lastSuccessful ? adaptDeploymentEvent(wire.lastSuccessful) : null,
    previousFailed: wire.previousFailed
  };
}

export function adaptTopology(wire: WireTopology | null | undefined): Topology {
  if (!wire || !wire.edges) return { edges: [] };
  return { edges: wire.edges.map(e => ({ from: e.from, to: e.to, source: e.source })) };
}

/**
 * Adapt the FR-13 per-service envelope shape. Defensive — if the legacy
 * flat shape (without `envs` wrapper) shows up during a transition window,
 * detect it and treat the whole entry as the env map with empty topology.
 */
export function adaptMatrix(wire: WireMatrix): { matrix: MatrixState; topology: TopologyState } {
  const matrix: MatrixState = {};
  const topology: TopologyState = {};
  for (const service of Object.keys(wire)) {
    const entry = wire[service];
    const envWire = entry && typeof entry === 'object' && 'envs' in entry
      ? entry.envs
      : (entry as unknown as Record<string, WireSlotState | null>);
    const topoWire = entry && typeof entry === 'object' && 'topology' in entry
      ? entry.topology ?? null
      : null;
    matrix[service] = {};
    for (const env of Object.keys(envWire ?? {})) {
      matrix[service][env] = adaptSlotState(envWire[env]);
    }
    topology[service] = adaptTopology(topoWire);
  }
  return { matrix, topology };
}

export function adaptHistoryEntry(wire: WireHistoryEntry): HistoryEntry {
  const out: HistoryEntry = {
    deploymentId: wire.deployment_id ?? '',
    version: wire.version,
    status: wire.status,
    runUrl: wire.run_url,
    runNumber: wire.run_number,
    actor: wire.actor,
    deployedAt: wire.deployed_at,
    parentDeployments: wire.parent_deployments ?? []
  };
  if ('ref' in wire) out.ref = wire.ref;
  if ('sha' in wire) out.sha = wire.sha;
  return out;
}

export function adaptTopologyConfig(wire: WireTopologyConfig): TopologyConfig {
  return {
    correlationAttribute: wire.correlationAttribute,
    perServiceOverrides: wire.perServiceOverrides ?? {}
  };
}
