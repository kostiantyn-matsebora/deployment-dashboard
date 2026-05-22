---
title: "Integration Tests (cross-stack)"
nav_order: 12
---

# Integration Tests — Deployment Dashboard

Operational guide for the cross-stack runtime-verification surface introduced by [CR-0012](./cr/CR-0012-integration-test-substrate.md). Substrate: a `mock-gha` WireMock.Net service emulating `api.github.com`, an `integration` compose profile, the `testing/integration/` xUnit suite, and `.github/workflows/integration.yml`. The same fixture root co-locates the demo-mode mapping bundle for follow-up demo-mode wire-up.

## 1. Purpose + audience

- **Purpose.** Verify the inbound write path end-to-end: `Dashboard.Fetcher` → mock GHA → fetcher poll → `POST /api/deployments` via gateway → Postgres → NOTIFY/LISTEN → SSE. Asserts FR-06 (wire shape), NFR-03 (≤ 5 s live updates), NFR-05 (stateless replica restart), and the ADR-0004 cursor contract.
- **Audience.**
  - **Test authors** — engineers adding new scenarios (`testing/integration/`) or new mappings (`testing/fixtures/gha/mappings/`).
  - **Mapping authors** — engineers extending the mock-gha surface for new fetcher behaviour.
  - **Operators** — running the suite locally via `dev_env/start.ps1 -Integration` or reading CI failures.

## 2. Two-doc context — three CI/CD axes

This doc is the third axis in the project's CI/CD operational surface:

| Doc | Axis | Direction |
|---|---|---|
| [`docs/ci-cd-pipelines.md`](./ci-cd-pipelines.md) | Outbound | This repo's own components built + pushed to GHCR |
| [`docs/ci-cd-integration.md`](./ci-cd-integration.md) | Inbound | External adopters posting deployment events into this dashboard |
| `docs/integration-tests.md` (this doc) | Cross-stack runtime verification | Internal — fetcher's pull-mode path verified against a deterministic upstream |

The three are not duplicates — they sit at orthogonal points on the wire. Outbound is build-and-ship; inbound is the wire contract external pipelines call; this doc is what proves the wire contract works when the dashboard itself is the caller (via fetcher pull-mode).

## 3. Stack topology under the `integration` profile

When the `integration` compose profile is active, the stack adds one container (`mock-gha`) on top of the standard local-dev stack.

| Service | DNS name | Container port | Host-mapped port (integration profile only) | Owner |
|---|---|---|---|---|
| `mock-gha` | `mock-gha` | `8080` (mock surface) + `8080` (admin API; same port, distinct paths) | `8080` → host `<configurable>` for admin API access from the runner | `devops-engineer` (service defn) + `qa-engineer` (mappings) |
| `fetcher` | `fetcher` | n/a (worker) | n/a | existing — `GHA_API_BASE_URL` re-pointed to `http://mock-gha:8080` |
| `api`, `gateway`, `db`, `pgadmin` | unchanged | unchanged | unchanged | existing |

**Admin-API surface — `POST /__admin/mappings/import`, `POST /__admin/mappings/reset`, `GET /__admin/requests`** (subset listed in § 5).

**Admin port publishing rule — strict.** The host-mapped admin port is published to the host **only** under the `integration` compose profile. The `release-install` posture (`install/docker-compose.release.yml` consumed by `install/install.ps1` / `install.sh`) **never** publishes the admin port — NFR-04 is preserved in production. Test-time admin access is opt-in via `-Integration` / the CI workflow only.

**Profile gating.**

| Surface | Profile | Effect |
|---|---|---|
| `mock-gha` service definition | always present in compose YAML | inert without profile activation |
| `integration` | bound to `mock-gha` + integration env overrides | starts `mock-gha`; sets `GHA_API_BASE_URL=http://mock-gha:8080`; sets `FETCHER_POLL_INTERVAL_SECONDS=1` |
| `demo` (future) | bound to `mock-gha` + demo env overrides | mounts `testing/fixtures/gha/demo/` instead of per-scenario bundles; consumed by follow-up demo-mode issue |

## 4. WireMock mapping authoring conventions

> **Owned by `qa-engineer`** — Phase 4 dispatch fills this section with the project's per-mapping conventions. SA-locked invariants below.

SA-locked invariants:

- **One file per `(method, URL pattern)` for base mappings.** Filename prefix orders priority — earlier prefix wins on URL ambiguity. Convention: `NN-<method>-<endpoint-slug>.json` (e.g. `10-get-deployments.json`, `20-get-deployment-statuses.json`).
- **Per-scenario overrides live under `testing/fixtures/gha/scenarios/<state-id>/`.** Loaded on scenario activation; reset between scenarios via `POST /__admin/mappings/reset` (§ 5).
- **Rate-limit headers required on every successful response.** Mappings MUST include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers so the fetcher's rate-limit observation path (CR-0011) is exercised under integration.
- **Regex-friendly URL patterns.** Use WireMock URL-pattern syntax for variable path segments (`/repos/[^/]+/[^/]+/deployments`) so one base mapping handles multiple `owner/repo` fixture sources.
- **No hand-coded JSON in test code.** All response bodies live in `testing/fixtures/gha/` — `qa-engineer` owns the mapping corpus, test code references it by path.

> **`qa-engineer` Phase 4 handoff:** fill in concrete per-mapping conventions (priority numbering scheme, response-body templating choices, stateful-mapping patterns for cursor-evolving responses) before the runner suite lands.

## 5. Scenario activation via admin API

> **Owned by `qa-engineer`** — Phase 4 dispatch fills this section with concrete scenario-loader code paths.

SA-locked invariants:

- **Scenario activation is admin-API-driven**, not file-mount-driven. The test runner POSTs the scenario bundle to `POST /__admin/mappings/import` at scenario start; resets via `POST /__admin/mappings/reset` between scenarios.
- **The three admin endpoints the runner uses:**

  | Method | Path | Purpose |
  |---|---|---|
  | `POST` | `/__admin/mappings/import` | Load a scenario's mapping bundle into the running WireMock instance |
  | `POST` | `/__admin/mappings/reset` | Clear all mappings; restore base mappings; called between scenarios |
  | `GET` | `/__admin/requests` | Inspect requests the fetcher made during the scenario — used for negative assertions (e.g. "fetcher did NOT call workflow-contents during this scenario") |

- **Admin-API base URL is per-target config** — see § 8 + `testing/config/README.md`. Runner reads `mockGhaAdminBaseUrl` from the active target config; never hard-codes a URL.

> **`qa-engineer` Phase 4 handoff:** document the runner's scenario-loader helper (which class / method, signature, error semantics on admin-API failure) before the runner suite lands.

## 6. Mock-gha endpoint coverage matrix vs CR-0009 § 3d

Re-pasted verbatim from the `qa-engineer` Phase 2 design — single source of truth for the mock-gha surface area:

| Method | URL pattern | Source-line | Notes |
|---|---|---|---|
| GET | `repos/{owner}/{repo}/deployments?per_page={N}` | `GitHubActionsAdapter.cs:105` | Newest-first list; cursor watermark = `max(id)`; rate-limit headers parsed here |
| GET | `repos/{owner}/{repo}/deployments/{id}/statuses?per_page=1` | `:366` | Adapter takes `statuses[0]`; `state` → lifecycle |
| GET | `repos/{owner}/{repo}/actions/runs/{run_id}` | `:454` | For needs-recovery only — silent-degrade contract |
| GET | `repos/{owner}/{repo}/actions/runs/{run_id}/jobs` | `:479` | Same |
| GET | `repos/{owner}/{repo}/contents/{path}?ref={head_sha}` | `:508` | Base64-encoded workflow YAML; same silent-degrade contract |

**Coverage rule.** Every endpoint above MUST have a base mapping under `testing/fixtures/gha/mappings/`. Scenario bundles MAY override any of these for state-specific behaviour. Per-CR-0009 § 3d MVP scope is the IN-list — adapters introduced by future CRs add their own endpoint rows to this matrix.

## 7. CI invocation — `.github/workflows/integration.yml`

> **Owned by `devops-engineer`** — Phase 4 dispatch fills this section with the workflow YAML shape, triggers, path filters, and stack-lifecycle steps.

SA-locked invariants:

- **Triggers.** PR + push to `main`. Path filters scope the workflow to `backend/fetcher/**`, `backend/fetcher-host/**`, `backend/api/**`, `backend/shared/**`, `gateway/**`, `testing/integration/**`, `testing/fixtures/gha/**`, and the workflow file itself.
- **Severity — non-blocking watching-week, then blocking.** Mirrors CR-0010 Open trade-off (ii). The workflow lands as non-required; branch-protection promotion to required gates on one calendar week of green runs (operator-driven; tracked as a follow-up in `docs/WBS.md`).
- **Compose floor precondition.** First job step MUST verify `docker compose >= 2.20` (the integration profile uses `depends_on: required: false`, a 2.20+ feature). Workflow fails fast with a clear error message if the runner's compose is older.
- **Stack lifecycle.** Bring up with `integration` profile → run runner via `pwsh -NoProfile -File testing/integration/run-tests.ps1` → always tear down (`docker compose down -v`) including on failure paths.
- **Artefacts on failure.** Compose logs + WireMock `GET /__admin/requests` dump + runner trx output uploaded as a single artefact bundle named `integration-failure-<run>-<attempt>`.

> **`devops-engineer` Phase 4 handoff:** fill in concrete workflow YAML, the exact compose-floor check command, the path-filter list, and the artefact-bundle step.

## 8. Local-dev `-Integration` switch

> **Owned by `devops-engineer`** — Phase 4 dispatch fills this section with the switch's PowerShell signature + precedence vs other switches (e.g. `-Fetcher`).

SA-locked invariants:

- **Mirrors the `-Fetcher` precedent** from issue #5 — same shape (PowerShell switch param on `dev_env/start.ps1`), same precondition pattern (fail fast on missing prerequisites with a red error + exit 1).
- **Implies `-Fetcher`.** `-Integration` cannot run without the fetcher container — the switch implies fetcher activation; specifying both is redundant but not an error.
- **Sets the `integration` compose profile.** No other side effect — the profile-gating contract (§ 3) handles every behavioural change.
- **Precondition.** Verifies `docker compose >= 2.20` locally (same floor as the CI workflow).
- **Reuses the existing local-dev `API_TOKEN`** (`local-dev-token-not-for-production`) for `DEPLOYMENT_DASHBOARD_TOKEN`. No new secret to configure.

> **`devops-engineer` Phase 4 handoff:** fill in the param signature, the precondition check command, and the interaction with `-Fetcher` / `-Demo` / any other existing switches.

## 9. Six canonical box-state inventory

Source of truth: `local/index/ui-states.yaml`. Each integration scenario drives **exactly one** canonical box state via mock-gha scripted responses, then asserts the resulting matrix box renders that state.

| state-id | Box state | Scenario driver — mock-gha returns |
|---|---|---|
| `success` | Last deployment succeeded | One terminal-success deployment for `(service, environment)`, no in-progress |
| `running-with-last` | Deploying now; previous terminal was success | In-progress deployment + earlier terminal-success on the same `(service, environment)` |
| `running-failed-with-last` | Deploying now; previous terminal was failure; older success exists | In-progress + most-recent-terminal-failure + earlier terminal-success |
| `failed-with-last` | Last deployment failed; older success exists | One terminal-failure + earlier terminal-success on the same `(service, environment)` |
| `running` | Deploying now; no prior successful deployment | Single in-progress deployment, no terminal history |
| `running-failed` | Deploying now; previous terminal was failure; no successful history | In-progress + most-recent-terminal-failure, no earlier success |

**Plus two cross-cutting scenarios under `testing/fixtures/gha/scenarios/_cross-cutting/`:**

| Scenario | Asserts | Driver |
|---|---|---|
| `replica-restart` | NFR-05 — stateless backend, no event loss across replica restart | mid-fetch `docker compose restart api` + assert resumed fetch reaches Read-side echo |
| `cursor-contract` | ADR-0004 — opaque cursor; second fetch returns only new runs | scripted mock-gha returns new runs only when cursor watermark > previous max(id) |

**Per-scenario assertions (every scenario, including cross-cutting):**

1. **FR-06 wire shape** — read the persisted event via `GET /api/deployments/{service}/{environment}/history` (Read-side echo); assert DTO matches the documented shape (`deployment_id`, `service`, `environment`, `version`, `status`, `run_url`, `run_number`, `actor`, optional `parent_deployments` / `ref` / `sha` / `progress_reporter`).
2. **NFR-03 latency** — assert the event is visible on `GET /api/deployments` within 5 s of the mock-gha response (poll interval `1` + processing budget).
3. **SSE fan-out** — one slot-update event on `GET /api/stream` per scenario event (no missed events; no duplicate events).

**FR-06 assertion seam — Read-side echo, not write-API-via-WireMock.** Asserting through the Read API proves the wire is lossless end-to-end (HTTP shape → DB persistence → DTO mapping → JSON response). Asserting at the fetcher's POST surface would require either a WireMock-shaped write API (double-mocking) or interposing on the fetcher's internal HTTP client (couples the test to the fetcher's implementation, not to the contract). Read-side echo is the contract surface.

## 10. Demo-bundle co-location story

> **AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint.**

The demo-mode mapping bundle is authored under `testing/fixtures/gha/demo/` as part of CR-0012, but no current entrypoint consumes it. The follow-up demo-mode issue will:

- Wire the `demo` compose profile to mount `testing/fixtures/gha/demo/` into `mock-gha` instead of the per-scenario test bundles.
- Add a `-Demo` switch to `install/install.ps1` / `install.sh` that activates the `demo` profile on the release-install stack (separate from `dev_env/start.ps1 -Integration`).
- Verify the demo bundle drives realistic multi-service × multi-environment behaviour over time (long-running script vs. integration suite's short per-scenario runs).

**Why co-locate now.** Authoring the demo bundle alongside the test fixtures keeps a single mock-gha surface — one mapping format, one admin API, one image. Bifurcating the mock surface (test vs. demo) would defeat the substrate's design rationale (CR-0012 § 3a). The bundle's `testing/fixtures/gha/demo/README.md` carries the same verbatim disclaimer as this section header so consumers reading the corpus from the filesystem know the wire-up status.

## Cross-references

- [CR-0012](./cr/CR-0012-integration-test-substrate.md) — design-of-record for the substrate (this doc is its operational guide).
- [CR-0009](./cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md) § 3d — adapter endpoint inventory (the surface this doc's § 6 mirrors).
- [CR-0010](./cr/CR-0010-component-ci-pipeline.md) Open trade-off (ii) — non-blocking-watching-week → blocking promotion pattern this doc's § 7 mirrors.
- [CR-0011](./cr/CR-0011-fetcher-rate-limit-governance.md) — rate-limit observation exercised by the mock's required rate-limit response headers (§ 4 SA-locked invariant).
- [ADR-0004](./adr/ADR-0004-opaque-per-progress-reporter-cursor.md) — cursor contract verified by `_cross-cutting/cursor-contract`.
- [ADR-0010](./adr/ADR-0010-release-install-merge-override.md) — release-install canonical compose; the `integration` profile layers on top via the same merge-override mechanic.
- `local/index/ui-states.yaml` — canonical six-state inventory; § 9 mirrors its `state-id` rows.
- `docs/ci-cd-pipelines.md` — outbound axis.
- `docs/ci-cd-integration.md` — inbound axis.
- `testing/config/README.md` — `integration.json` schema for the runner.
- GitHub issue [#10](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/10) — the trigger.
