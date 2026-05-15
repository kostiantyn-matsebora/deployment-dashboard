// Shared environment helpers for every Playwright spec. Resolves the
// Read / Write API base URLs and the API key from environment variables
// set by `testing/e2e/run-tests.ps1`, which loads them from a
// declarative JSON config file under `testing/config/` (default
// `testing/config/local.json`).
//
// Per the project's "Engineering principles" (CLAUDE.md): configuration
// is declarative and never lives as literals here. If the env vars are
// missing the spec run should fail fast with a clear message rather
// than silently target the wrong stack — invoke the suite through
// `testing/e2e/run-tests.ps1` (or set the env vars yourself).
//
// Owner: qa-engineer.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is not set. Run the suite via 'pwsh -NoProfile -File testing/e2e/run-tests.ps1' ` +
        `or export ${name} explicitly. See testing/config/README.md.`,
    );
  }
  return value;
}

export const READ_BASE_URL: string = required('DASHBOARD_READ_BASE_URL');
export const WRITE_BASE_URL: string = required('DASHBOARD_WRITE_BASE_URL');
export const API_KEY: string = required('DASHBOARD_API_KEY');

/** Suffix used to make per-test payloads unique across re-runs. */
export function runSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * Build a POST /api/deployments body. Centralises the wire-contract
 * required fields (SAD §7 "POST /api/deployments request body"):
 * `deployment_id` is REQUIRED (Phase 2); missing or empty → 422.
 *
 * Callers pass the slot-identifying fields; the helper fills in a
 * unique `deployment_id` per call so re-runs of a single test never
 * collide on the (service, deployment_id) uniqueness key.
 */
export function buildDeploymentPayload(input: {
  service: string;
  environment: string;
  version: string;
  status: 'success' | 'failure' | 'in-progress';
  run_url: string;
  run_number: number;
  actor?: string;
  /** Optional explicit override. Defaults to a uuid-ish unique value. */
  deployment_id?: string;
  /** Optional parent_deployments list (SAD §5 Topology Derivation). */
  parent_deployments?: string[];
  /**
   * FR-05 / SAD §10 Decision #10 — optional source-identifier fields.
   * Both are nullable strings on the wire. Pass an explicit `null` to
   * forward `null`; omit the property to forward absence. The server
   * treats absence and `null` as equivalent.
   */
  ref?: string | null;
  sha?: string | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    deployment_id: input.deployment_id ?? `e2e-${runSuffix()}`,
    service: input.service,
    environment: input.environment,
    version: input.version,
    status: input.status,
    run_url: input.run_url,
    run_number: input.run_number,
    actor: input.actor ?? 'qa.bot',
  };
  if (input.parent_deployments && input.parent_deployments.length > 0) {
    body.parent_deployments = input.parent_deployments;
  }
  // hasOwnProperty check so callers can pass explicit `null` to forward
  // a JSON null (distinct from "omit the property"). Per SAD §7 the
  // server treats both as equivalent on read, but the write surface
  // accepts both shapes by contract.
  if (Object.prototype.hasOwnProperty.call(input, 'ref')) {
    body.ref = input.ref ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'sha')) {
    body.sha = input.sha ?? null;
  }
  return body;
}
