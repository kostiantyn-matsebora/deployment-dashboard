const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

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

/**
 * Topology shapes for the chain generator.
 *
 * linear  — A → B → C → D         (simple chain)
 * fork    — A → B                  (one-to-many fan-out from A)
 *           A → C → D
 * diamond — A → B → D              (fan-out from A, many-to-one merge at D)
 *           A → C → D
 */
type Topology = 'linear' | 'fork' | 'diamond';

// Equal mix of branching topologies, linear kept for variety.
const TOPOLOGY_POOL: Topology[] = [
  'linear', 'fork', 'fork', 'diamond', 'diamond',
];

let _runCounter = 5000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

/**
 * Returns a parent-index map for `n` nodes under the requested topology.
 * parentMap[i] = array of indices j < i that are direct parents of node i.
 * Guarantees topological order: every parent index < child index.
 */
function buildParentMap(n: number, topology: Topology): number[][] {
  if (n < 2) return [[]];

  // Branching topologies require ≥ 3 nodes; fall back for shorter chains.
  const topo: Topology = (topology !== 'linear' && n < 3) ? 'linear' : topology;

  switch (topo) {
    case 'fork':
      // Node 0 forks to nodes 1 and 2.  Each branch continues linearly.
      // n=3: 0→1, 0→2
      // n=4: 0→1→3, 0→2
      // n=5: 0→1→3, 0→2→4
      return Array.from({ length: n }, (_, i) => {
        if (i === 0) return [];
        if (i === 1) return [0];
        if (i === 2) return [0];   // fork: second child of root
        return [i - 2];            // each subsequent node continues 2 steps back,
                                   // alternating between the two branches
      });

    case 'diamond':
      // Nodes 1 and 2 both come from node 0 (fan-out).
      // Node 3 merges nodes 1 and 2 (fan-in / many-to-one).
      // Remaining nodes continue linearly from the merge point.
      // n=3: 0→1→2 with 2 also having 0 as parent (mini fan-in)
      // n=4: 0→1, 0→2, 1+2→3
      // n=5: 0→1, 0→2, 1+2→3, 3→4
      if (n === 3) return [[], [0], [1, 0]];
      return Array.from({ length: n }, (_, i) => {
        if (i === 0) return [];
        if (i === 1) return [0];
        if (i === 2) return [0];
        if (i === 3) return [1, 2]; // merge node: two parents
        return [i - 1];             // tail after merge: linear continuation
      });

    default: // linear
      return Array.from({ length: n }, (_, i) => (i === 0 ? [] : [i - 1]));
  }
}

/**
 * Generates one promotion chain for a single service/run.
 *
 * The chain uses one of three topology shapes (linear / fork / diamond) so
 * the Swimlanes view renders both fan-out (one-to-many) and fan-in
 * (many-to-one / merge) edges.
 *
 * Swimlane invariants upheld:
 *  - All events share `run_number` + `sha`  →  "same run_number" predicate works.
 *  - `parent_deployments` carries valid sibling deployment_ids  →  "explicit parent" works.
 *  - `happened_at` strictly increases from root to children  →  left-to-right time axis correct.
 *  - Only leaf nodes (no children) carry non-success status.
 */
export function generateRandomChain(): Record<string, unknown>[] {
  const run      = ++_runCounter;
  const service  = pick(SERVICES);
  const version  = pick(VERSIONS);
  const actor    = pick(ACTORS);
  const sha      = hex7();
  const topology = pick(TOPOLOGY_POOL);

  // Pick start position and chain length.
  const maxStart = ENV_ORDER.length - 2;                          // 0–3
  const startIdx = Math.floor(Math.random() * (maxStart + 1));
  const maxLen   = ENV_ORDER.length - startIdx;                   // 2–5
  const chainLen = Math.floor(Math.random() * (maxLen - 1)) + 2; // 2..maxLen

  const envs = Array.from(ENV_ORDER).slice(startIdx, startIdx + chainLen);
  const n    = envs.length;

  const parentMap = buildParentMap(n, topology);

  // Stable deployment IDs — env slice is unique within a chain.
  const ids = envs.map(
    (env) => `rnd-${service.slice(0, 6)}-${env.slice(0, 3)}-${run}`,
  );

  // Compute node depth (longest path from root) for happened_at ordering.
  const depth = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (parentMap[i].length > 0) {
      depth[i] = Math.max(...parentMap[i].map(p => depth[p])) + 1;
    }
  }
  const maxDepth = Math.max(...depth);

  // Mark nodes that have at least one child — they must be 'success'.
  const hasChild = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    for (const p of parentMap[i]) hasChild[p] = true;
  }

  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    // Root is oldest; each depth increment is ~20 min more recent.
    const baseMs   = (maxDepth - depth[i]) * 20 * 60_000;
    const jitterMs = Math.floor(Math.random() * 5 * 60_000);

    const isLeaf = !hasChild[i];
    const status = isLeaf
      ? pick(['success', 'success', 'in-progress', 'failure'] as const)
      : 'success';

    events.push({
      deployment_id:      ids[i],
      service,
      environment:        envs[i],
      status,
      happened_at:        new Date(Date.now() - baseMs - jitterMs).toISOString(),
      version,
      actor,
      run_number:         String(run),
      sha,
      parent_deployments: parentMap[i].map(p => ids[p]),
    });
  }

  return events;
}

/**
 * Generates promotion chains until at least `count` events have been produced,
 * then returns all events flattened in chain order (root-first within each chain).
 *
 * Total may slightly exceed `count` (by up to chain-length − 1) because chains
 * are never split — every parent_deployments reference is always complete.
 */
export function generateRandomEvents(count: number): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  while (result.length < count) {
    result.push(...generateRandomChain());
  }
  return result;
}

/**
 * Generates a single random deployment event in DeploymentEventIngest wire shape.
 * No parent_deployments — used by EmitService for periodic one-shot emission.
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
    sha:                hex7(),
    parent_deployments: [],
  };
}
