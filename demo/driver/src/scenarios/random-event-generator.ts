const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

/** Total number of available services. */
export const SERVICE_COUNT = SERVICES.length;

/**
 * Canonical promotion order.  All topologies advance left-to-right so that
 * happened_at and parent_deployments form a valid swimlane DAG.
 */
const ENV_ORDER = ['dev', 'staging', 'qa', 'preprod', 'prod'] as const;

const ACTORS = [
  'alice', 'bob', 'charlie', 'mreyes', 's.harper',
  'jpark', 'l.osman', 'release-bot', 'ci-bot',
];

const VERSIONS = [
  '1.0.0', '1.1.0', '1.2.3', '2.0.0-rc1',
  '0.8.4', '3.1.2', '0.42.0', '2.15.0',
];

const REFS = [
  'refs/heads/main', 'refs/heads/develop',
  'release/1.0', 'release/2.0',
  'feat/auth-refresh', 'feat/retry-logic',
  'fix/timeout-handling', 'chore/deps-update',
];

/**
 * Topology shapes for the chain generator.
 *
 * linear  — A → B → C → D
 * fork    — A → B            one-to-many: A fans out to two independent branches
 *           A → C → D
 * diamond — A → B → D        fan-out from A, many-to-one merge at D
 *           A → C → D
 */
type Topology = 'linear' | 'fork' | 'diamond';

// Favour branching topologies so the swimlane shows interesting graphs.
const BRANCHING_TOPOLOGIES: readonly Topology[] = ['fork', 'fork', 'diamond', 'diamond', 'fork'];

let _runCounter = 5000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

/**
 * Returns a parent-index map for `n` nodes under the requested topology.
 * parentMap[i] = indices j < i that are direct parents of node i.
 * Topological order is guaranteed (every parent index < child index).
 */
function buildParentMap(n: number, topology: Topology): number[][] {
  if (n < 2) return [[]];
  const topo: Topology = (topology !== 'linear' && n < 3) ? 'linear' : topology;

  switch (topo) {
    case 'fork':
      // Node 0 forks to nodes 1 and 2; each branch continues linearly.
      // n=3: 0→1, 0→2
      // n=4: 0→1→3, 0→2
      // n=5: 0→1→3, 0→2→4
      return Array.from({ length: n }, (_, i) => {
        if (i === 0) return [];
        if (i === 1) return [0];
        if (i === 2) return [0];  // second child of root — the fork
        return [i - 2];           // alternates between the two branches
      });

    case 'diamond':
      // Nodes 1 and 2 both come from node 0 (fan-out).
      // Node 3 merges 1 and 2 (fan-in / many-to-one).
      // n=3: mini fan-in — 0→1→2, 0→2 as well
      // n=4: 0→1, 0→2, 1+2→3
      // n=5: 0→1, 0→2, 1+2→3, 3→4
      if (n === 3) return [[], [0], [1, 0]];
      return Array.from({ length: n }, (_, i) => {
        if (i === 0) return [];
        if (i === 1) return [0];
        if (i === 2) return [0];
        if (i === 3) return [1, 2];  // merge node: two parents
        return [i - 1];               // tail continues linearly
      });

    default: // linear
      return Array.from({ length: n }, (_, i) => (i === 0 ? [] : [i - 1]));
  }
}

/**
 * Core chain builder.  Generates one promotion run for a specific service
 * using the given topology.
 *
 * Swimlane invariants upheld:
 *  - All events share `run_number` + `sha`  →  "same run_number" predicate works.
 *  - `parent_deployments` carries valid sibling deployment_ids  →  "explicit parent" works.
 *  - `happened_at` strictly increases root → children  →  left-to-right time axis correct.
 *  - Only leaf nodes (no children) carry non-success status.
 */
function buildChain(service: string, topology: Topology): Record<string, unknown>[] {
  const run     = ++_runCounter;
  const version = pick(VERSIONS);
  const actor   = pick(ACTORS);
  const sha     = hex7();
  const ref     = pick(REFS);
  const runUrl  = `https://ci.example/runs/${run}`;

  const maxStart = ENV_ORDER.length - 2;
  const startIdx = Math.floor(Math.random() * (maxStart + 1));
  const maxLen   = ENV_ORDER.length - startIdx;
  const chainLen = Math.floor(Math.random() * (maxLen - 1)) + 2;

  const envs      = Array.from(ENV_ORDER).slice(startIdx, startIdx + chainLen);
  const n         = envs.length;
  const parentMap = buildParentMap(n, topology);
  const ids       = envs.map((env) => `rnd-${service.slice(0, 6)}-${env.slice(0, 3)}-${run}`);

  const depth = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (parentMap[i].length > 0) {
      depth[i] = Math.max(...parentMap[i].map(p => depth[p])) + 1;
    }
  }
  const maxDepth = Math.max(...depth);

  const hasChild = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (const p of parentMap[i]) hasChild[p] = true;
  }

  return envs.map((env, i) => {
    const baseMs   = (maxDepth - depth[i]) * 20 * 60_000;
    const jitterMs = Math.floor(Math.random() * 5 * 60_000);
    const isLeaf   = !hasChild[i];

    return {
      deployment_id:      ids[i],
      service,
      environment:        env,
      status:             isLeaf
        ? pick(['success', 'success', 'in-progress', 'failure'] as const)
        : 'success',
      happened_at:        new Date(Date.now() - baseMs - jitterMs).toISOString(),
      version,
      actor,
      run_number:         String(run),
      run_url:            runUrl,
      ref,
      sha,
      parent_deployments: parentMap[i].map(p => ids[p]),
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates one promotion chain for a RANDOM service (random topology).
 * Used by tests and EmitService is NOT affected (it uses generateRandomEvent).
 */
export function generateRandomChain(): Record<string, unknown>[] {
  return buildChain(pick(SERVICES), pick(BRANCHING_TOPOLOGIES));
}

/**
 * Generates `count` service scenarios — **one per service**, cycling through
 * the full service list if count > SERVICE_COUNT.
 *
 * WHY one-per-service matters for the swimlane:
 *   The swimlane derives edges from parent_deployments of the CURRENT event
 *   per (service, env) slot.  If the same service gets two chains in one batch,
 *   the later chain's events become the new "current" slots — orphaning the
 *   earlier chain's parent_deployments links.  By emitting exactly one chain per
 *   service per batch-pass, every (service, env) slot has exactly one event, so
 *   parent_deployments always points at the same-run events that ARE current.
 *
 * count = number of service scenarios (default 10 = all services).
 */
export function generateRandomEvents(count: number): Record<string, unknown>[] {
  if (count <= 0) return [];

  const result: Record<string, unknown>[] = [];
  // Shuffle once; cycle through the same order on each pass so that within
  // a pass each service appears exactly once.
  const shuffled = [...SERVICES].sort(() => Math.random() - 0.5);

  for (let i = 0; i < count; i++) {
    const service  = shuffled[i % shuffled.length];
    const topology = pick(BRANCHING_TOPOLOGIES);
    result.push(...buildChain(service, topology));
  }

  return result;
}

/**
 * Generates a single standalone event (no parent_deployments).
 * Used by EmitService for periodic one-shot emission — individual live events
 * do not need DAG links.
 */
export function generateRandomEvent(): Record<string, unknown> {
  const run       = ++_runCounter;
  const service   = pick(SERVICES);
  const env       = pick(ENV_ORDER);
  const elapsedMs = Math.floor(Math.random() * 60 * 60 * 1_000);

  return {
    deployment_id:      `rnd-${service.slice(0, 6)}-${env.slice(0, 3)}-${run}`,
    service,
    environment:        env,
    status:             pick(['success', 'success', 'success', 'in-progress', 'failure'] as const),
    happened_at:        new Date(Date.now() - elapsedMs).toISOString(),
    version:            pick(VERSIONS),
    actor:              pick(ACTORS),
    run_number:         String(run),
    run_url:            `https://ci.example/runs/${run}`,
    ref:                pick(REFS),
    sha:                hex7(),
    parent_deployments: [],
  };
}
