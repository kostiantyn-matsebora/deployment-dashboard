const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

/**
 * Canonical promotion order.  Chains always advance left-to-right so that
 * happened_at and parent_deployments form a valid DAG the Swimlanes view can render.
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

let _runCounter = 5000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

/**
 * Generates a single random deployment event in DeploymentEventIngest wire shape.
 * happened_at is a random point within the past hour.
 * No parent_deployments — used by EmitService for periodic one-shot emission.
 */
export function generateRandomEvent(): Record<string, unknown> {
  const run         = ++_runCounter;
  const service     = pick(SERVICES);
  const environment = pick(ENV_ORDER);
  const elapsedMs   = Math.floor(Math.random() * 60 * 60 * 1_000); // 0–60 min ago

  return {
    deployment_id:      `rnd-${service.slice(0, 6)}-${environment.slice(0, 3)}-${run}`,
    service,
    environment,
    status:             pick(['success', 'success', 'success', 'in-progress', 'failure'] as const),
    happened_at:        new Date(Date.now() - elapsedMs).toISOString(),
    version:            pick(VERSIONS),
    actor:              pick(ACTORS),
    run_number:         String(run),
    sha:                hex7(),
    parent_deployments: [],
  };
}

/**
 * Generates one promotion chain: a single service promoted across 2–5 consecutive
 * environments in ENV_ORDER order.
 *
 * Properties that make the Swimlanes DAG renderable:
 * - All events share `run_number` and `sha` (same pipeline run).
 * - Each event except the first carries `parent_deployments: [<prev_deployment_id>]`.
 * - `happened_at` decreases toward the tip (dev is oldest, prod tip is most recent).
 * - Only the tip event can be `in-progress` / `failure`; earlier hops are `success`.
 */
export function generateRandomChain(): Record<string, unknown>[] {
  const run     = ++_runCounter;
  const service = pick(SERVICES);
  const version = pick(VERSIONS);
  const actor   = pick(ACTORS);
  const sha     = hex7();

  // Start anywhere except the last env so there is always room for ≥ 2 hops.
  const maxStart = ENV_ORDER.length - 2;                          // 0–3
  const startIdx = Math.floor(Math.random() * (maxStart + 1));
  const maxLen   = ENV_ORDER.length - startIdx;                   // 2–5
  const chainLen = Math.floor(Math.random() * (maxLen - 1)) + 2; // 2..maxLen

  const envs: string[] = Array.from(ENV_ORDER).slice(startIdx, startIdx + chainLen);
  const events: Record<string, unknown>[] = [];
  let prevId: string | null = null;

  for (let i = 0; i < envs.length; i++) {
    const env          = envs[i];
    const deploymentId = `rnd-${service.slice(0, 6)}-${env.slice(0, 3)}-${run}`;

    // Earlier hops happened further in the past; jitter ±0–5 min per hop.
    const baseMs   = (envs.length - i) * 20 * 60_000;
    const jitterMs = Math.floor(Math.random() * 5 * 60_000);

    // Only the tip can be non-success (it may still be running or have failed).
    const isLast = i === envs.length - 1;
    const status = isLast
      ? pick(['success', 'success', 'in-progress', 'failure'] as const)
      : 'success';

    events.push({
      deployment_id:      deploymentId,
      service,
      environment:        env,
      status,
      happened_at:        new Date(Date.now() - baseMs - jitterMs).toISOString(),
      version,
      actor,
      run_number:         String(run),
      sha,
      parent_deployments: prevId ? [prevId] : [],
    });

    prevId = deploymentId;
  }

  return events;
}

/**
 * Generates promotion chains until at least `count` events have been produced,
 * then returns all events flattened in chain order (root-first within each chain).
 *
 * Total events may slightly exceed `count` (by up to chain-length − 1) because
 * chains are never split mid-way — every chain's parent_deployments links are
 * complete when posted to the write API.
 */
export function generateRandomEvents(count: number): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  while (result.length < count) {
    result.push(...generateRandomChain());
  }
  return result;
}
