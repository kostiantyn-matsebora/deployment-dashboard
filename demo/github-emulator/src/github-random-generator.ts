import { GithubStore, GhDeployment, GhDeploymentStatus, GhWorkflowRun, GhWorkflow, GhEnvironment, GhArtifact } from './github-store';

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICES = [
  'auth-bff', 'billing-webhook', 'catalog-edge', 'data-pipeline',
  'ledger-projector', 'notification-worker', 'order-svc',
  'payments-api', 'platform-proxy', 'search-indexer',
];

const ENVS    = ['dev', 'staging', 'qa', 'preprod', 'prod'];
const ACTORS  = ['alice', 'bob', 'mreyes', 's.harper', 'jpark', 'release-bot', 'ci-bot'];
const VERSIONS = ['1.0.0', '1.1.0', '2.0.0-rc1', '0.8.4', '3.1.2', '0.42.0', '2.15.0'];
const REFS    = ['refs/heads/main', 'release/1.0', 'feat/auth-refresh', 'fix/timeout'];

let _idCounter = 90_000;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function hex7(): string {
  return Math.floor(Math.random() * 0xfffffff).toString(16).padStart(7, '0');
}

function nextId(): number {
  return ++_idCounter;
}

// ── Workflow YAML builder ─────────────────────────────────────────────────────

/**
 * Generates a workflow YAML with a dev→staging→prod deployment-job needs chain.
 * This ensures F10 (parent_deployments via needs graph) can be exercised on
 * random data.
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

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - run: echo "deploying to prod"
`;
}

// ── Random generator ──────────────────────────────────────────────────────────

/**
 * Generates `count` synthetic repos with deployments, statuses, runs,
 * workflow YAML, environments, and artifacts.
 *
 * Each generated service gets:
 *  - A workflow YAML with a dev→staging→prod needs chain (F10).
 *  - At least one deployment with a full lifecycle (in_progress→success/failure).
 *  - At least one artifact (version.txt, F15).
 */
export class GithubRandomGenerator {
  generate(store: GithubStore, count: number): void {
    const serviceSlice = SERVICES.slice(0, Math.min(count, SERVICES.length));

    for (const service of serviceSlice) {
      const owner = 'demo-org';
      const repoName = service;
      const repo = store.getOrCreateRepo(owner, repoName);

      // Environments
      for (const envName of ENVS) {
        repo.environments.push({ name: envName } as GhEnvironment);
      }

      // Workflow
      const wfId   = nextId();
      const wfPath = `.github/workflows/deploy-${service}.yml`;
      const wfName = service;
      const wfYaml = buildWorkflowYaml(wfName);

      const workflow: GhWorkflow = { id: wfId, name: wfName, path: wfPath, state: 'active' };
      repo.workflows.push(workflow);

      // One run with a dev→staging→prod chain
      const runId  = nextId();
      const sha    = hex7();
      const ref    = pick(REFS);
      const version = pick(VERSIONS);
      const actor  = pick(ACTORS);

      const run: GhWorkflowRun = { id: runId, name: wfName, path: wfPath, head_sha: sha };
      repo.runs.set(runId, run);

      // Store YAML keyed by path::sha
      repo.workflowYaml.set(`${wfPath}::${sha}`, wfYaml);

      // Also store with each env's deployment sha (all same sha for this run)
      const targetUrl = `http://github-emulator:3100/repos/${owner}/${repoName}/actions/runs/${runId}`;

      const chainEnvs: Array<'dev' | 'staging' | 'prod'> = ['dev', 'staging', 'prod'];
      const deployIds: number[] = [];

      chainEnvs.forEach((env, idx) => {
        const depId = nextId();
        deployIds.push(depId);

        const minutesAgo = (chainEnvs.length - idx) * 30;
        const createdAt  = new Date(Date.now() - minutesAgo * 60_000).toISOString();

        const deployment: GhDeployment = {
          id:          depId,
          sha,
          ref,
          environment: env,
          payload:     { version },
          creator:     { login: actor },
          created_at:  createdAt,
        };
        repo.deployments.push(deployment);

        const isLast = idx === chainEnvs.length - 1;
        const statusCreatedAt = new Date(Date.now() - (minutesAgo - 5) * 60_000).toISOString();

        // in_progress + terminal status for last env; just success for others
        const statuses: GhDeploymentStatus[] = [];

        if (isLast) {
          statuses.push({
            id:         nextId(),
            state:      'in_progress',
            target_url: targetUrl,
            creator:    { login: actor },
            created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
          });
          statuses.push({
            id:         nextId(),
            state:      pick(['success', 'success', 'failure']),
            target_url: targetUrl,
            creator:    { login: actor },
            created_at: statusCreatedAt,
          });
        } else {
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

      // Artifact on the run (version.txt, F15)
      const artifact: GhArtifact = {
        id:       nextId(),
        name:     'version.txt',
        expired:  false,
        _content: version,
      };
      repo.artifacts.set(runId, [artifact]);
    }
  }

  /**
   * Appends a single new deployment + in_progress→success/failure lifecycle
   * to a random repo in the store.  Used by periodic emission (§6.3).
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
