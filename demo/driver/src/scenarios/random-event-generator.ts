const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

const ENVIRONMENTS = ['dev', 'staging', 'qa', 'preprod', 'prod'];

// Weighted pool — realistic distribution (more success than failure)
const STATUS_POOL: Array<'in-progress' | 'success' | 'failure'> = [
  'success', 'success', 'success', 'success', 'success',
  'in-progress', 'in-progress',
  'failure', 'failure',
  'success',
];

const ACTORS = [
  'alice', 'bob', 'charlie', 'mreyes', 's.harper',
  'jpark', 'l.osman', 'release-bot', 'ci-bot',
];

const VERSIONS = [
  '1.0.0', '1.1.0', '1.2.3', '2.0.0-rc1',
  '0.8.4', '3.1.2', '0.42.0', '2.15.0',
];

let _runCounter = 5000;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

/**
 * Generates a single random deployment event in DeploymentEventIngest wire shape.
 * happened_at is a random point within the past hour.
 */
export function generateRandomEvent(): Record<string, unknown> {
  const run         = ++_runCounter;
  const service     = pick(SERVICES);
  const environment = pick(ENVIRONMENTS);
  const status      = pick(STATUS_POOL);
  const elapsedMs   = Math.floor(Math.random() * 60 * 60 * 1_000); // 0–60 min ago

  return {
    deployment_id: `rnd-${service.slice(0, 6)}-${environment.slice(0, 3)}-${run}`,
    service,
    environment,
    status,
    happened_at:  new Date(Date.now() - elapsedMs).toISOString(),
    version:      pick(VERSIONS),
    actor:        pick(ACTORS),
    run_number:   String(run),
    sha:          hex7(),
  };
}

/**
 * Generates `count` random deployment events.
 */
export function generateRandomEvents(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, generateRandomEvent);
}
