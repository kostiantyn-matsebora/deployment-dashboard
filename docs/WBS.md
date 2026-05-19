# Work Breakdown Structure

Operational work plan for the deployment dashboard. Tracks the phased item list for the MVP web dashboard, the CI/CD integration pattern, and the v2.0 notification client. Each phase corresponds to a step in the engineering lifecycle; per-phase items are the discrete pieces of work the owning agent picks up.

---

## MVP — Web Dashboard

### 1. Implement Solution

- 1.0 Backend host (`backend/api/`) — composition root that wires up the **co-located Write and Read API services** (per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md) — microservices architecture, container co-location is a packaging choice); `Program.cs`, single Dockerfile, single ACA container app target; references `backend/write-api/`, `backend/read-api/`, `backend/shared/`. API-key middleware is applied **only** to the Write endpoint group (see SAD §8 "Security Considerations" and [ADR-0002](adr/ADR-0002-modular-monolith-consolidation.md) for the co-location mechanics and future-split trigger conditions).
- 1.1 Ingest API (Write surface — ASP.NET Core Minimal API library at `backend/write-api/`; composed into the API host)
  - 1.1.1 `DeploymentEvent` record with Data Annotations validation (`422` on invalid payload); fields include `deployment_id` (required) and `parent_deployments` (optional)
  - 1.1.2 EF Core `DeploymentEntity` and `DbContext` in `backend/shared/`; `deployments` table migration with `deployment_id` column + unique index on `(service, deployment_id)` and `parent_deployments` column (PostgreSQL `text[]`; SQLite JSON-encoded array). Migrations live in `shared/` and serve both surfaces.
  - 1.1.3 `201 Created` response with created resource body; `409 Conflict` on duplicate `(service, deployment_id)`; `400` on cross-service parent ref or on cycle through resolved references
  - 1.1.4 API key middleware applied to the Write endpoint group only (`MapGroup("/api").RequireApiKey()` on the write group; no global registration) — `401` on missing / invalid token; the Read group is unauthenticated by design
  - 1.1.5 PostgreSQL `NOTIFY deployments` channel after successful insert
  - 1.1.6 Topology cycle-check helper — validates `parent_deployments` against the already-resolved subgraph at ingest time; dangling references are accepted unchecked
- 1.2 Read API (Read surface — ASP.NET Core Minimal API library at `backend/read-api/`; composed into the same API host)
  - 1.2.1 `GET /api/deployments` — matrix query with `lastSuccessful`, `previousFailed`, and per-service `topology.edges` derivation; accept optional `correlationAttribute` query parameter (validated against the allowed enum; `400` on invalid value); precedence `PerServiceOverrides[svc] > query-param > server default`
  - 1.2.2 `GET /api/deployments/{service}/{environment}/history` — last N events, `404` when no history
  - 1.2.3 `GET /api/environments` and `GET /api/services` — discovery from stored data
  - 1.2.4 `GET /api/stream` — SSE endpoint; subscribe to PostgreSQL `LISTEN deployments` per connected client; **slot-update payload only — topology is NOT carried on the wire** (the SPA refreshes topology via `GET /api/deployments?correlationAttribute=…` after each event, per [CR-0003](cr/CR-0003-tree-topology-and-layout-axis.md) → "SSE topology semantics")
  - 1.2.5 `GET /health` — database connectivity check
  - 1.2.6 Topology derivation service — explicit-first + correlation fallback passes per [ADR-0001](adr/ADR-0001-topology-derivation-five-pass.md); correlation attribute resolved per request using the three-tier precedence; defensive read-side cycle drop with `WARN` log
  - 1.2.7 `GET /api/config/topology` (SPA-readable; surfaces server-side `CorrelationAttribute` + `PerServiceOverrides` so the picker can display "system default") and `PATCH /api/config/topology` (admin / CI / ops only — **not invoked by the SPA**). The PATCH endpoint lives on the Write endpoint group (auth-gated by the same `X-Api-Key` middleware that protects `POST /api/deployments`, per FR-10 and §8). GET is on the Read group (unauthenticated).
- 1.3 Dashboard Frontend (Angular 20 SPA)
  - 1.3.1 Angular workspace — standalone components, zoneless change detection, Tailwind CSS
  - 1.3.2 `DeploymentMatrixStore` (NgRx Signal Store) — matrix state, `lastSuccessful`, `previousFailed`, per-service `topology.edges`
  - 1.3.3 Pipeline matrix component — service rows, environment boxes; 6 states (success, running, failed, split variants)
  - 1.3.4 Box component — status badge, version, ago, actor, run link; ⚠ prev. failed badge
  - 1.3.5 History drawer component — current state panel + history list; displays `deployment_id` and `parent_deployments` for each entry
  - 1.3.6 Version hover directive — amber highlight across all environments for the same version
  - 1.3.7 SSE Angular service — browser-native `EventSource` subscription to `/api/stream`; dispatch slot-update events (slot state only — no topology on the wire) to `DeploymentMatrixStore`; on every slot-update event, trigger a topology refresh via `GET /api/deployments?correlationAttribute=<picker-value>` (coalesce bursts within ≤ 250 ms into a single GET)
  - 1.3.8 Search filter and "failures only" toggle; stats bar
  - 1.3.9 View switcher component (`frontend/matrix/` or `frontend/shared/`) — segmented control rendering the four views (Detailed / Compact / Glance / Focus); writes `dashboard.view`
  - 1.3.10 Attribute picker component (`frontend/matrix/`) — dropdown `Display <n>/<max>`; popover with seven checkboxes (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`); per-view cap enforcement (disabled state when cap reached); null-render invariant honoured for `ref`/`sha` (see [CR-0005](cr/CR-0005-ref-sha-display-and-topology.md) → "Null-render invariant for nullable attributes")
  - 1.3.11 Per-view templates in `frontend/matrix/` — four standalone row components (`detailed-row`, `compact-row`, `glance-row`, `focus-row`) selected by the parent matrix component based on the active view
  - 1.3.12 Signal Store slice (`frontend/shared/`) — `{ view, attrs[view], layout, correlationAttribute }` with derived signals `activeView`, `selectedAttrs`, `capReached`, `activeLayout`, `activeCorrelationAttribute` (string | undefined; undefined → "use server default" → omit query parameter)
  - 1.3.13 `localStorage` persistence service (`frontend/shared/`) — typed wrapper for the seven `dashboard.*` keys (`dashboard.view`, `dashboard.attrs.{view}` ×4, `dashboard.layout`, `dashboard.correlationAttribute`); corruption-safe (try/catch around `JSON.parse`, filter to known attribute keys, truncate to per-view cap, validate layout/view/correlation-attribute string against allowed set, fall back to defaults on any failure); empty-array selection preserved; unknown correlation-attribute value treated as absent (omit query parameter)
  - 1.3.14 Layout switcher component (FR-13) — second segmented control in the header rendering the three layouts (Matrix / Swim-lane / Workflow-rows); writes `dashboard.layout`
  - 1.3.15 Layout renderers — Swim-lane and Workflow-rows components consume per-service `topology.edges`; Matrix layout is the existing services × environments grid. Connector geometry anchored to `getBoundingClientRect()` via `ResizeObserver` + window-resize listener (NFR-09). Empty-topology fallback: single root chain ordered by `current.deployed_at`.
  - 1.3.16 Glance pill with embedded env tag — env name rendered inside the coloured pill (NFR-09 Glance exception); rendering shared across all three layouts.
  - 1.3.17 Topology correlation-attribute picker — UI control that writes a user preference **only to `localStorage`** (key `dashboard.correlationAttribute`); never invokes `PATCH /api/config/topology`. Reads server-side default via `GET /api/config/topology` to label the "system default" option. The chosen value is appended as `correlationAttribute` query parameter on every `GET /api/deployments` (matrix fetch + post-SSE refresh). No `X-Api-Key` is ever sent from the SPA.
- 1.4 CI/CD notify step documentation
  - 1.4.1 Generic inline HTTP call (`curl`) snippet documented for any CI/CD tool
  - 1.4.2 GitHub Actions reusable composite action (`action.yml`) with input parameters including `deployment_id` (required) and `parent_deployments` (optional, space- or comma-separated list)
  - 1.4.3 Pester tests for any non-trivial composite action or webhook receiver script logic
- 1.5 Optional pull-mode fetcher + universal `X-Progress-Reporter` event-attribution header (per [CR-0009](cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md), paired with [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md))
  - 1.5.1 CR-0009 + ADR-0004 amend SAD (§3 Non-Goal #2, §7 Components Summary + ASCII topology + API Contract + new "Dashboard.Fetcher" sub-section, §9 CI/CD Integration phase, §10 Decision 6) + WBS (§1.5 — this section) + `docs/ci-cd-integration.md` (two new H2 sections — "Event attribution — `X-Progress-Reporter` header" and "Pull-mode alternative (optional)"). **Owner:** `solution-architect`.
  - 1.5.2 EF Core migration: add nullable column `progress_reporter VARCHAR(64) NULL` on the existing events / deployments table **and** new table `fetcher_state` (PK `(progress_reporter, source_id)`; `cursor VARCHAR(4096) NOT NULL`; `updated_at TIMESTAMPTZ NOT NULL`). Packaging per CR-0009 Open trade-off (i) recommendation — **one migration** (`AddProgressReporterAndFetcherState`), matching the `AddTopologyColumnsAndConfig` precedent (column-on-existing-table + new-table in one file). **Owner:** `backend-engineer`.
  - 1.5.3 `POST /api/deployments` validation + persistence for optional request header `X-Progress-Reporter` (cap 64; non-whitespace; `[FromHeader(Name = "X-Progress-Reporter")]` binding; `ValidationProblemDetails` 422 on violation per CR-0008; persists to new `progress_reporter` column when present, leaves column NULL when absent). No change to existing POST body shape. **Owner:** `backend-engineer`.
  - 1.5.4 `GET`/`PUT /api/fetcher/state/{source-id}` endpoints on the existing Write endpoint group (so the same `X-Api-Key` middleware applies). `X-Progress-Reporter` **required** on both — 422 on missing / over-cap. Body shape per CR-0009 § Impact API Contract additions. ProblemDetails errors throughout; OpenAPI / Scalar metadata per CR-0008 conventions. **Owner:** `backend-engineer`.
  - 1.5.5 Read API event DTO surface: add nullable `progress_reporter` string property (JSON name `"progress_reporter"`) to `DeploymentEventResponse`, `CurrentDeployment`, and `LastSuccessfulDeployment` (per CR-0009 Open trade-off (iii) recommendation — every existing event-attribute surface that exposes `ref`/`sha` also exposes `progress_reporter`). Always emitted; value `null` when the persisted column is `NULL`. **Owner:** `backend-engineer`.
  - 1.5.6 `backend/fetcher/Dashboard.Fetcher/` library — `ICiCdAdapter` interface per [ADR-0004](adr/ADR-0004-opaque-per-progress-reporter-cursor.md) Decision 4 (`AdapterId` + `FetchPageAsync(sourceId, opaqueCursor, pageSize, ct) → (events, newCursor, hasMore)`); `GitHubActionsAdapter` implementation (deployments + statuses; cursor = highest seen `deployment.id`); scheduler (default 30 s); Polly retry with exponential back-off on transient HTTP 5xx / network timeouts; rate-limit back-off (GitHub `X-RateLimit-*` headers). Host injects `X-Progress-Reporter: dashboard-fetcher/<AdapterId>` on every `POST /api/deployments` and on every cursor-state call. **Owner:** `backend-engineer`.
  - 1.5.7 `backend/fetcher-host/Dashboard.Fetcher.Host/` ASP.NET Core Worker (`Microsoft.NET.Sdk.Worker`); env-var configuration only (no `.env` per bindings.md); adapter composition root; Write API client reusing `Dashboard.Shared` DTOs (no DTO duplication). Required env vars: `DEPLOYMENT_DASHBOARD_URL`, `DEPLOYMENT_DASHBOARD_TOKEN` (the `X-Api-Key` value), `GHA_TOKEN` (PAT), `GHA_SOURCE_ID` (the `owner/repo` source-id for the cursor key), `POLL_INTERVAL_SECONDS` (default 30), `INITIAL_FETCH_LIMIT` (default 50, ceiling 500). **Owner:** `backend-engineer`.
  - 1.5.8 `backend/fetcher-host/Dockerfile` — multi-stage build mirroring `backend/api/Dockerfile` posture (SDK build → aspnet runtime). Image: `deployment-dashboard-fetcher`. **Image build + push + tag absorbed into §1.6 component-CI track (`fetcher.yml`) per [CR-0010](cr/CR-0010-component-ci-pipeline.md); the Dockerfile itself remains the §1.5.8 deliverable.** **Owner:** `devops-engineer`.
  - 1.5.9 `dev_env/docker-compose.local.yml` opt-in `--profile fetcher` entry — wires the fetcher container, reuses the existing local-dev `API_TOKEN` literal (`local-dev-token-not-for-production`) for `DEPLOYMENT_DASHBOARD_TOKEN`, targets `gateway:80` for `DEPLOYMENT_DASHBOARD_URL`, supports `${GHA_TOKEN:-...}` interpolation for the PAT (env-var fallback so the file stays committed; no `.env` per bindings.md). Default-off — the stack continues to start without the fetcher unless `--profile fetcher` is passed. **Owner:** `devops-engineer`.
  - 1.5.10 xUnit unit + functional regression: cursor endpoints (happy path, 404 on missing state, 422 on missing / over-cap `X-Progress-Reporter`, 422 on over-cap cursor, 401 without API key); `X-Progress-Reporter` cap-64 boundary on POST (63 / 64 / 65 chars, whitespace-only, null); POST optional-header round-trip (with-header and without-header POSTs both 201, persisted column reflects the input, Read API surfaces match); GHA adapter happy / rate-limit / empty-page paths; scheduler drift (interval respected ± tolerance under retry / back-off). Targeted regression per project bindings — only specs touching changed surfaces re-run by default; full regression opt-in. **Owner:** `qa-engineer`.
- 1.6 Component CI (per [CR-0010](cr/CR-0010-component-ci-pipeline.md), paired with [`docs/ci-cd-pipelines.md`](ci-cd-pipelines.md)). Outbound component-CI track — how the dashboard's own four container images are built, tested, and published. Inbound integration (third-party pipelines pushing to the dashboard) is the separate §1.4 track. Locked decisions: hybrid topology (4 thin callers + 1 reusable workflow); container images only (no NuGet / npm); GHCR today, ACR-cutover one-input swap when §4.3 lands; CI-only (no deploy step); identical trigger matrix across all four workflows (push:main / pr:main / tags v* / workflow_dispatch).
  - 1.6.1 [CR-0010](cr/CR-0010-component-ci-pipeline.md) + SAD §9 (outbound table) + WBS §1.5.8 split + WBS §5.1 split + WBS §1.6 (this section) + [`docs/ci-cd-pipelines.md`](ci-cd-pipelines.md) operational companion + `local/bindings.md` ownership row for the new doc. **Owner:** `solution-architect` (semantics) co-owned with `devops-engineer` (operational examples in `ci-cd-pipelines.md`).
  - 1.6.2 `.github/workflows/_build-and-push-image.yml` reusable workflow (single — Option A; resolves CR-0010 Open trade-off (i)) + four thin callers `.github/workflows/{api,fetcher,frontend,gateway}.yml`. Reusable inputs per CR-0010 § Impact. Tag rules per CR-0010 § 3e (Q5). Caller permissions per CR-0010 § 3j (Phase 5 amendment — explicit `contents: read` + `packages: write` + `id-token: write`; `read-all` is insufficient). Reusable MUST NOT declare top-level `permissions:` (Phase 5 amendment per CR-0010 § 3j). **Owner:** `devops-engineer`.
  - 1.6.3 `.config/dotnet-tools.json` — pins `dotnet-ef` to the .NET 10 release line; consumed by the reusable workflow's `dotnet tool restore` + EF migration script generation steps. **Owner:** `devops-engineer`.
  - 1.6.4 `frontend/karma.conf.js` — shared Karma config emitting cobertura + lcov, declaring `ChromeHeadlessNoSandbox` custom launcher (required for the GHA runner sandbox); `frontend/angular.json` `karmaConfig` wired across all four projects to point at the new shared config. **Owner:** `qa-engineer`.
  - 1.6.5 `dotnet format` baseline applied to 10 backend files — one-shot cleanup so the reusable workflow's `dotnet format --verify-no-changes` gate (CR-0010 § 3h) passes from day one. **Owner:** `backend-engineer`.
  - 1.6.6 `backend/api/Dashboard.Api/Dashboard.Api.csproj` — adds `Microsoft.EntityFrameworkCore.Design` PackageReference with `PrivateAssets=all`; required by the `dotnet ef migrations script` invocation per CR-0010 § 3l. Tests / image / runtime unaffected. **Owner:** `backend-engineer`.
  - 1.6.7 Phase 5/6 iteration fixes: caller-permissions amendment (Phase 5 per CR-0010 § 3j), reusable top-level-permissions removal (Phase 5 per CR-0010 § 3j), `PeriodicTimer_LongTickDoesNotCauseBackToBackBurstOfTicks` flake-threshold tuned 250 ms → 100 ms for CI scheduler jitter while preserving the queueing-bug regression signal (Phase 6 per CR-0010 § Impact). **Owner:** `devops-engineer` (workflow amendments) + `qa-engineer` (test threshold).
  - 1.6.8 Branch-protection enforcement — repo settings → require workflow success on `main` before PR merge. Repo-settings change only, no code surface; gated on a calendar week of green runs to avoid gating PRs on a flaky workflow. **Owner:** `user` (out of scope for code; surfaced as follow-up). Resolves CR-0010 Open trade-off (ii).
  - 1.6.9 Follow-up TODOs surfaced by CR-0010 / Phase 4 implementation — not in scope for §1.6 itself, listed here for backlog visibility: dogfooding notify-hook re-introduction (dropped in Wave 4b — CR-0010 § 3m); `ng lint` gate (dropped from MVP-CI as Wave 4b D3 — frontend lint gate becomes a follow-up); angular-eslint adoption; integration / e2e CI workflow (requires the compose stack — deferred per CR-0010 § 3f); GHCR → ACR cutover when §4.3 lands; Trivy / SBOM scanning. **Owner:** — (deferred; track via separate TODO entries when picked up).

### 2. Automate Local Deployment (Docker Compose + PowerShell)

- 2.1 `docker-compose.yml` — API container (Write + Read surfaces) + Dashboard Frontend + App Gateway + PostgreSQL + pgAdmin + migrations one-shot
- 2.2 PowerShell `start.ps1` — bring up the stack, wait for health check, print dashboard URL
- 2.3 PowerShell `stop.ps1` — tear down containers and volumes
- 2.4 PowerShell `seed.ps1` — POST prefilled test deployment events via Ingest API
- 2.5 `.env.local` template with all required variables documented

### 3. Functional and E2E Tests — Local Environment (API + prefilled test data)

- 3.1 Seed local database with representative test data covering all 6 box states (`seed.ps1`); seed set must include explicit `deployment_id` values and at least one chain of `parent_deployments` references so topology can be exercised
- 3.2 Functional (API) tests
  - 3.2.1 `POST /api/deployments` — happy path, validation errors, auth rejection; new cases: missing `deployment_id` → `422`; duplicate `(service, deployment_id)` → `409`; cross-service parent → `400`; cycle → `400`; dangling reference → `201`
  - 3.2.2 `GET /api/deployments` — matrix shape, `lastSuccessful`, `previousFailed`, and `topology.edges` correctness (explicit-only, correlated-only, mixed, dangling-then-resolved)
  - 3.2.3 `GET /api/deployments/{s}/{e}/history` — ordering, `404` for unknown slot
  - 3.2.4 `GET /api/environments`, `GET /api/services`, `GET /health`
  - 3.2.5 `GET /api/config/topology` — unauthenticated read returns server-side defaults; `PATCH /api/config/topology` — `401` without `X-Api-Key`; happy-path PATCH semantics (unset fields unchanged; explicit `null` removes a service's override). No SPA-driven e2e for PATCH (the SPA does not invoke it).
  - 3.2.6 `GET /api/deployments?correlationAttribute=<attr>` — happy path for each allowed value; `400` on invalid value (`id`, unknown attribute); per-service override beats the query parameter; absence of the parameter falls back to the server-side default
- 3.3 E2E tests
  - 3.3.1 Pipeline matrix renders all services and environments with correct states
  - 3.3.2 History drawer opens on box click; shows correct events including `deployment_id` and `parent_deployments`
  - 3.3.3 Real-time update — POST a new event, verify matrix box updates without page reload
  - 3.3.4 Layout switcher (FR-13) — verify all 4 × 3 = 12 (view, layout) combinations render without NFR-09 violations; reuse the six geometric invariants from `testing/mockup-visual/`
  - 3.3.5 Glance exception — env tag rendered inside the coloured pill across all three layouts; connector terminates at pill's left edge
  - 3.3.6 Topology rendering — explicit edges visually distinct from correlated edges; empty-topology services render as single root chains in Swim-lane / Workflow-rows

### 4. Implement Infrastructure (Terraform)

- 4.1 Resource Group and naming convention module
- 4.2 Azure PostgreSQL Flexible Server (B1ms, private access)
- 4.3 Azure Container Registry (Basic SKU)
- 4.4 Azure Container Apps Environment
- 4.5 Azure Container Apps — three container app definitions: API (Write + Read services co-located in `deployment-dashboard-api` per [ADR-0006](adr/ADR-0006-microservices-architecture-with-container-co-location.md)), Dashboard Frontend, App Gateway. A future move from co-location to per-service images adds a second backend container app — host-project + gateway-config-only change per [ADR-0002 → "Future split — trigger conditions"](adr/ADR-0002-modular-monolith-consolidation.md) (mechanics-of-record).
- 4.6 Azure Key Vault — store `API_TOKEN`, `ConnectionStrings__DefaultConnection`
- 4.7 Workspace-based environments (`dev`, `prod`) with per-environment variable files

### 5. Implement Component Deployment (Terraform)

- 5.1 GitHub Actions workflow — split between two halves:
  - **Build + push** half — delivered by §1.6 component-CI track per [CR-0010](cr/CR-0010-component-ci-pipeline.md), publishing to GHCR today (one-input registry swap when ACR lands per §4.3).
  - **Update Container App revision** half — deferred to a future CD CR + Terraform §4 + ACR cutover. Not in MVP scope.
- 5.2 Angular `ng build` output is bundled into the **Dashboard Frontend** nginx image (not into the API container) — `frontend/dashboard/Dockerfile` copies `dist/dashboard/browser/` into `nginx:alpine`. The API container serves JSON only.
- 5.3 Database migration step — run EF Core migration as part of deployment pipeline
- 5.4 Terraform `azurerm_container_app` revision update triggered by new image digest in ACR

### 6. Deploy Infrastructure

- 6.1 Run `terraform apply` for target environment
- 6.2 Verify all resources provisioned (`terraform show`, Azure Portal check)
- 6.3 Confirm Key Vault secrets populated; Container Apps read environment variables correctly

### 7. Smoke Test Infrastructure

- 7.1 `GET /health` returns `200 OK` — confirms Container App started and PostgreSQL reachable
- 7.2 `GET /api/stream` opens SSE connection — confirms LISTEN/NOTIFY subscription works (receive a test event within 5 s)
- 7.3 Angular SPA loads in a browser from the App Gateway URL — confirms the Dashboard Frontend nginx container serves the bundle and the gateway routes `GET /` correctly. (The API container does not serve static assets.)
- 7.4 Confirm PostgreSQL `deployments` table exists with correct schema

### 8. Deploy Components

- 8.1 Deploy the API container image (Write + Read surfaces) via CI pipeline (Docker build, push to ACR, update Container App revision). Dashboard Frontend and App Gateway images deploy via the same pipeline as separate ACA apps.
- 8.2 Run database schema migration (idempotent)

### 9. Functional and E2E Tests — Real Environment (API + prefilled test data)

- 9.1 Seed real environment with prefilled test data (`seed.ps1` targeting real endpoint with test API token)
- 9.2 Functional (API) tests against real Azure endpoints (same suite as §3.2)
- 9.3 E2E tests against real environment (same suite as §3.3, including SSE live update)

### 10. Clean Up Test Data

- 10.1 Run `cleanup.ps1` — delete all rows inserted by the test seed from `deployments` table
- 10.2 Verify `GET /api/deployments` returns an empty matrix

### 11. Fill Out Initial Data in Database

- 11.1 Coordinate with each team to supply current deployed versions per environment
- 11.2 Run `init-data.ps1` — POST one event per service+environment slot with real versions and `success` status
- 11.3 Verify matrix reflects the correct baseline state across all services and environments

---

## CI/CD Integration

Same 11-phase shape as MVP. Deltas per phase:

| Phase | Items |
|---|---|
| 1. Implement Solution | 1.1 Generic inline HTTP call pattern per CI/CD tool (GitHub Actions, Azure DevOps, Jenkins, GitLab CI, etc.). 1.2 GitHub Actions reusable composite action (`action.yml`) with input parameters. 1.3 GitHub Actions optional `deployment_status` webhook receiver. 1.4 Pester tests for any non-trivial composite action or webhook receiver script logic. 1.5 Secrets documentation — `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` per CI/CD tool. |
| 2. Automate Local Deployment | 2.1 PowerShell `test-notify.ps1` — send a test payload to the local ingest API to verify the integration pattern. 2.2 Confirm local dashboard updates on receipt. |
| 3. Functional and E2E Tests — Local | 3.1 Functional tests — send the integration payload from each supported CI/CD tool pattern; verify `201` and matrix update. 3.2 E2E tests — verify the dashboard updates visually after each notify pattern fires. |
| 4. Implement Infrastructure (Terraform) | 4.1 No new Azure resources — CI/CD integration is pipeline-side configuration only. 4.2 Add `DEPLOYMENT_DASHBOARD_URL` and `DEPLOYMENT_DASHBOARD_TOKEN` to each CI/CD tool's secret store. |
| 5. Implement Component Deployment | 5.1 Add notify step to each active deployment pipeline. 5.2 Confirm the step fires correctly on the next deployment. |
| 6. Deploy Infrastructure | 6.1 Secrets provisioned in each CI/CD tool's secret store. 6.2 Verify secrets are accessible from the pipeline at runtime. |
| 7. Smoke Test Infrastructure | 7.1 Run `test-notify.ps1` against real ingest endpoint — verify `201` and matrix update. 7.2 Confirm API key authentication works (`401` with wrong token). |
| 8. Deploy Components | 8.1 Merge notify step into each active deployment pipeline. 8.2 Confirm the step executes on the first triggered deployment. |
| 9. Functional and E2E Tests — Real | 9.1 Trigger a real deployment in each pipeline — verify notify event is sent and matrix updates within 30 seconds. 9.2 Verify `run_url` in the matrix box opens the correct pipeline run. |
| 10. Clean Up Test Data | 10.1 No test data cleanup required — real deployment events are valid production data. |
| 11. Fill Out Initial Data | 11.1 Current versions were backfilled in MVP §11 — no additional inserts required. 11.2 Verify matrix reflects accurate real state after the first batch of pipeline-triggered events. |

---

## v2.0 — Notification Client

Same 11-phase shape as MVP. Deltas per phase:

| Phase | Items |
|---|---|
| 1. Implement Solution | 1.1 Core polling loop — `GET /api/deployments` on configurable interval; diff against cached state. 1.2 OS notifications — one notification per changed slot; title, body, and status formatting. 1.3 Click-through — notification click opens dashboard URL in default browser. 1.4 Configuration — load from local config file; auto-discover environment list from `GET /api/environments` when `filter_environments` is empty. 1.5 Build target — self-contained binary (.NET 10 publish with `--self-contained -r <rid>`). |
| 2. Automate Local Deployment | 2.1 PowerShell `start.ps1` — bring up MVP backend docker-compose stack; wait for health check. 2.2 PowerShell `run-local.ps1` — start notification client pointed at local stack; pass config via env file. 2.3 PowerShell `stop.ps1` — stop client and tear down backend stack. 2.4 `.env.local` / config file template with all required variables documented. |
| 3. Functional and E2E Tests — Local | 3.1 Seed local database with test deployment events (`seed.ps1` from MVP stack). 3.2 Functional tests: (a) client polls and reads matrix state correctly on first cycle; (b) diff logic detects changed slots and emits correct notification payload; (c) no spurious notifications fired when matrix state is unchanged. 3.3 E2E tests: (a) POST new deployment event via Ingest API — verify OS notification fires within one poll cycle; (b) notification click opens correct dashboard URL in default browser. |
| 4. Implement Infrastructure (Terraform) | 4.1 No new Azure resources — v2.0 is a standalone binary that consumes MVP backend endpoints. 4.2 GitHub Actions release environment — configure secrets, permissions, and release token in repository settings. 4.3 GitHub Actions release workflow YAML — matrix build for Windows, macOS, Linux on tag push. 4.4 Pester tests for any non-trivial build or packaging script logic. |
| 5. Implement Component Deployment | 5.1 `build.ps1` — compile and package self-contained binary; validated in CI matrix. 5.2 GitHub Releases publish step — upload platform binaries and attach changelog-derived release notes. 5.3 Pre-release tag convention documented for smoke-test validation runs. |
| 6. Deploy Infrastructure | 6.1 Configure GitHub Actions environment with required secrets and permissions. 6.2 Push pre-release tag — verify workflow triggers and completes without error. |
| 7. Smoke Test Infrastructure | 7.1 Verify binary artifacts for all three platforms are attached to the pre-release GitHub Release. 7.2 Install pre-release binary on a developer machine; verify it starts and reads config without error. |
| 8. Deploy Components | 8.1 Tag stable version and trigger release pipeline. 8.2 Verify binary artifacts attached to the stable GitHub Release for all target platforms. |
| 9. Functional and E2E Tests — Real | 9.1 Install stable binary on a developer machine; configure with real dashboard URL and API endpoint. 9.2 Seed real environment with a test deployment event (`seed.ps1` targeting real endpoint with test API token). 9.3 Functional tests — verify client reads matrix state and detects changed slot within one poll cycle. 9.4 E2E tests: (a) POST test event — verify OS notification fires within one poll cycle; (b) notification click opens real dashboard URL in default browser. |
| 10. Clean Up Test Data | 10.1 Run `cleanup.ps1` — delete test deployment records inserted in §9.2. 10.2 Verify no spurious notification fires on the next client poll after cleanup. |
| 11. Fill Out Initial Data | 11.1 Initial data was seeded in MVP §11 — no additional inserts required for v2.0. 11.2 Verify the client reads the correct baseline state on first poll. 11.3 Verify no spurious notifications fire for stable (`success`) slots on subsequent polls. |
