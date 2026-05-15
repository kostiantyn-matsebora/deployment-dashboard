// Topology helpers shared by the Swim-lane and Workflow-rows layouts.
// Kept in `dashboard/` (not `shared/`) because the depth/path computations
// are layout-presentation concerns — the SAD's wire shape carries only the
// raw edge list. If a future v2 feature reuses these, promote them up.
//
// Empty-topology fallback (FR-13): when a service has no edges, both
// layouts render a single root chain ordered by `current.deployed_at` of
// each populated env. `singleChainFromMatrix` produces that fallback list.

import type {
  EnvironmentDescriptor,
  MatrixState,
  ServiceDescriptor,
  Topology
} from '@dd/shared';

/**
 * Group every env mentioned in `topology.edges` (plus any deployed env in
 * the service's matrix slice) into topological-depth buckets. Roots (no
 * incoming edges) → depth 0; children → 1 + max(parent depths). Stable
 * ordering inside each depth bucket: alphabetical.
 *
 * Used by Swim-lane to lay each service's envs into columns left-to-right.
 */
export function depthBuckets(
  topology: Topology,
  service: ServiceDescriptor,
  envs: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): readonly (readonly string[])[] {
  const envsInService = collectEnvIds(topology, service, envs, matrix);
  const adjacency = adjacencyFor(topology);

  const memo: Record<string, number> = {};
  const depthOf = (envId: string): number => {
    if (memo[envId] !== undefined) return memo[envId];
    const parents = adjacency.parents[envId] ?? [];
    if (parents.length === 0) {
      memo[envId] = 0;
      return 0;
    }
    let max = 0;
    for (const p of parents) {
      const d = depthOf(p);
      if (d + 1 > max) max = d + 1;
    }
    memo[envId] = max;
    return max;
  };

  if (envsInService.length === 0) return [];

  // If the topology has no edges at all, fall back to a single root chain
  // ordered by deployed_at — every env at its own depth.
  if (topology.edges.length === 0) {
    const chain = singleChainFromMatrix(envsInService, service, matrix);
    return chain.map(e => [e]);
  }

  const buckets: string[][] = [];
  for (const envId of envsInService) {
    const d = depthOf(envId);
    while (buckets.length <= d) buckets.push([]);
    buckets[d].push(envId);
  }
  for (const bucket of buckets) bucket.sort();
  return buckets;
}

/**
 * Enumerate root-to-leaf paths through one service's DAG. Returns a single
 * stable-ordered list of paths (each path = ordered env-id array). Empty
 * topology → single root chain from `current.deployed_at`.
 */
export function rootToLeafPaths(
  topology: Topology,
  service: ServiceDescriptor,
  envs: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): readonly (readonly string[])[] {
  const envsInService = collectEnvIds(topology, service, envs, matrix);
  if (envsInService.length === 0) return [];
  if (topology.edges.length === 0) {
    return [singleChainFromMatrix(envsInService, service, matrix)];
  }
  const { children, parents } = adjacencyFor(topology);
  const roots = envsInService.filter(e => (parents[e] ?? []).length === 0).sort();
  const out: string[][] = [];
  const dfs = (node: string, acc: string[]): void => {
    const trail = [...acc, node];
    const next = (children[node] ?? []).slice().sort();
    if (next.length === 0) {
      out.push(trail);
      return;
    }
    for (const c of next) dfs(c, trail);
  };
  for (const r of roots) dfs(r, []);
  out.sort((a, b) => a.join('>').localeCompare(b.join('>')));
  return out;
}

/**
 * Pick the default workflow path — the one whose latest-touched env has
 * the freshest `current.deployed_at`. Stable when multiple paths share a
 * timestamp (lower index wins). Mirrors the mockup's `computeDefaultPath`.
 */
export function defaultPathIndex(
  paths: readonly (readonly string[])[],
  service: ServiceDescriptor,
  matrix: MatrixState
): number {
  if (paths.length <= 1) return 0;
  let bestIdx = 0;
  let bestT = -Infinity;
  paths.forEach((p, idx) => {
    let pathT = -Infinity;
    for (const envId of p) {
      const dt = matrix[service.id]?.[envId]?.current.deployedAt;
      const t = dt ? Date.parse(dt) : NaN;
      if (Number.isFinite(t) && t > pathT) pathT = t as number;
    }
    if (pathT > bestT) {
      bestT = pathT;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

/**
 * `topologyLabel` — one of `linear` / `branching` / `merging` / `branching + merging`.
 * Mirrors the mockup helper used in service-meta grey lines.
 */
export function topologyShape(topology: Topology): string {
  const outgoing: Record<string, number> = {};
  const incoming: Record<string, number> = {};
  for (const e of topology.edges) {
    outgoing[e.from] = (outgoing[e.from] ?? 0) + 1;
    incoming[e.to] = (incoming[e.to] ?? 0) + 1;
  }
  const hasFanOut = Object.values(outgoing).some(c => c > 1);
  const hasFanIn = Object.values(incoming).some(c => c > 1);
  if (hasFanOut && hasFanIn) return 'branching + merging';
  if (hasFanOut) return 'branching';
  if (hasFanIn) return 'merging';
  return 'linear';
}

// ----- internals ------------------------------------------------------------

interface Adjacency {
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
}

function adjacencyFor(topology: Topology): Adjacency {
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const e of topology.edges) {
    (children[e.from] ??= []).push(e.to);
    (parents[e.to] ??= []).push(e.from);
    parents[e.from] = parents[e.from] ?? [];
    children[e.to] = children[e.to] ?? [];
  }
  return { parents, children };
}

/**
 * Every env id touched by this service — union of edges' endpoints + every
 * env where the service has a populated matrix slot. Stable: API env order
 * first, then any edge-only envs appended.
 */
function collectEnvIds(
  topology: Topology,
  service: ServiceDescriptor,
  envs: readonly EnvironmentDescriptor[],
  matrix: MatrixState
): string[] {
  const slot = matrix[service.id] ?? {};
  const set = new Set<string>();
  for (const e of envs) {
    if (slot[e.id] != null) set.add(e.id);
  }
  for (const edge of topology.edges) {
    set.add(edge.from);
    set.add(edge.to);
  }
  // Preserve API env order first, then append any topology-only envs.
  const ordered: string[] = [];
  for (const e of envs) if (set.has(e.id)) ordered.push(e.id);
  for (const id of set) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/**
 * Single-chain fallback for empty-topology services. Orders the service's
 * populated envs by `current.deployed_at` ascending — oldest at root, newest
 * at leaf. Matches the FR-13 empty-topology spec.
 */
function singleChainFromMatrix(
  envIds: readonly string[],
  service: ServiceDescriptor,
  matrix: MatrixState
): readonly string[] {
  const slot = matrix[service.id] ?? {};
  return [...envIds].sort((a, b) => {
    const ta = Date.parse(slot[a]?.current.deployedAt ?? '') || 0;
    const tb = Date.parse(slot[b]?.current.deployedAt ?? '') || 0;
    return ta - tb;
  });
}
