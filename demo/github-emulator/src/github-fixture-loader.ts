import * as fs from 'fs';
import * as path from 'path';
import { GithubStore, GhDeployment, GhDeploymentStatus, GhWorkflowRun, GhWorkflow, GhEnvironment, GhArtifact, GhDeploymentReview } from './github-store';

/** Raw shape of a fixture JSON file under demo/data/github/. */
interface GithubFixtureFile {
  repos: RepoFixture[];
}

interface RepoFixture {
  owner: string;
  repo:  string;
  workflows:    WorkflowFixture[];
  environments: string[];
  deployments:  DeploymentFixture[];
}

interface WorkflowFixture {
  id:   number;
  name: string;
  path: string;
  yaml: string;
}

interface ReviewFixture {
  state:        string;
  user:         string;
  submitted_at: string;
}

interface DeploymentFixture {
  id:             number;
  sha:            string;
  ref:            string;
  environment:    string;
  payload:        Record<string, unknown> | null;
  creator:        string;
  created_at:     string;
  run_id:         number;
  /** Conclusion to record on the associated workflow run — e.g. "cancelled". */
  run_conclusion?: string | null;
  statuses:       StatusFixture[];
  artifact?:      ArtifactFixture;
  /** Reviewer decisions for environment gate deployments. */
  reviews?:       ReviewFixture[];
}

interface StatusFixture {
  id:         number;
  state:      'queued' | 'pending' | 'in_progress' | 'waiting' | 'success' | 'failure' | 'error' | 'inactive';
  created_at: string;
}

interface ArtifactFixture {
  id:      number;
  name:    string;
  content: string;
}

/**
 * Return true when relative-date shifting is enabled.
 *
 * Reads SEED_RELATIVE_DATES from the process environment at call time.
 * Anything other than "false", "0", or "no" (case-insensitive) is treated as
 * ON (including unset). OFF is used by the api-tests compose overlay so that
 * fixed fixture dates pair correctly with the pinned FETCHER_NOW clock.
 */
function isRelativeShiftEnabled(): boolean {
  const v = (process.env['SEED_RELATIVE_DATES'] ?? '').trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

/**
 * Compute the skew (ms) needed to anchor the newest timestamp in the fixture to
 * approximately now. Called once per loadFixture invocation so re-seeding via
 * POST /_github/seed always anchors to the current Date.now().
 *
 * Considers dep.created_at, every status s.created_at, and every review
 * r.submitted_at across all repos in the file.
 */
function computeSkewMs(fixture: GithubFixtureFile): number {
  let maxMs = -Infinity;

  for (const repoFixture of fixture.repos) {
    for (const dep of repoFixture.deployments) {
      const depMs = new Date(dep.created_at).getTime();
      if (depMs > maxMs) maxMs = depMs;

      for (const s of dep.statuses) {
        const sMs = new Date(s.created_at).getTime();
        if (sMs > maxMs) maxMs = sMs;
      }

      if (dep.reviews) {
        for (const r of dep.reviews) {
          const rMs = new Date(r.submitted_at).getTime();
          if (rMs > maxMs) maxMs = rMs;
        }
      }
    }
  }

  if (!isFinite(maxMs)) return 0;
  return Date.now() - maxMs;
}

/** Shift an ISO-8601 timestamp string by skewMs milliseconds. */
function shiftTs(isoStr: string, skewMs: number): string {
  return new Date(new Date(isoStr).getTime() + skewMs).toISOString();
}

export class GithubFixtureLoader {
  load(store: GithubStore, scenariosDir: string): void {
    const githubDir = path.resolve(scenariosDir, 'github');

    if (!fs.existsSync(githubDir)) {
      console.warn(`[github-emulator] fixture dir not found: ${githubDir}`);
      return;
    }

    const files = fs.readdirSync(githubDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(githubDir, file);
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as GithubFixtureFile;
        this.loadFixture(store, raw);
      } catch (err) {
        console.warn(`[github-emulator] skipping ${file}: parse error`, err);
      }
    }
  }

  private loadFixture(store: GithubStore, fixture: GithubFixtureFile): void {
    // Pre-pass: compute skew so the newest fixture event lands at approximately now.
    // Computed fresh each call — re-seeding via POST /_github/seed re-anchors to the
    // current Date.now() without memoisation side-effects.
    // When SEED_RELATIVE_DATES=false/0/no shifting is disabled: ts() is the identity
    // function so raw fixture strings reach the store verbatim. Required by the
    // api-tests overlay which pairs fixed fixture dates with a pinned FETCHER_NOW clock
    // for deterministic scenarios.
    const relativeShift = isRelativeShiftEnabled();
    const skewMs = relativeShift ? computeSkewMs(fixture) : 0;
    const ts = relativeShift ? (isoStr: string) => shiftTs(isoStr, skewMs) : (isoStr: string) => isoStr;

    for (const repoFixture of fixture.repos) {
      const repo = store.getOrCreateRepo(repoFixture.owner, repoFixture.repo);

      // Environments
      for (const envName of repoFixture.environments) {
        const env: GhEnvironment = { name: envName };
        repo.environments.push(env);
      }

      // Workflows + YAML
      for (const wf of repoFixture.workflows) {
        const workflow: GhWorkflow = {
          id:    wf.id,
          name:  wf.name,
          path:  wf.path,
          state: 'active',
        };
        repo.workflows.push(workflow);
      }

      // Deployments, statuses, runs, workflow YAML, artifacts, reviews
      for (const dep of repoFixture.deployments) {
        const deployment: GhDeployment = {
          id:          dep.id,
          sha:         dep.sha,
          ref:         dep.ref,
          environment: dep.environment,
          payload:     dep.payload,
          creator:     { login: dep.creator },
          created_at:  ts(dep.created_at),
        };
        repo.deployments.push(deployment);

        // Map statuses — target_url embeds the run_id
        const statuses: GhDeploymentStatus[] = dep.statuses.map(s => ({
          id:         s.id,
          state:      s.state,
          target_url: `http://github-emulator:3100/repos/${repoFixture.owner}/${repoFixture.repo}/actions/runs/${dep.run_id}`,
          creator:    { login: dep.creator },
          created_at: ts(s.created_at),
        }));
        repo.statuses.set(dep.id, statuses);

        // Workflow run — match by workflow id first, fall back to first workflow.
        // If a run_conclusion is provided, it overrides the existing conclusion on the run.
        if (!repo.runs.has(dep.run_id)) {
          const matchingWf = repoFixture.workflows.find(wf => wf.id === dep.run_id)
            ?? repoFixture.workflows[0];

          if (matchingWf) {
            const run: GhWorkflowRun = {
              id:         dep.run_id,
              name:       matchingWf.name,
              path:       matchingWf.path,
              head_sha:   dep.sha,
              conclusion: dep.run_conclusion ?? null,
            };
            repo.runs.set(dep.run_id, run);

            // Store workflow YAML keyed by path::sha
            const yamlKey = `${matchingWf.path}::${dep.sha}`;
            if (!repo.workflowYaml.has(yamlKey)) {
              repo.workflowYaml.set(yamlKey, matchingWf.yaml);
            }
          }
        } else if (dep.run_conclusion != null) {
          // Patch conclusion on a previously-registered run (same run_id, multiple deployments)
          const existing = repo.runs.get(dep.run_id)!;
          repo.runs.set(dep.run_id, { ...existing, conclusion: dep.run_conclusion });
        }

        // Artifact
        if (dep.artifact) {
          const artifact: GhArtifact = {
            id:       dep.artifact.id,
            name:     dep.artifact.name,
            expired:  false,
            _content: dep.artifact.content,
          };
          const existing = repo.artifacts.get(dep.run_id) ?? [];
          existing.push(artifact);
          repo.artifacts.set(dep.run_id, existing);
        }

        // Reviews — reviewer decisions for environment gate deployments
        if (dep.reviews && dep.reviews.length > 0) {
          const reviews: GhDeploymentReview[] = dep.reviews.map(r => ({
            state:        r.state,
            user:         { login: r.user },
            submitted_at: ts(r.submitted_at),
          }));
          repo.reviews.set(dep.id, reviews);
        }
      }
    }
  }
}
