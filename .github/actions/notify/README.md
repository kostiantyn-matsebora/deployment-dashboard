# Deployment Dashboard - `notify` composite action

Reusable GitHub Actions composite action that posts a single deployment
event to the Deployment Dashboard ingest API
(`POST /api/deployments`).

Implements WBS MVP §1.4.2 and "CI/CD Integration" §1.2 of
[`docs/deployment-dashboard-architecture.md`](../../../docs/deployment-dashboard-architecture.md)
(§7 "CI/CD Integration" - GitHub Actions composite action example).

For the full per-tool integration guide (Azure DevOps, Jenkins, GitLab
CI, generic shell) see
[`docs/ci-cd-integration.md`](../../../docs/ci-cd-integration.md).

## Why use this over an inline `curl`

- Input validation (status enum, `run_number` is an integer, required
  fields).
- Deterministic failure surface for QA: documented exit codes and
  `::error::`/`::warning::` log markers.
- Token is re-masked via `::add-mask::` defensively.
- `User-Agent: deployment-dashboard-notify/1.0` so dashboard access
  logs identify the caller.
- Portable across `ubuntu-latest`, `windows-latest`, `macos-latest`,
  and self-hosted runners - pure `pwsh` Core (preinstalled on all
  GitHub-hosted images).

## Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `dashboard_url`      | yes | -                                   | Base URL of the dashboard, no trailing slash. Pass `${{ secrets.DEPLOYMENT_DASHBOARD_URL }}`. |
| `api_token`          | yes | -                                   | Write API key. Pass `${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}`. Re-masked by the action. |
| `deployment_id`      | yes | -                                   | CI/CD-side identifier for this event. Must be non-empty and unique within `(service, deployment_id)` (SAD §7 "POST /api/deployments validation"). See "Recommended `deployment_id` pattern" below. |
| `parent_deployments` | no  | `""`                                | Space- or comma-separated list of upstream `deployment_id` values in the same service. Empty = fall back to correlation-based topology derivation (SAD §7 "Topology Derivation"). |
| `service`            | yes | -                                   | Service identifier (e.g. `service-a`). |
| `environment`        | yes | -                                   | Environment identifier (e.g. `dev`, `qa`, `uat`, `prod`). |
| `version`            | yes | -                                   | Version string (semver, git SHA, build number - any string). |
| `status`             | yes | -                                   | One of `success`, `failure`, `in-progress`. |
| `run_url`            | no  | Derived from `github.*` context     | Link back to the CI run. |
| `run_number`         | no  | `github.run_number`                 | Numeric run identifier. Must parse as integer. |
| `actor`              | no  | `github.actor`                      | User who triggered the run. |
| `fail_on_error`      | no  | `true`                              | When `false`, transport or non-2xx failures emit a `::warning::` but the step succeeds. |

### Recommended `deployment_id` pattern

The dashboard requires `deployment_id` to be unique within a service. Two
patterns work well:

| Pattern | Value |
|---|---|
| Run + attempt (recommended) | `gh-${{ github.run_id }}-${{ github.run_attempt }}` |
| Workflow-supplied guid      | A guid generated upstream and passed in |

- The `gh-` prefix namespaces this CI/CD tool from others (`ado-`,
  `jenkins-`, ...) so the same `(service, deployment_id)` cannot collide
  across CI/CD platforms - see SAD §7 "Other tools".
- Including `github.run_attempt` matters: a workflow re-run shares the
  same `github.run_id`, and the dashboard would reject the retry with
  `409 Conflict` if you used the run id alone.

### `parent_deployments` — when to set it

| Scenario | Set `parent_deployments` to |
|---|---|
| Single-stage deploy (no promotion) | leave empty - correlation fallback handles it |
| Promotion (e.g. promote the dev build to qa) | the dev event's `deployment_id` |
| Fan-in (multiple upstream deployments fed this one) | each upstream `deployment_id`, space- or comma-separated |

Per SAD §7 "POST /api/deployments validation":

- Every entry must reference a `deployment_id` in the **same service**;
  cross-service references are rejected with `400 Bad Request`.
- References to a `deployment_id` that does not yet exist are
  **accepted** and reconciled automatically on the next read.
- A reference set that would form a directed cycle is rejected with
  `400 Bad Request`.

## Outputs

| Name | Description |
|---|---|
| `status_code` | HTTP status returned by the dashboard. Empty string on transport error. |

## Secrets required (per repository / environment)

| Secret | Source spec | Notes |
|---|---|---|
| `DEPLOYMENT_DASHBOARD_URL`   | SAD §7 "CI/CD Integration" - "Secrets required" | Base URL of the dashboard. |
| `DEPLOYMENT_DASHBOARD_TOKEN` | SAD §7 "CI/CD Integration" - "Secrets required" | API key for write access. |

Set these under **Settings -> Secrets and variables -> Actions** in
each repository, or in a shared GitHub Environment with required
reviewers on `prod`.

## Usage - direct reference (recommended)

The same `deployment_id` is reused across the in-progress / success /
failure events for a single deploy - they describe the same deployment
event reaching different states. Only a **new** deployment (a re-run, a
follow-up promotion) gets a new `deployment_id`.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # ... your existing build + deploy steps ...

      - name: Notify Deployment Dashboard - in-progress
        uses: ./.github/actions/notify
        with:
          dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
          api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
          deployment_id: gh-${{ github.run_id }}-${{ github.run_attempt }}
          service:       service-a
          environment:   dev
          version:       ${{ github.sha }}
          status:        in-progress

      - name: Deploy
        id: deploy
        run: ./scripts/deploy.sh

      - name: Notify Deployment Dashboard - success
        if: success()
        uses: ./.github/actions/notify
        with:
          dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
          api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
          deployment_id: gh-${{ github.run_id }}-${{ github.run_attempt }}
          service:       service-a
          environment:   dev
          version:       ${{ github.sha }}
          status:        success

      - name: Notify Deployment Dashboard - failure
        if: failure()
        uses: ./.github/actions/notify
        with:
          dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
          api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
          deployment_id: gh-${{ github.run_id }}-${{ github.run_attempt }}
          service:       service-a
          environment:   dev
          version:       ${{ github.sha }}
          status:        failure
```

### Promotion (linking environments via `parent_deployments`)

Promote the dev build to qa by recording the dev event's `deployment_id`
as the qa event's parent. The dashboard renders the `dev → qa` edge in
the Workflow-rows / Swim-lane views as an explicit (not correlated) link.

```yaml
- name: Notify Deployment Dashboard - qa promotion
  uses: ./.github/actions/notify
  with:
    dashboard_url:      ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
    api_token:          ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
    deployment_id:      gh-${{ github.run_id }}-${{ github.run_attempt }}
    parent_deployments: ${{ needs.deploy-dev.outputs.deployment_id }}
    service:            service-a
    environment:        qa
    version:            ${{ github.sha }}
    status:             success
```

## Usage - external repository reference

From another repository, pin to a tag or commit SHA:

```yaml
- uses: org/deployment-dashboard/.github/actions/notify@v1
  with:
    dashboard_url: ${{ secrets.DEPLOYMENT_DASHBOARD_URL }}
    api_token:     ${{ secrets.DEPLOYMENT_DASHBOARD_TOKEN }}
    deployment_id: gh-${{ github.run_id }}-${{ github.run_attempt }}
    service:       service-a
    environment:   dev
    version:       ${{ github.sha }}
    status:        success
```

Per SAD §7, the canonical published reference is
`org/deployment-dashboard/.github/actions/notify@main` - prefer a
versioned tag over `@main` for stability.

## Failure modes

| Cause                                                                                | Step result with `fail_on_error=true` | Log marker            |
|--------------------------------------------------------------------------------------|---------------------------------------|-----------------------|
| Missing required input (incl. `deployment_id`)                                       | Fail                                  | `::error::`           |
| `status` not in `success`/`failure`/`in-progress`                                    | Fail                                  | `::error::`           |
| `run_number` not an integer                                                          | Fail                                  | `::error::`           |
| `401 Unauthorized` - `X-Api-Key` missing/invalid (FR-10)                             | Fail                                  | `::error::`           |
| `409 Conflict` - duplicate `(service, deployment_id)` (incl. workflow re-run)        | Fail                                  | `::error::`           |
| `400 Bad Request` - `parent_deployments` cross-service ref or directed cycle         | Fail                                  | `::error::`           |
| `422 Unprocessable Entity` - other payload validation failure                        | Fail                                  | `::error::`           |
| Other non-2xx response                                                               | Fail                                  | `::error::`           |
| Transport error (DNS, TLS, timeout)                                                  | Fail                                  | `::error::`           |
| Any of the above with `fail_on_error=false`                                          | Succeed                               | `::warning::`         |

When the dashboard returns a 4xx response, the action prints a human
hint (which validation rule fired) followed by the full response body,
so pipeline authors see *why* the dashboard rejected the payload
without re-running with extra logging.

Notes on the contract-level failures (SAD §7 "POST /api/deployments
validation"):

| HTTP | Meaning | How to recover |
|---|---|---|
| `409` | Duplicate `(service, deployment_id)` | Ensure `deployment_id` is unique per event. For workflow re-runs, include `github.run_attempt`. |
| `400` | `parent_deployments` references a different service | Only reference upstream events in the **same** `service`. |
| `400` | `parent_deployments` would form a directed cycle | Audit the promotion graph for `A → B → A`. |
| `422` | Missing `deployment_id`, or other Data Annotations failure | Action input validation catches missing `deployment_id` first; a 422 from the dashboard usually means a value is malformed (e.g. status, run_number). |

References to a `deployment_id` that has not yet been ingested are
**accepted** (`201 Created`) and reconciled on the next read - this is
not a failure mode. A promotion event can land before its parent event
in event-ordering edge cases without breaking the topology view.

Idempotency: the dashboard rejects duplicate `(service, deployment_id)`
with `409`. A workflow re-run shares `github.run_id` but has a fresh
`github.run_attempt`, so including both fields in `deployment_id` keeps
re-runs distinct.

## Local testing

A `tests/` folder is reserved for the QA agent's Pester suite - see
[`tests/README.md`](tests/README.md) for the test surface this action
commits to.
