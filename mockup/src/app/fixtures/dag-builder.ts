// DAG builder — ADR-0012 §5.
//
// Consumes service.deployments[] and returns { nodes: DdGraphNode[], edges: DdGraphEdge[] }.
// Each node carries `rank: envColumnIndex(deployment.env.id)` for dagre rank pinning.
//
// Two derivation paths:
//   1. Parent-explicit — any deployment has non-empty parentDeployments[].
//   2. Correlation-key fallback — no deployment has parentDeployments; pick most-
//      discriminating key from sha → version → ref priority.
//
// Direction-of-edges:
//   Parent-explicit: parent → child (explicit relation).
//   Correlated: earlier → later by timestamp (universal resolver).

import type { Deployment, EnvironmentDescriptor } from './index';
import type { Node as NgxNode, Edge as NgxEdge } from '@swimlane/ngx-graph';

// ---- Types ------------------------------------------------------------------

export interface DdGraphNodeData {
  readonly deploymentId: string;
  readonly envId: string;
  readonly envLabel: string;
  readonly version: string;
  readonly status: string;
  readonly timestamp: string;
  // rank is mirrored here for downstream consumers even though it lives on DdGraphNode
  readonly rank: number;
}

export interface DdGraphNode extends NgxNode {
  readonly rank: number;
  readonly data: DdGraphNodeData;
}

export interface DdGraphEdge extends NgxEdge {
  readonly data: {
    readonly source: 'explicit' | 'correlated';
  };
}

export interface DagResult {
  readonly nodes: DdGraphNode[];
  readonly edges: DdGraphEdge[];
}

// ---- Canonical env order (ADR-0012 §4) -------------------------------------

export const ENV_ORDER = ['dev', 'qa', 'qahotfix', 'uat', 'prod'] as const;

export function envColumnIndex(envId: string): number {
  const idx = ENV_ORDER.indexOf(envId as typeof ENV_ORDER[number]);
  return idx >= 0 ? idx : ENV_ORDER.length; // unknown envs go last
}

// ---- DAG builder -----------------------------------------------------------

export function buildDag(
  serviceId: string,
  deployments: readonly Deployment[]
): DagResult {
  if (deployments.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Build nodes for all deployments.
  const nodes: DdGraphNode[] = deployments.map(d => {
    const rank = envColumnIndex(d.env.id);
    return {
      id: `${serviceId}::${d.env.id}::${d.id}`,
      label: d.env.label,
      dimension: { width: 160, height: 120 },  // default; overridden by renderer per viewMode
      rank,
      data: {
        deploymentId: d.id,
        envId: d.env.id,
        envLabel: d.env.label,
        version: d.version,
        status: d.status,
        timestamp: d.timestamp,
        rank
      }
    };
  });

  // Map deployment.id → node.id for edge construction.
  const deploymentIdToNodeId = new Map<string, string>(
    deployments.map(d => [d.id, `${serviceId}::${d.env.id}::${d.id}`])
  );

  // Determine which path to use.
  const hasParents = deployments.some(
    d => d.parentDeployments && d.parentDeployments.length > 0
  );

  let edges: DdGraphEdge[];

  if (hasParents) {
    // Path 1: parent-explicit.
    edges = buildParentExplicitEdges(serviceId, deployments, deploymentIdToNodeId);
  } else {
    // Path 2: correlation-key fallback.
    edges = buildCorrelatedEdges(serviceId, deployments, deploymentIdToNodeId);
  }

  return { nodes, edges };
}

// ---- Parent-explicit edge derivation ---------------------------------------

function buildParentExplicitEdges(
  serviceId: string,
  deployments: readonly Deployment[],
  deploymentIdToNodeId: Map<string, string>
): DdGraphEdge[] {
  const edges: DdGraphEdge[] = [];
  let edgeIdx = 0;

  for (const child of deployments) {
    if (!child.parentDeployments || child.parentDeployments.length === 0) continue;
    for (const parentId of child.parentDeployments) {
      const sourceNodeId = deploymentIdToNodeId.get(parentId);
      const targetNodeId = deploymentIdToNodeId.get(child.id);
      if (!sourceNodeId || !targetNodeId) continue;
      edges.push({
        id: `edge-${serviceId}-explicit-${edgeIdx++}`,
        source: sourceNodeId,
        target: targetNodeId,
        data: { source: 'explicit' }
      });
    }
  }

  return edges;
}

// ---- Correlation-key fallback edge derivation ------------------------------
//
// Priority: sha → version → ref (first key for which not-all-deployments-share-one-value).
// Within each correlation group: sort by timestamp ascending; emit consecutive edges.
// Direction: earlier → later.

function pickCorrelationKey(deployments: readonly Deployment[]): 'sha' | 'version' | 'ref' {
  const keys: Array<'sha' | 'version' | 'ref'> = ['sha', 'version', 'ref'];
  for (const key of keys) {
    const values = new Set(deployments.map(d => d[key] ?? null));
    // "Not all share one value" = set size > 1 (at least two distinct values).
    if (values.size > 1) return key;
  }
  // All keys are uniform — fall back to version (arbitrary; single-group, single path).
  return 'version';
}

function buildCorrelatedEdges(
  serviceId: string,
  deployments: readonly Deployment[],
  deploymentIdToNodeId: Map<string, string>
): DdGraphEdge[] {
  const corrKey = pickCorrelationKey(deployments);

  // Group deployments by correlation key value.
  const groups = new Map<string | null, Deployment[]>();
  for (const d of deployments) {
    const val = d[corrKey] ?? null;
    if (!groups.has(val)) groups.set(val, []);
    groups.get(val)!.push(d);
  }

  const edges: DdGraphEdge[] = [];
  let edgeIdx = 0;

  for (const group of groups.values()) {
    // Sort by timestamp ascending (earlier → later).
    const sorted = [...group].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Emit consecutive edges within group.
    for (let i = 0; i < sorted.length - 1; i++) {
      const sourceNodeId = deploymentIdToNodeId.get(sorted[i].id);
      const targetNodeId = deploymentIdToNodeId.get(sorted[i + 1].id);
      if (!sourceNodeId || !targetNodeId) continue;
      edges.push({
        id: `edge-${serviceId}-correlated-${edgeIdx++}`,
        source: sourceNodeId,
        target: targetNodeId,
        data: { source: 'correlated' }
      });
    }
  }

  return edges;
}

// ---- Source-to-sink path enumerator ----------------------------------------
//
// DFS from all source nodes (zero in-degree) to all sink nodes (zero out-degree).
// Each path = ordered array of node IDs.
// Returns paths sorted by max(deployment.timestamp) along path — most recent first.
// Cap: returns at most maxPaths paths; overflowCount = total - maxPaths.

export interface PathEnumerationResult {
  readonly paths: readonly (readonly string[])[];  // node IDs per path
  readonly overflowCount: number;                  // paths beyond cap (for "+N more" chip)
  readonly totalCount: number;                     // total enumerated before cap
}

export function enumeratePaths(
  nodes: readonly DdGraphNode[],
  edges: readonly DdGraphEdge[],
  maxPaths = 8
): PathEnumerationResult {
  if (nodes.length === 0) {
    return { paths: [], overflowCount: 0, totalCount: 0 };
  }

  // Build adjacency + in-degree maps.
  const children = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    if (!children.has(node.id)) children.set(node.id, []);
    if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
  }
  for (const edge of edges) {
    children.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // Sources = nodes with in-degree 0.
  const sources = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);

  // DFS from each source.
  const allPaths: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    const next = [...path, nodeId];
    const kids = children.get(nodeId) ?? [];
    if (kids.length === 0) {
      allPaths.push(next);
      return;
    }
    for (const child of kids) {
      dfs(child, next);
    }
  }

  for (const src of sources) {
    dfs(src, []);
  }

  // Single-node services with no edges: each node is its own path (source=sink).
  if (allPaths.length === 0 && nodes.length > 0) {
    for (const node of nodes) {
      allPaths.push([node.id]);
    }
  }

  // Build node timestamp lookup.
  const nodeTimestamp = new Map<string, number>(
    nodes.map(n => [n.id, new Date(n.data.timestamp).getTime()])
  );

  // Rank paths by max timestamp along path (most-recent-updated first).
  const rankedPaths = allPaths
    .map(path => ({
      path,
      maxTs: Math.max(...path.map(id => nodeTimestamp.get(id) ?? 0))
    }))
    .sort((a, b) => b.maxTs - a.maxTs)
    .map(r => r.path);

  const totalCount = rankedPaths.length;
  const capped = rankedPaths.slice(0, maxPaths);
  const overflowCount = Math.max(0, totalCount - maxPaths);

  return { paths: capped, overflowCount, totalCount };
}

// ---- Collapsed path selector -----------------------------------------------
//
// Returns the single best path for collapsed state = first in ranked list
// (highest max timestamp).

export function collapsedPath(
  nodes: readonly DdGraphNode[],
  edges: readonly DdGraphEdge[]
): readonly string[] {
  const result = enumeratePaths(nodes, edges, 1);
  return result.paths[0] ?? nodes.map(n => n.id);
}
