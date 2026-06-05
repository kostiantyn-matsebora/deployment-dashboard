/**
 * In-memory GitHub store — process-local, independent of the dashboard API.
 * All state is reset on service restart.
 */

// ── Domain types (GitHub wire shapes) ────────────────────────────────────────

export interface GhActor {
  login: string;
}

export interface GhDeployment {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  payload: Record<string, unknown> | null;
  creator: GhActor;
  created_at: string; // ISO-8601 UTC
}

export interface GhDeploymentStatus {
  id: number;
  state: 'queued' | 'pending' | 'in_progress' | 'waiting' | 'success' | 'failure' | 'error' | 'inactive';
  target_url: string;
  creator: GhActor;
  created_at: string; // ISO-8601 UTC
}

export interface GhWorkflowRun {
  id: number;
  name: string;
  path: string;
  head_sha: string;
  /** Run conclusion — "success" | "failure" | "cancelled" | "timed_out" | null (in-progress). */
  conclusion?: string | null;
}

export interface GhWorkflow {
  id: number;
  name: string;
  path: string;
  state: 'active' | 'deleted' | 'disabled_fork' | 'disabled_inactivity' | 'disabled_manually';
}

export interface GhEnvironment {
  name: string;
}

export interface GhDeploymentReview {
  /** "approved" | "rejected" */
  state: string;
  user: { login: string };
  submitted_at: string;
}

export interface GhArtifact {
  id: number;
  name: string;
  expired: boolean;
  /** Content stored alongside for zip generation. Not returned in list response. */
  _content: string;
}

// ── Per-repo store shape ──────────────────────────────────────────────────────

export interface RepoStore {
  deployments: GhDeployment[];
  /** Keyed by deployment id */
  statuses: Map<number, GhDeploymentStatus[]>;
  /** Keyed by run_id */
  runs: Map<number, GhWorkflowRun>;
  workflows: GhWorkflow[];
  /** Keyed by "${path}::${ref}" */
  workflowYaml: Map<string, string>;
  environments: GhEnvironment[];
  /** Keyed by run_id */
  artifacts: Map<number, GhArtifact[]>;
  /** Keyed by deployment id — reviewer decisions for environment gates */
  reviews: Map<number, GhDeploymentReview[]>;
}

// ── Store singleton ───────────────────────────────────────────────────────────

export class GithubStore {
  /** Keyed by "${owner}/${repo}" */
  private repos = new Map<string, RepoStore>();
  private _dataset: string = '';
  private _seededAt: string | null = null;

  getRepo(owner: string, repo: string): RepoStore | undefined {
    return this.repos.get(`${owner}/${repo}`);
  }

  getOrCreateRepo(owner: string, repo: string): RepoStore {
    const key = `${owner}/${repo}`;
    if (!this.repos.has(key)) {
      this.repos.set(key, {
        deployments: [],
        statuses: new Map(),
        runs: new Map(),
        workflows: [],
        workflowYaml: new Map(),
        environments: [],
        artifacts: new Map(),
        reviews: new Map(),
      });
    }
    return this.repos.get(key)!;
  }

  clear(): void {
    this.repos.clear();
    this._dataset = '';
    this._seededAt = null;
  }

  setDataset(name: string): void {
    this._dataset = name;
    this._seededAt = new Date().toISOString();
  }

  get dataset(): string { return this._dataset; }
  get seededAt(): string | null { return this._seededAt; }

  summary(): {
    dataset: string;
    repos: number;
    deployments: number;
    statuses: number;
    workflows: number;
    environments: number;
  } {
    let deployments = 0;
    let statuses = 0;
    let workflows = 0;
    let environments = 0;

    for (const r of this.repos.values()) {
      deployments += r.deployments.length;
      for (const s of r.statuses.values()) statuses += s.length;
      workflows   += r.workflows.length;
      environments += r.environments.length;
    }

    return {
      dataset:      this._dataset,
      repos:        this.repos.size,
      deployments,
      statuses,
      workflows,
      environments,
    };
  }

  allRepoKeys(): string[] {
    return [...this.repos.keys()];
  }
}

/** Process-global singleton (NestJS provides it via DI). */
export const globalStore = new GithubStore();
