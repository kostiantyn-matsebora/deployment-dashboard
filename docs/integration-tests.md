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
| `mock-gha` | `mock-gha` | `80` (mock surface + admin API on same port, distinct paths — WireMock.Net default for the `sheyenrath/wiremock.net:2.4.0` image) | `18080` (host) → `80` (container); admin-API access for the runner | `devops-engineer` (service defn) + `qa-engineer` (mappings) |
| `fetcher` | `fetcher` | n/a (worker) | n/a | existing — `GHA_API_BASE_URL` re-pointed to `http://mock-gha:80` |
| `api`, `gateway`, `db`, `pgadmin` | unchanged | unchanged | unchanged | existing |

**Admin-API surface — `POST /__admin/mappings/import`, `POST /__admin/mappings/reset`, `GET /__admin/requests`** (subset listed in § 5).

**Admin port publishing rule — strict.** The host-mapped admin port is published to the host **only** under the `integration` compose profile. The `release-install` posture (`install/docker-compose.release.yml` consumed by `install/install.ps1` / `install.sh`) **never** publishes the admin port — NFR-04 is preserved in production. Test-time admin access is opt-in via `-Integration` / the CI workflow only.

**Profile gating.**

| Surface | Profile | Effect |
|---|---|---|
| `mock-gha` service definition | always present in compose YAML | inert without profile activation |
| `integration` | bound to `mock-gha` + integration env overrides | starts `mock-gha`; sets `GHA_API_BASE_URL=http://mock-gha:80`; sets `FETCHER_POLL_INTERVAL_SECONDS=1` |
| `demo` (future) | bound to `mock-gha` + demo env overrides | mounts `testing/fixtures/gha/demo/` instead of per-scenario bundles; consumed by follow-up demo-mode issue |

## 4. WireMock mapping authoring conventions

> **Owned by `qa-engineer`** — Phase 4 dispatch fills this section with the project's per-mapping conventions. SA-locked invariants below.

SA-locked invariants:

- **One file per `(method, URL pattern)` for base mappings.** Filename prefix orders priority — earlier prefix wins on URL ambiguity. Convention: `NN-<method>-<endpoint-slug>.json` (e.g. `10-get-deployments.json`, `20-get-deployment-statuses.json`).
- **Per-scenario overrides live under `testing/fixtures/gha/scenarios/<state-id>/`.** Loaded on scenario activation; reset between scenarios via `POST /__admin/mappings/reset` (§ 5).
- **Rate-limit headers required on every successful response.** Mappings MUST include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers so the fetcher's rate-limit observation path (CR-0011) is exercised under integration.
- **Regex-friendly URL patterns.** Use WireMock URL-pattern syntax for variable path segments (`/repos/[^/]+/[^/]+/deployments`) so one base mapping handles multiple `owner/repo` fixture sources.
- **No hand-coded JSON in test code.** All response bodies live in `testing/fixtures/gha/` — `qa-engineer` owns the mapping corpus, test code references it by path.

Concrete per-mapping conventions (qa-engineer-owned, mirrors [`testing/fixtures/gha/README.md`](../testing/fixtures/gha/README.md)):

- **Filename prefix convention** — two-digit numeric prefix orders effective priority within a directory. `00-`–`09-` catch-alls (lowest); `10-`–`19-` per-endpoint base mappings; `20-`–`29-` per-scenario list overrides; `30-`–`39-` per-deployment status overrides; `40-`–`49-` needs-recovery (`actions/runs/*`, `contents/*`). Keep the numeric prefix synced with the `"Priority"` JSON field (lower = higher precedence).
- **Priority numbering — locked**.

  | `"Priority"` value | Meaning |
  |---|---|
  | `1`–`9` | Per-scenario per-deployment-status mappings — highest precedence. |
  | `10`–`19` | Per-scenario list-deployments mappings. |
  | `20`–`29` | Per-scenario needs-recovery mappings. |
  | `100` | Base mappings (the `mappings/` directory). |
  | `999` | Catch-alls — lowest precedence (e.g. `00-default-404-unknown-endpoint.json`). |

- **WireMock.Net JSON shape**. Requests use PascalCase properties (`Method` / `Methods`, `Url`, `Path`, `Headers`, `Params`). The upstream Java WireMock `request: { method, urlPattern }` shape is NOT compatible — see [WireMock.Net Mappings wiki](https://github.com/WireMock-Net/WireMock.Net/wiki/Mappings).
- **Regex matchers go through the `Matchers` array** — `"Path": { "Matchers": [{ "Name": "RegexMatcher", "Pattern": "..." }] }` — not via a bare `urlPattern` key. Use `WildcardMatcher` for literal-with-`*` patterns, `RegexMatcher` for proper regex.
- **Response body inlined as `BodyAsJson`** (object or array). Do NOT mix `BodyAsJson` and `BodyAsString` on the same mapping.
- **Rate-limit headers required on every successful response** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. The fetcher's CR-0011 observation path parses these on every 2xx; missing headers leave usage gauges stale.
- **No hand-coded JSON inside C# test code**. Mapping bodies live under `testing/fixtures/gha/` only; tests reference scenarios by directory name (`fixture.LoadScenarioAsync("<state-id>")`).
- **Stateful (cursor-evolving) responses use per-tick subdirectories**, not WireMock's `"Scenario"` + `"WhenStateIs"`.
- **Pattern:** `scenarios/_cross-cutting/<scenario>/tick-1/`, `tick-2/`, … . Between ticks the runner calls `ResetMappingsAsync` + `LoadScenarioAsync("<scenario>/tick-N")`. See [`Adr0004CursorContractTests`](../testing/integration/Dashboard.Integration.Tests/Adr0004CursorContractTests.cs).

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

Scenario-loader code paths (qa-engineer-owned):

- **Loader class.** [`Dashboard.Integration.Tests.MockGhaClient`](../testing/integration/Dashboard.Integration.Tests/MockGhaClient.cs) — admin-API client; owned by the per-test [`ScenarioFixture`](../testing/integration/Dashboard.Integration.Tests/ScenarioFixture.cs). One client per test class via xUnit `IClassFixture<ScenarioFixture>`.
- **Surface discovery.** First call lazily issues `GET /__admin/` + `GET /__admin/mappings` to verify reachability + capture diagnostics for failing runs. Cached for the rest of the test process.
- **Method signatures.**

  | Method | Signature | Purpose |
  |---|---|---|
  | `DiscoverAdminSurfaceAsync` | `Task DiscoverAdminSurfaceAsync(CancellationToken)` | Lazy reachability probe + path-capability detection. |
  | `LoadScenarioAsync` | `Task LoadScenarioAsync(string scenarioName, CancellationToken)` | Reads every `*.json` under `testing/fixtures/gha/scenarios/{scenarioName}/`; posts as a JSON array via the bulk-import path. |
  | `ResetMappingsAsync` | `Task ResetMappingsAsync(CancellationToken)` | Drops every loaded mapping. Tries `POST /__admin/mappings/reset` then falls back to `DELETE /__admin/mappings` on 404/405. |
  | `GetRecordedRequestsAsync` | `Task<JsonDocument> GetRecordedRequestsAsync(CancellationToken)` | Raw `GET /__admin/requests` array for negative assertions. |
  | `ClearRecordedRequestsAsync` | `Task ClearRecordedRequestsAsync(CancellationToken)` | `DELETE /__admin/requests` — pristine log per scenario. |

- **WireMock.Net admin-route variance — strict reality check.** WireMock.Net's admin surface differs from upstream Java WireMock. `MockGhaClient` is robust to the variance via two fallback paths:

  | First-choice path | Fallback path | Reason |
  |---|---|---|
  | `POST /__admin/mappings/import` | `POST /__admin/mappings` (array body) | WireMock.Net may not implement the `/import` route; `POST /__admin/mappings` accepts either a single object or an array — same semantics. |
  | `POST /__admin/mappings/reset` | `DELETE /__admin/mappings` | WireMock.Net's canonical reset is `DELETE /__admin/mappings`; the `/reset` route exists only in some builds. |

  On a 404 / 405 from the first-choice path, the client transparently falls back, caches the choice, and proceeds. The chosen path is implicit in the test output through the eventual mapping count (no extra log line).

- **Error semantics.** Any non-2xx, non-404-on-fallback admin response throws `InvalidOperationException` with the response status, the request URL, and up to 512 chars of the response body. The exception bubbles into the xUnit test result so the failure pinpoints the admin-API call rather than masquerading as a generic "no event arrived" timeout downstream.
- **Scenario reset cadence.** Per-test (`ScenarioFixture.InitializeAsync` resets + clears + TRUNCATEs deployments via `seed.ps1 -CleanOnly`). The fixture is bound via `IClassFixture<ScenarioFixture>` so the reset fires once per test class — single test method per class keeps it 1:1.

> **Admin-API base URL is per-target config.** The runner exports `MOCK_GHA_ADMIN_BASE_URL` from `integration.json#mockGhaAdminBaseUrl`; `TestEnvironment.MockGhaAdminBaseUrl` reads it. Test code never hard-codes a URL.

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

Workflow file: [`.github/workflows/integration.yml`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/.github/workflows/integration.yml).

SA-locked invariants (recap):

- **Triggers.** PR + push to `main` + tag `v*` + `workflow_dispatch`. Path-filtered.
- **Severity — non-blocking watching-week, then blocking.** Mirrors CR-0010 Open trade-off (ii).
- **Compose floor precondition.** First job step verifies `docker compose >= 2.20`.
- **Stack lifecycle.** `integration` profile → `testing/integration/run-tests.ps1` → unconditional tear-down.
- **Artefacts on failure.** Compose logs + WireMock `GET /__admin/requests` dump.

### 7.1 Triggers + concurrency

| Event | Effect |
|---|---|
| `push` to `main` | Run on paths matching the filter. |
| `push` of tag `v*` | Run on paths matching the filter. |
| `pull_request` to `main` | Run on paths matching the filter. |
| `workflow_dispatch` | Manual run from any ref. |

`concurrency: ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` — mirrors the four component workflows ([`docs/ci-cd-pipelines.md § 3`](./ci-cd-pipelines.md#3-triggers)). Distinct main-branch commits never cancel each other; a fresh push to a PR cancels the still-running CI for the previous commit.

### 7.2 Path filter

The workflow runs when any of these change:

| Surface | Paths |
|---|---|
| Fetcher host + libs | `backend/fetcher/**`, `backend/fetcher-host/**` |
| API host + endpoint groups | `backend/api/**`, `backend/write-api/**`, `backend/read-api/**` |
| Shared libs + solution file | `backend/shared/**`, `backend/Dashboard.sln` |
| Gateway | `gateway/**` |
| Integration runner + fixtures | `testing/integration/**`, `testing/fixtures/gha/**`, `testing/config/integration.json` |
| Compose substrate | `install/docker-compose.release.yml`, `dev_env/docker-compose.local.yml`, `dev_env/start.ps1`, `dev_env/stop.ps1` |
| The workflow itself | `.github/workflows/integration.yml` |

Frontend-only PRs (`frontend/**`) intentionally do not trigger this workflow — the integration suite covers the write path, not the SPA render path. Mockup-visual + frontend unit tests cover the read-side surface in the component workflows.

### 7.3 Severity posture — non-blocking watching-week

The workflow lands as a **normal CI job**, not a required status check. The first calendar week of normal-volume PRs is a watching period; promotion to a required status check is a **repo-settings change** (branch-protection rule), not a workflow-config change. Two consequences:

| Concern | Where it lives |
|---|---|
| "Is this gate enforced?" | Branch-protection settings → `kostiantyn-matsebora/deployment-dashboard` → Settings → Branches → `main` → Required status checks. **Not** in the workflow YAML. |
| Promotion criterion | One calendar week of green runs on normal-volume PRs (mirrors CR-0010 Open trade-off (ii)). Operator-driven. |
| Tracking | [`docs/ci-cd-pipelines.md § 5`](./ci-cd-pipelines.md#5-quality-gates) — the integration row's Severity column documents the promotion gate. |

### 7.4 Job steps — in order

| # | Step | Mechanism |
|---|---|---|
| 1 | Checkout | `actions/checkout@v4` |
| 2 | Setup .NET SDK | `actions/setup-dotnet@v4` with `dotnet-version: '10.0.x'` — matches the component workflows' pin (`_build-and-push-image.yml`); bump in lockstep |
| 3 | Verify docker compose >= 2.20 | Parses `docker compose version --short`; compares to `2.20` floor via `sort -V`; fails fast with a readable error if older |
| 4 | NuGet cache | `actions/cache@v4` keyed on `hashFiles('backend/**/*.csproj', 'testing/**/*.csproj')` |
| 5 | Start stack (integration profile) | `pwsh -NoProfile -File dev_env/start.ps1 -Integration -HealthTimeoutSeconds 180` |
| 6 | Run integration tests | `pwsh -NoProfile -File testing/integration/run-tests.ps1` |
| 7 | Collect compose logs on failure | `docker compose logs --tail=500` + `docker compose ps --all` + `GET http://localhost:18080/__admin/requests` |
| 8 | Upload failure artefacts | `actions/upload-artifact@v4`, name `integration-failure-${run_id}-${run_attempt}`, retention 7 days |
| 9 | Tear down stack | `pwsh -NoProfile -File dev_env/stop.ps1` — `if: always()` so failed runs still clean up |

`timeout-minutes: 30` on the job — the stack-up + suite + tear-down budget; failure-loop tail risk is bounded.

### 7.5 Compose-floor check — exact command

```bash
required="2.20"
actual="$(docker compose version --short || true)"
lowest="$(printf '%s\n%s\n' "$required" "$actual" | sort -V | head -n1)"
if [ "$lowest" != "$required" ]; then
    echo "ERROR: docker compose $actual < required $required (CR-0012 -- integration profile uses depends_on:required:false, a 2.20+ feature)" >&2
    exit 1
fi
```

GitHub-hosted `ubuntu-latest` runners ship `docker compose` >= 2.24 as of 2026-Q2 — the check is a defensive precondition for self-hosted / older-image runners, not a regularly-failing gate.

### 7.6 Failure artefacts

Bundle name: `integration-failure-<run-id>-<run-attempt>`. Contents under `integration-failure-logs/`:

| File | Source | Purpose |
|---|---|---|
| `compose-logs.txt` | `docker compose ... logs --no-color --tail=500` (both profiles) | API / fetcher / gateway / db / mock-gha last-500-lines logs in one bundle |
| `compose-ps.txt` | `docker compose ... ps --all` | Container state snapshot — surfaces "container restarted N times" / "container exited" without rummaging through logs |
| `wiremock-requests.json` | `GET http://localhost:18080/__admin/requests` | The full set of HTTP requests the fetcher made against mock-gha during the run; primary triage surface for "fetcher did not see what we expected" |

Best-effort `GET /__admin/requests` — wrapped in try/catch in the workflow YAML so a teardown-time admin-port unreachable does not lose the rest of the bundle.

### 7.7 Reading a failure log

Recommended triage order:

1. Open `compose-ps.txt` — which container is unhealthy / restarted / exited? If `mock-gha` → suspect WireMock startup / mapping load. If `fetcher` → suspect upstream call shape or env-var contract.
2. Open `wiremock-requests.json` — did the fetcher reach mock-gha? Which URLs did it call? Compare against the scenario's expected mapping bundle.
3. Open `compose-logs.txt` — fan out from the suspect container's log lines. The bundle is `--no-color` so log greps cleanly.
4. Re-run the failing test locally with `pwsh dev_env/start.ps1 -Integration -HealthTimeoutSeconds 180 ; dotnet test testing/integration` to reproduce.

## 8. Local-dev `-Integration` switch

Script: [`dev_env/start.ps1`](https://github.com/kostiantyn-matsebora/deployment-dashboard/blob/main/dev_env/start.ps1).

SA-locked invariants (recap):

- Mirrors the `-Fetcher` precedent (issue #5).
- Implies `-Fetcher`.
- Sets the `integration` compose profile.
- Verifies `docker compose >= 2.20`.
- Reuses the existing local-dev `API_TOKEN`.

### 8.1 Parameter signature

```powershell
param(
    [switch]$Scaled,
    [switch]$Fetcher,
    [switch]$Demo,
    [switch]$AllowMissingGhaToken,
    [switch]$Integration,                 # CR-0012 -- this row
    [int]$HealthTimeoutSeconds = 60
)
```

`[switch]` semantics: `-Integration` is `true` when supplied, `false` otherwise. No value form is required.

### 8.2 Behaviour matrix vs other switches

| Combination | Outcome | Why |
|---|---|---|
| `-Integration` alone | Implies `-Fetcher` + `-AllowMissingGhaToken`; seeds env vars; adds `--profile integration` | Mock-gha ignores Authorization headers, so a real `GHA_TOKEN` is irrelevant |
| `-Integration -Fetcher` | Identical to `-Integration` alone | `-Integration` already implies `-Fetcher`; the extra switch is redundant but not an error |
| `-Integration -Scaled` | **exit 1** — mutually exclusive | Scaled stack is a standalone compose file (`docker-compose.scaled.yml`) that does NOT include `mock-gha` |
| `-Integration -Demo` | **exit 1** — mutually exclusive | `-Demo` points the fetcher at a public GitHub repo at 60 s cadence; `-Integration` points it at the in-network mock-gha at 1 s cadence — irreconcilable |
| `-Integration -AllowMissingGhaToken` | Identical to `-Integration` alone | `-Integration` already implies `-AllowMissingGhaToken` |
| (default — no switches) | Stack up without integration substrate; mock-gha never starts | Profile-gating contract (§ 3) |

### 8.3 Env-var seeding — what `-Integration` sets

`-Integration` writes the following into the script's environment **before** invoking `docker compose`. The release file's `${VAR:-default}` substitutions then pick them up at compose resolution time:

| Variable | Value under `-Integration` | Default (no `-Integration`) | Why seeded in `start.ps1`, not in `docker-compose.local.yml` |
|---|---|---|---|
| `GHA_API_BASE_URL` | `http://mock-gha:80` | `https://api.github.com` | Setting this as a literal in `docker-compose.local.yml`'s fetcher block would re-point every contributor's stack at mock-gha, even without `-Integration` |
| `FETCHER_POLL_INTERVAL_SECONDS` | `1` | `30` | Same reason — a literal would make vanilla `start.ps1` poll once per second, an unintended cost |
| `GHA_REPOSITORIES` | `[{"owner":"mock","repo":"app"}]` (only if unset) | `[{"owner":"example-org","repo":"example-repo"}]` | Mock-gha mappings under `testing/fixtures/gha/` key URLs by `owner=mock` / `repo=app` |

The `[string]::IsNullOrWhiteSpace` guard on `GHA_REPOSITORIES` lets an integration-runner-test author override the default by exporting their own value before invoking `start.ps1`.

### 8.4 Compose-args composition

`-Integration` adds two arguments to the `docker compose` invocation (in order):

| Arg | Set by |
|---|---|
| `--profile fetcher` | The implicit `-Fetcher` activation (existing behaviour) |
| `--profile integration` | The `-Integration` switch (CR-0012) |

Both profiles must be active — `fetcher` so the fetcher container starts; `integration` so the `mock-gha` container starts. Result: full chain `mock-gha` → `fetcher` → `gateway` → `api` → `db` runs end-to-end.

### 8.5 URL panel — what the operator sees

On a successful `-Integration` bring-up the script prints the standard URL panel **plus** two CR-0012-specific rows:

```
Dashboard / Gateway: http://localhost:8080/
Postgres (dev):      localhost:5432 (user: dashboard / password: local-dev-password)
pgAdmin:             http://localhost:5050/  (admin@example.com / admin)
Fetcher:             profile 'fetcher' active in INTEGRATION mode - polling mock-gha every 1 s
mock-gha admin API:  http://localhost:18080/__admin/  (WireMock.Net admin -- integration profile only)
```

The mock-gha admin URL is the contract surface for `dotnet test` running on the host — runners read `mockGhaAdminBaseUrl=http://localhost:18080` from `testing/config/integration.json` and POST scenario bundles there.

### 8.6 Reusing the local-dev API_TOKEN

`-Integration` makes no new secret demands. The fetcher's `DASHBOARD_WRITE_API_KEY` and the gateway's `API_TOKEN` both resolve to the same `local-dev-token-not-for-production` literal that `dev_env/docker-compose.local.yml` sets — identical to the standard contributor flow.

The integration runner reads the same value from `testing/config/integration.json` → `apiKey` field. No environment variable required on the host running `dotnet test` (mock-gha does not honour `GHA_TOKEN` — it ignores Authorization headers entirely).

### 8.7 Tear-down

Standard: `pwsh -NoProfile -File dev_env/stop.ps1`. The script already handles profile-gated services correctly (`docker compose down` removes services from any profile active at bring-up time), so no `-Integration` flag is needed on `stop.ps1`.

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
