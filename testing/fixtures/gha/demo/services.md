# Demo-mode service catalog

Companion to [`README.md`](./README.md). Documents the six demo
services, the five demo environments, the four DAG-edge shapes the
bundle exercises, and which slot demonstrates each shape.

## Services × environments

Six services × five environments = 30 matrix slots. Every slot is
populated within the first ~30 seconds of demo runtime (the initial
tick seeds 29, billing-service/prod arrives in tick 1).

| Service | Workflow shape | `needs:` recovery | Initial state distribution |
|---|---|---|---|
| `web-portal` | `build → deploy` (single intra-run `needs:`) | yes | all 5 envs seeded success |
| `api-gateway` | `test → build → deploy` (single intra-run `needs:`) | yes | dev/uat/staging/prod success; qa flips to failure (failed-with-last) |
| `auth-service` | _(no needs:)_ — adapter falls back to per-env predecessor only | no | dev/qa/staging/prod success; uat in_progress (running) |
| `billing-service` | `lint → test → build → deploy` (multiple `needs:` + chain) | yes | dev/qa/uat/staging success; prod populates in tick 1 |
| `notification-worker` | _(no needs:)_ — adapter falls back to per-env predecessor only | no | all 5 envs seeded success |
| `analytics-pipeline` | `lint → test → build → deploy` (multiple `needs:` + chain) | yes | dev/qa/staging/prod success; uat failure (seeds running-failed in tick 1) |

### Environment column meanings

| Env | Role | Cadence |
|---|---|---|
| `dev` | Lowest gate — fastest churn, all states cycle here | every tick or two |
| `qa` | QA gate — failures land here first | mid-cycle |
| `uat` | User acceptance — slower; mix of states | mid-cycle |
| `staging` | Pre-prod — mostly stable, occasional in_progress | slower |
| `prod` | Highest — mostly success after a tail of in_progress | slowest |

## Workflow YAML shape (per service)

The four `needs:`-recovery services each have a unique workflow YAML
served from `/repos/demo-org/demo-repo/contents/{path}?ref={sha}`.
The adapter parses these to recover intra-run `needs:` edges per
issue #19 / ADR-0007.

### `web-portal` — `.github/workflows/web-portal-deploy.yml`

```yaml
jobs:
  build:
    needs: []      # implicit — no needs key
  deploy:
    needs: [build]
```

DAG edges emitted per deploy: `deploy → build` (intra-run `needs:`) +
per-env predecessor (after the first deploy in the env).

### `api-gateway` — `.github/workflows/api-gateway-release.yml`

```yaml
jobs:
  test:
    needs: []
  build:
    needs: [test]
  deploy:
    needs: [build]
```

The adapter only recovers `needs:` for the **deploy** job (the one
whose `job_id` matches the deployment's status URL). Edges:
`deploy → build` (per the YAML) + per-env predecessor. Other jobs
(`test`, `build`) are not deployments — they exist in the YAML but
don't have their own GHA deployment records.

### `billing-service` — `.github/workflows/billing-service-pipeline.yml`

```yaml
jobs:
  lint:
    needs: []
  test:
    needs: [lint]
  build:
    needs: [lint, test]
  deploy:
    needs: [build]
```

Multiple-needs shape is present in the YAML (build has `[lint,
test]`), even though the deploy job itself only has `needs: [build]`.
The DAG-coverage assertion exercises this YAML's parse path.

### `analytics-pipeline` — `.github/workflows/analytics-pipeline.yml`

Identical chain shape to `billing-service` (`lint → test → build → deploy`
with `build: needs: [lint, test]`). Two services share the multi-needs
chain so the YAML-parse coverage is duplicated — useful for the demo
audience to see two services with rich pipeline topology.

## DAG-edge shape coverage

| Shape | Slot the demo exercises | Why this slot |
|---|---|---|
| Empty `parent_deployments` | `auth-service / dev` first event (`id=10011`) | `auth-service` has no `needs:` — first event in env has no per-env predecessor either |
| Single per-env predecessor only | `notification-worker / prod` after first event (later tick) | No `needs:` recovery (URL omits `/job/{id}`) → adapter falls back to per-env predecessor |
| Single intra-run `needs:` | `web-portal / dev` deploys (e.g. `id=10001`) | `deploy: needs: [build]` in YAML; status URL includes `/job/{run_id*10}` → adapter recovers |
| Multiple `needs:` + per-env mix | `analytics-pipeline / staging` deploys | Build job has `[lint, test]` (multi-needs); deploy chain has per-env predecessors |

## Run-id and job-id encoding

| Surface | Encoding |
|---|---|
| Deployment id | `10000 + global_ord` — monotonically increasing across the bundle (ADR-0004) |
| Workflow run id | `service_prefix * 100000 + global_ord` — leading digit = service prefix so per-service base mappings can regex-route |
| Deploy-job id | `run_id * 10` — encoded in the status URL's `/job/{id}` segment + matched by the jobs-mapping template |
| Non-deploy job ids | `run_id * 10 + (n−idx)` where `n` = job count, `idx` = position — unique per job, irrelevant to recovery because the adapter only looks up by `(run_id, job_id)` for the *deploy* job |
| Service prefix | `web-portal=1`, `api-gateway=2`, `auth-service=3`, `billing-service=4`, `notification-worker=5`, `analytics-pipeline=6` |

For services with `needs_recovery=false` (`auth-service`,
`notification-worker`), the status URL deliberately **omits**
`/job/{id}` — the adapter logs "status URL lacks /job/{id}
segment; skipping intra-run needs edges" and emits per-env
predecessor edges only.

## Box state distribution (initial tick)

| Box state from `local/index/ui-states.yaml` | Initial slots that demonstrate it |
|---|---|
| `success` | `web-portal/*` · `api-gateway/dev,uat,staging,prod` · `auth-service/dev,qa,staging,prod` · `billing-service/dev,qa,uat,staging` · `notification-worker/*` · `analytics-pipeline/dev,qa,staging,prod` |
| `failed-with-last` | `api-gateway/qa` (success then failure in tick 0) |
| `running` | `auth-service/uat` (in_progress, no prior) |
| `running-with-last` | Emerges in tick 1 (e.g. `web-portal/dev`, `api-gateway/dev` flip to in_progress after success) |
| `running-failed` | `analytics-pipeline/uat` after tick 1 adds in_progress on top of the initial failure |
| `running-failed-with-last` | `api-gateway/qa` after tick 2 adds in_progress on top of success → failure (tick 0) |

All 6 of 6 canonical box states appear in the matrix within the
first ~10 seconds (= 2 fetcher polls at 5-second cadence).

## Cross-references

- [`README.md`](./README.md) — bundle layout, scenario walk
  mechanics, priority + templating.
- [`docs/cr/CR-0013-demo-mode-default-installer.md § 3d`](../../../docs/cr/CR-0013-demo-mode-default-installer.md#3d--demo-bundle-content-shape)
  — coverage matrix design-of-record.
- [`local/index/ui-states.yaml`](../../../.agents/ginee/local/index/ui-states.yaml)
  — canonical six-state inventory (the demo covers all 6).
- [`backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/GitHubActionsAdapter.cs`](../../../backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/GitHubActionsAdapter.cs)
  — adapter walks the runs/jobs/contents endpoints in this order.
- [`backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/StatusUrlParser.cs`](../../../backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/StatusUrlParser.cs)
  — status URL parser (drives whether intra-run needs recovery
  triggers).
- [`backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/WorkflowYamlParser.cs`](../../../backend/fetcher/Dashboard.Fetcher/Adapters/GitHubActions/WorkflowYamlParser.cs)
  — workflow YAML `needs:` parser.
