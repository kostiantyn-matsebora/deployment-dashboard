import { GithubStore, GhDeployment, GhDeploymentStatus, GhWorkflowRun, GhWorkflow, GhEnvironment, GhArtifact } from './github-store';

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

/** Full 5-stage promotion ladder, in order. */
const LADDER: ReadonlyArray<string> = ['dev', 'staging', 'qa', 'preprod', 'prod'];

/**
 * Probability that a chain advances FROM this stage TO the next.
 * dev is always entered (index 0 is irrelevant — every chain starts at dev).
 * Each subsequent stage is reached only with its probability, modeling realistic funnel attrition.
 */
const ADVANCE_PROB: Record<string, number> = {
  dev:     0.85, // probability of advancing dev → staging
  staging: 0.75, // probability of advancing staging → qa
  qa:      0.70, // probability of advancing qa → preprod
  preprod: 0.55, // probability of advancing preprod → prod
};

/** Probability that a stage ends with a `failure` status (applies only to the terminal stage). */
const FAILURE_PROB = 0.15;

/** Trailing window over which chains are spread. */
const WINDOW_DAYS = 14;

const ACTORS  = ['alice', 'bob', 'mreyes', 's.harper', 'jpark', 'release-bot', 'ci-bot'];
const VERSIONS = ['1.0.0', '1.1.0', '2.0.0-rc1', '0.8.4', '3.1.2', '0.42.0', '2.15.0'];
const REFS    = ['refs/heads/main', 'release/1.0', 'feat/auth-refresh', 'fix/timeout'];

/**
 * Intra-stage gap ranges in minutes (time from chain start to each stage's deployment).
 * dev is always at offset 0.
 */
const STAGE_OFFSET_RANGE: Record<string, [number, number]> = {
  dev:     [0,   0],
  staging: [15,  60],
  qa:      [45,  150],
  preprod: [75,  240],
  prod:    [120, 360],
};

let _idCounter = 90_000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

function nextId(): number {
  return ++_idCounter;
}

// ── Workflow YAML builder ─────────────────────────────────────────────────────

/**
 * Generates a workflow YAML with a full dev→staging→qa→preprod→prod needs chain.
 * This ensures F10 (parent_deployments via needs graph) is exercised on all 5 stages.
 */
function buildWorkflowYaml(name: string): string {
  return `name: ${name}
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build

  deploy-dev:
    needs: build
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - run: echo "deploying to dev"

  deploy-staging:
    needs: deploy-dev
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: echo "deploying to staging"

  deploy-qa:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: qa
    steps:
      - run: echo "deploying to qa"

  deploy-preprod:
    needs: deploy-qa
    runs-on: ubuntu-latest
    environment: preprod
    steps:
      - run: echo "deploying to preprod"

  deploy-prod:
    needs: deploy-preprod
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - run: echo "deploying to prod"
`;
}

// ── Random generator ──────────────────────────────────────────────────────────

/**
 * Generates `count` synthetic deployment chains distributed across repos,
 * spreading timestamps over a trailing WINDOW_DAYS window.
 *
 * `count` unit = number of deployment *chains* (one chain = one sha promoted
 * through some or all of dev→staging→qa→preprod→prod with realistic funnel
 * attrition). Each chain produces between 1 and 5 individual deployments.
 * Use count=50 for a lightweight dataset, count=200 for a fuller DORA demo.
 *
 * Each generated service gets:
 *  - A workflow YAML with a full dev→staging→qa→preprod→prod needs chain (F10).
 *  - Multiple chains spread across the past WINDOW_DAYS days, NOT anchored to now.
 *  - Funnel attrition so dev counts > staging > qa > preprod > prod.
 *  - Failure statuses on some terminal stages (non-zero change-failure-rate).
 *  - Varied actors and timestamp spread (heatmap / top-deployers).
 *  - At least one artifact (version.txt, F15).
 */
export class GithubRandomGenerator {
  generate(store: GithubStore, count: number): void {
    // Distribute chains across all SERVICES round-robin.
    // Each service gets at least one run, with extras spread round-robin.
    const effectiveCount = Math.max(count, SERVICES.length);
    const chainsPerService = Math.ceil(effectiveCount / SERVICES.length);

    for (const service of SERVICES) {
      const owner = 'demo-org';
      const repoName = service;
      const repo = store.getOrCreateRepo(owner, repoName);

      // Environments
      for (const envName of LADDER) {
        repo.environments.push({ name: envName } as GhEnvironment);
      }

      // Workflow
      const wfId   = nextId();
      const wfPath = `.github/workflows/deploy-${service}.yml`;
      const wfName = service;
      const wfYaml = buildWorkflowYaml(wfName);

      const workflow: GhWorkflow = { id: wfId, name: wfName, path: wfPath, state: 'active' };
      repo.workflows.push(workflow);

      // Version artifact — one per repo (latest version)
      const version = pick(VERSIONS);

      // Generate chainsPerService chains for this repo
      for (let c = 0; c < chainsPerService; c++) {
        const sha    = hex7();
        const ref    = pick(REFS);
        const actor  = pick(ACTORS);
        const chainVersion = pick(VERSIONS);

        const runId = nextId();
        const run: GhWorkflowRun = { id: runId, name: wfName, path: wfPath, head_sha: sha };
        repo.runs.set(runId, run);
        repo.workflowYaml.set(`${wfPath}::${sha}`, wfYaml);

        const targetUrl = `http://github-emulator:3100/repos/${owner}/${repoName}/actions/runs/${runId}`;

        // Pick a random start time within the trailing WINDOW_DAYS window.
        // Exclude the last hour to avoid "today" anchoring and ensure analytics
        // day-truncated windows (which exclude today) always have data.
        const windowMs   = WINDOW_DAYS * 24 * 60 * 60_000;
        const minAgoMs   = 60 * 60_000; // at least 1 hour in the past
        const chainStartMs = Date.now() - minAgoMs - Math.random() * (windowMs - minAgoMs);

        // Walk the ladder with attrition
        const reachedStages: string[] = ['dev'];
        for (let i = 0; i < LADDER.length - 1; i++) {
          const currentStage = LADDER[i];
          if (Math.random() < ADVANCE_PROB[currentStage]) {
            reachedStages.push(LADDER[i + 1]);
          } else {
            break;
          }
        }

        // Determine if the terminal stage is a failure (some then recovered, some not)
        const terminalIsFailure = Math.random() < FAILURE_PROB;
        // Recovery: if it failed, ~50% chance it was later re-run (the re-run is a separate chain so
        // MTTR can be computed between the failure and the next success on that repo)
        // We still record the failure to ensure non-zero CFR.

        const deployIds: number[] = [];

        reachedStages.forEach((env, idx) => {
          const depId = nextId();
          deployIds.push(depId);

          // Compute this stage's timestamp as chainStart + cumulative stage offset,
          // clamped to now so a late chain-start + large stage offset never drifts past now.
          const [minOff, maxOff] = STAGE_OFFSET_RANGE[env];
          // Spread the offset across the stage range with some randomness
          const offsetMs = randBetween(minOff, maxOff) * 60_000;
          const depCreatedAt = new Date(Math.min(chainStartMs + offsetMs, Date.now())).toISOString();

          const deployment: GhDeployment = {
            id:          depId,
            sha,
            ref,
            environment: env,
            payload:     { version: chainVersion },
            creator:     { login: actor },
            created_at:  depCreatedAt,
          };
          repo.deployments.push(deployment);

          const isTerminal = idx === reachedStages.length - 1;
          // Status is created ~5-20 minutes after deployment creation, clamped to now.
          const statusDelayMs = randBetween(5, 20) * 60_000;
          const statusCreatedAt = new Date(Math.min(chainStartMs + offsetMs + statusDelayMs, Date.now())).toISOString();

          const statuses: GhDeploymentStatus[] = [];

          statuses.push({
            id:         nextId(),
            state:      'in_progress',
            target_url: targetUrl,
            creator:    { login: actor },
            created_at: depCreatedAt,
          });

          if (isTerminal && terminalIsFailure) {
            // Terminal stage fails
            statuses.push({
              id:         nextId(),
              state:      'failure',
              target_url: targetUrl,
              creator:    { login: actor },
              created_at: statusCreatedAt,
            });
          } else {
            // Non-terminal stages always succeed; terminal defaults to success
            statuses.push({
              id:         nextId(),
              state:      'success',
              target_url: targetUrl,
              creator:    { login: actor },
              created_at: statusCreatedAt,
            });
          }

          repo.statuses.set(depId, statuses);
        });

        // Artifact on each run (version.txt, F15)
        const artifact: GhArtifact = {
          id:       nextId(),
          name:     'version.txt',
          expired:  false,
          _content: chainVersion,
        };
        repo.artifacts.set(runId, [artifact]);
      }

      // Ensure at least one artifact exists on the first run (repo-level fallback)
      if (repo.artifacts.size === 0) {
        const firstRunId = repo.runs.keys().next().value;
        if (firstRunId !== undefined) {
          repo.artifacts.set(firstRunId, [{
            id:       nextId(),
            name:     'version.txt',
            expired:  false,
            _content: version,
          }]);
        }
      }
    }
  }

  /**
   * Appends a single new deployment + in_progress→success/failure lifecycle
   * to a random repo in the store.  Used by periodic emission (§6.3).
   * The appended deployment is timestamped at now (real-time incremental event).
   */
  appendRandomEmit(store: GithubStore): void {
    const keys = store.allRepoKeys();
    if (keys.length === 0) return;

    const key   = pick(keys);
    const [owner, repoName] = key.split('/');
    const repo  = store.getOrCreateRepo(owner, repoName);

    if (repo.workflows.length === 0) return;

    const wf     = pick(repo.workflows);
    const env    = repo.environments.length > 0 ? pick(repo.environments).name : 'dev';
    const actor  = pick(ACTORS);
    const sha    = hex7();
    const ref    = pick(REFS);
    const version = pick(VERSIONS);

    // Reuse first matching run for this workflow, or create a new one
    let runId = 0;
    for (const [id, run] of repo.runs) {
      if (run.path === wf.path) { runId = id; break; }
    }
    if (runId === 0) {
      runId = nextId();
      repo.runs.set(runId, { id: runId, name: wf.name, path: wf.path, head_sha: sha });
      repo.workflowYaml.set(`${wf.path}::${sha}`, buildWorkflowYaml(wf.name));
    }

    const depId     = nextId();
    const now       = new Date().toISOString();
    const targetUrl = `http://github-emulator:3100/repos/${owner}/${repoName}/actions/runs/${runId}`;

    const deployment: GhDeployment = {
      id:          depId,
      sha,
      ref,
      environment: env,
      payload:     { version },
      creator:     { login: actor },
      created_at:  now,
    };
    repo.deployments.push(deployment);

    const terminal: GhDeploymentStatus['state'] = pick(['success', 'success', 'failure']);
    repo.statuses.set(depId, [
      { id: nextId(), state: 'in_progress', target_url: targetUrl, creator: { login: actor }, created_at: now },
      { id: nextId(), state: terminal,      target_url: targetUrl, creator: { login: actor }, created_at: new Date().toISOString() },
    ]);
  }
}
