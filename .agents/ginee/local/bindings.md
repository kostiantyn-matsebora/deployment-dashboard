# Project Bindings - Deployment Dashboard

## Source-of-truth ownership

**Default reads:** `local/index/*` per `core/index-protocol.md`. The table below is a **governance map** - who edits each source + where the verbatim text lives when an index entry points to "see source." NOT a per-dispatch read list; pulling raw doc paths into every dispatch defeats the load-on-demand contract.

| File | Role | Edited by |
|---|---|---|
| `docs/architecture.md` | Requirements (FR/NFR), constraints, components, data model, API, §7 invariants, §10 decisions | `solution-architect` |
| `local/requirements.md` | FRs / NFRs / Constraints register (D25 - seeded from `docs/architecture.md` §4-§6) | `solution-architect` |
| `local/asr-utility-tree.md` | ASR utility tree (D25 - Architecturally Significant Requirements derived via ATAM) | `solution-architect` |
| `docs/ui/mockups/deployment-dashboard.html` | Visual + behavioural client contract (palette, six box states, NFR-09 reflow invariant) | mockup owner (`frontend-engineer`); `solution-architect` reviews, no edits |
| `docs/ui/mockups/env-tag-column-alignment-variant-{a,b}.html` | Mockup variants pairing the `env-tag-column-alignment` UI option | `frontend-engineer` |
| `docs/adr/` | Architecture Decision Records (ADR-0001 topology / ADR-0002 co-location mechanics - **superseded on framing by ADR-0006** / ADR-0003 theme persistence + FOIT bootstrap / ADR-0004 opaque-cursor + fetcher non-co-location / ADR-0005 release-install migration - **superseded by ADR-0009** / ADR-0006 microservices architecture + container co-location / ADR-0007 vendor adapters emit parent_deployments / ADR-0008 leaky-bucket cap + republish-on-tick / ADR-0009 startup-applied EF migrations / ADR-0010 dev_env compose derives from release) | `solution-architect` |
| `docs/cr/` | Change Requests (CR-0001..CR-0013) - **reassigned to `team-lead` per D25** (coordination decisions, not architectural). SA reviews each for architectural coherence. | `team-lead`; `solution-architect` reviews |
| `docs/ui/*.md` | UI option docs (compact / focus-layout / theme / tree-topology / version-display / env-tag-column-alignment / rate-limit-cluster) - mockup-supporting design records | `solution-architect` (semantics) + `frontend-engineer` (proposes option mockups) |
| `docs/ui/index.md` | Jekyll UI-options landing page | `solution-architect` (Just the Docs nav-order + content); `devops-engineer` reviews Jekyll mechanics |
| `docs/WBS.md` | Operational work-breakdown - per-phase items, MVP / Phase 2.0 split (D25 - reassigned to `team-lead`) | `team-lead`; `solution-architect` reviews for scope-impact coherence |
| `docs/ci-cd-integration.md` | Operational companion to SAD §7 - payload + snippet detail (inbound: adopter pipelines push TO us). **CI/CD guide per D25 stays with `devops-engineer`.** | `devops-engineer`; `solution-architect` reviews for architectural coherence |
| `docs/ci-cd-pipelines.md` | Operational pipeline doc - our component workflows (outbound: our pipelines build our images), per CR-0010 / CR-0013 (demo-gha + demo-driver callers) | `devops-engineer` |
| `docs/integration-tests.md` | Operational integration-test guide - WireMock mapping authoring, scenario activation, mock-gha endpoint coverage matrix vs CR-0009 § 3d, CI invocation, `-Integration` local-dev switch, demo-bundle co-location story | `qa-engineer` (semantics) + `devops-engineer` (compose + workflow examples) + `solution-architect` (governance review, no edits) |
| `docs/install.md` | User-facing install reference - flag matrix (demo-default / -RealGha / -Empty), prereqs, GHCR auth, escape hatches | `devops-engineer` (operational shape) + `solution-architect` (architectural cross-refs) |
| `docs/getting-started.md` | 60-second-demo walkthrough | `devops-engineer` (operational walkthrough) + `solution-architect` (architecture cross-refs) |
| `docs/features.md` | User-visible surface map citing source-of-truth docs | `solution-architect` (semantics map) + `frontend-engineer` (UI rows) |
| `docs/index.md` | Jekyll landing page (mermaid C4, governance links, quickstart) | `solution-architect` (semantics) + `devops-engineer` (Just the Docs mechanics) |
| `docs/_config.yml`, `docs/Gemfile`, `docs/assets/` | Jekyll site config + theme pin + static assets | `devops-engineer` |
| `docs/cr/CR-0012-integration-test-substrate.md` | CR-0012 - integration test substrate design-of-record | `team-lead` (per D25); `solution-architect` + `qa-engineer` review |
| `docs/cr/CR-0013-demo-mode-default-installer.md` | CR-0013 - demo-mode default in release-install entrypoint design-of-record (+ §3e demo-driver sidecar amendment per issue #46) | `team-lead` (per D25); `solution-architect` + `devops-engineer` + `qa-engineer` review |
| `testing/integration/` | xUnit integration test project - scenarios, runners, admin-API scenario-loader, assertion oracles for FR-06 / NFR-03 / NFR-05 / ADR-0004 cursor contract | `qa-engineer` |
| `testing/fixtures/gha/` | WireMock-native JSON mappings (per-endpoint x per-scenario) + scenario bundles + demo-mode bundle (`mappings/`, `scenarios/<state-id>/`, `scenarios/_cross-cutting/`, `demo/mappings/`, `demo/mappings/statuses/`, `demo/ticks/`) | `qa-engineer` |
| `.github/workflows/integration.yml` | Integration-test workflow gate - triggers + path filters + compose stack lifecycle + scenario invocation | `devops-engineer` (workflow shape) + `qa-engineer` (suite content via `testing/integration/`) |
| `.github/workflows/{api,fetcher,frontend,gateway,demo-gha,demo-driver}.yml` | Component CI callers per CR-0010 (+ CR-0013 + issue #46) - thin shims around `_build-and-push-image.yml` | `devops-engineer` |
| `.github/workflows/_build-and-push-image.yml` | Reusable component-CI workflow per CR-0010 | `devops-engineer` |
| `.github/workflows/release.yml` | Release-asset publication on `v*` tags per ADR-0005 (migration script asset no longer generated post-ADR-0009 supersession) | `devops-engineer` |
| `.github/workflows/scripts.yml` | Pester + bats gate for `install/`, `dev_env/`, `testing/scripts/*` on ubuntu-latest | `devops-engineer` (workflow shape) + `qa-engineer` (script-test content) per D18 |
| `.github/workflows/pages.yml` | Jekyll docs site build + deploy to GitHub Pages (private-repo plan-gated) | `devops-engineer` |
| `.github/actions/notify/` | Composite action - notify a deployment-style event (per WBS §1.4.2; dogfooding hook deferred) | `devops-engineer` |
| `.github/ISSUE_TEMPLATE/{bug-report.md,feature-request.md,config.yml}` | Inbound-issue forms; trigger D14 `ginee:ready` label | `team-lead` (D14 governance) + `devops-engineer` (form mechanics) |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR description scaffold | `team-lead` (D14 governance) |
| `install/docker-compose.release.yml`, `install/install.{ps1,sh}`, `install/uninstall.{ps1,sh}` | Release-install stack - canonical service inventory; consumed by `dev_env/` via `-f` merge per ADR-0010 | `devops-engineer` |
| `gateway/demo-gha/` | Demo-gha Docker image source - `Dockerfile` + bakes qa-owned `testing/fixtures/gha/demo/` content into `/home/wiremock/mappings/` per CR-0013. Dockerfile is a devops concern; bundle content is qa-owned. | `devops-engineer` |
| `gateway/demo-driver/` | Demo-driver sidecar Docker image source - `Dockerfile` + `entrypoint.py` (Python JVM WireMock admin-API ticker per CR-0013 §3e amendment / issue #46 / issue #57 runtime migration). Drives demo-gha so the demo dashboard surfaces ongoing activity. | `devops-engineer` |
| `backend/api/`, `backend/write-api/`, `backend/read-api/`, `backend/shared/`, `backend/fetcher/`, `backend/fetcher-host/` (+ READMEs) | Per-service code + per-service docs (D25 per-tier docs reassignment) | `backend-engineer`; `solution-architect` reviews for architectural coherence |
| `frontend/` (+ per-app READMEs in `dashboard/`, `matrix/`, `drawer/`, `shared/` when authored) | Per-app code + per-app docs (D25) | `frontend-engineer`; `solution-architect` reviews for architectural coherence |
| `testing/` (test plans / scenario docs / READMEs under `testing/scripts/README.md`, `testing/fixtures/gha/README.md`) | Quality docs (D25) | `qa-engineer`; `solution-architect` reviews for architectural coherence |
| `.config/dotnet-tools.json` | .NET tool manifest (`dotnet-ef` pin for CI migration script generation) | `devops-engineer` (CI tooling) + `backend-engineer` (consumer) |
| `CLAUDE.md` | Project-instruction file - ginee framework pointer block (D25 - `team-lead` owns; SA reviews architectural coherence) | `team-lead`; `solution-architect` reviews |
| `README.md` | Public landing - quickstart, mermaid C4, badge bar, governance links | `team-lead` (per D25 project-instruction class); `solution-architect` reviews for architectural coherence |
| `CONTRIBUTING.md` | Contributor guide - ginee orchestration pointer + role-routing references | `team-lead` |
| `SECURITY.md` | Disclosure + scope (NFR-04 anchored) | `team-lead` (D14 governance) + `solution-architect` reviews (NFR-04 anchor) |
| `CODE_OF_CONDUCT.md` | Community standard | `team-lead` |
| `CHANGELOG.md` | Keep-a-Changelog (pre-1.0; release notes land here per ADR-0005 release pipeline) | `devops-engineer` (release pipeline owner) + `team-lead` (governance) |
| `LICENSE` | MIT | `team-lead` (immutable post-license-pick) |

**Tie-breakers.**

| Conflict | Winner | Action |
|---|---|---|
| Visual / interactive behaviour: architecture doc vs. mockup | mockup | flag architecture doc for update |
| API / data / stack / infrastructure: architecture doc vs. mockup | architecture doc | flag mockup for update |
| SAD-frozen FR/NFR text vs. a CR's "SAD-level content owned by this CR" block | CR (post-freeze) | the CR is the source of truth; SAD is the frozen baseline |
| Request / instinct / existing code vs. docs | docs | **stop, flag owning role** - doc update lands first, code follows |
| Release `install/docker-compose.release.yml` vs `dev_env/docker-compose.local.yml` shared service | release compose | per ADR-0010, dev_env merges-over release; release is the source-of-truth |

## Architects

(D25 - optional section for multi-architect projects; single-architect default applies until populated.)

| Architect | Scope |
|---|---|
| `solution-architect` cardinal | Whole-project default |

## Repository structure

```
deployment-dashboard/
|-- backend/             .NET 10 - microservices architecture per ADR-0006; container co-location of Write + Read per ADR-0002 mechanics
|   |-- api/             host (Dashboard.Api + Dashboard.Api.Tests) - single Dockerfile, single ACA container target; applies EF migrations on startup per ADR-0009
|   |-- write-api/       Write endpoint group library (Dashboard.WriteApi) + tests
|   |-- read-api/        Read endpoint group library (Dashboard.ReadApi) + tests
|   |-- shared/          DbContext, entities, DTOs, migrations, API-key middleware, NOTIFY/LISTEN, SSE writer + tests
|   |-- fetcher/         Pull-mode adapter library (Dashboard.Fetcher + Dashboard.Fetcher.Tests) per CR-0009 - GHA adapter, scheduler, typed write-API client
|   `-- fetcher-host/    Fetcher worker host (Dashboard.Fetcher.Host) + Dockerfile - separate ACA container target
|   `-- Dashboard.sln
|-- frontend/            Angular 20 workspace
|   |-- dashboard/       application shell (Tailwind entry, SSE bootstrap, header)
|   |-- matrix/          pipeline matrix + view templates + attribute picker
|   |-- drawer/          history drawer
|   `-- shared/          Signal Store + API client + SSE service + models + fixtures
|-- gateway/             nginx reverse proxy + Dockerfile (single public ingress on :8080)
|   |-- demo-gha/        Dockerfile for the demo-gha image (CR-0013) - bakes testing/fixtures/gha/demo/ into a JVM WireMock image (wiremock/wiremock:3.10.0)
|   `-- demo-driver/     Dockerfile + entrypoint.py for the demo-driver sidecar (CR-0013 §3e / issue #46) - Python ticker driving demo-gha admin API
|-- install/             docker-compose.release.yml + install.{ps1,sh} + uninstall.{ps1,sh} - release-install canonical compose; dev_env layers via `-f` merge per ADR-0010
|-- dev_env/             docker-compose.local.yml (override on install), docker-compose.scaled.yml (standalone NFR-05), start.ps1, stop.ps1
|-- docs/                architecture.md, WBS.md, ci-cd-integration.md, ci-cd-pipelines.md, integration-tests.md, install.md, getting-started.md, features.md, index.md, _config.yml, Gemfile, adr/, cr/, ui/ (option docs + mockups/), assets/
|-- testing/             functional/ (xUnit), integration/ (xUnit cross-stack CR-0012), e2e/ (Playwright), mockup-visual/ (Playwright), scripts/ (Pester + bats), fixtures/ (incl. fixtures/gha/ - WireMock mappings + scenarios + demo bundle), config/
|-- .agents/ginee/       framework install
|-- .claude/             Claude Code adapter (skills + agents)
|-- .config/             .NET tool manifest (dotnet-ef pin)
|-- .github/             actions/notify/, workflows/ (api+fetcher+frontend+gateway+demo-gha+demo-driver+_build-and-push-image+integration+release+scripts+pages = 11), ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md
|-- CLAUDE.md
|-- README.md, CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, CHANGELOG.md, LICENSE
`-- TODO
```

**Per-tier dependency rules (frontend):**

- `matrix/`, `drawer/` may import only from `@dd/shared`.
- `shared/` imports nothing else in the workspace.
- Only `dashboard/` imports from `@dd/matrix` and `@dd/drawer`.
- Each library exposes a single `public-api.ts`; no deep imports.

**Per-tier dependency rules (backend - co-located Write + Read API services per ADR-0006; co-location mechanics + project-reference graph per ADR-0002; Fetcher non-co-location per ADR-0004):**

- `backend/api/` (host) is the sole API executable and the only API Dockerfile.
- `backend/write-api/` + `backend/read-api/` are library projects; they expose extension methods composed by the host.
- Both reference `backend/shared/`; `shared/` references neither.
- API-key middleware applied **only** to the Write endpoint group (`MapGroup("/api").RequireApiKey()`), never globally.
- `backend/fetcher/` is a library; `backend/fetcher-host/` is the worker executable. Fetcher consumes Write-API via HTTP, not by in-process composition (per ADR-0004 non-co-location).
- API host applies EF migrations on startup via `Migrate()` per ADR-0009; concurrent replicas race-safely against `__EFMigrationsHistory`.

## Stack - non-negotiable

| Layer | Choice |
|---|---|
| Server language / framework | C# / .NET 10, ASP.NET Core Minimal API |
| Server ORM | EF Core 10 + Npgsql; **startup-applied migrations** per ADR-0009 |
| Storage | PostgreSQL 16; SQLite in-memory for unit tests |
| Real-time | SSE over PostgreSQL LISTEN/NOTIFY (no separate real-time service per SAD §7) |
| Client framework | Angular 20 standalone + NgRx Signal Store + Tailwind CSS |
| Edge / gateway | nginx reverse proxy, single public ingress on port 8080, no CORS |
| Container runtime | OCI containers, app port 8080 |
| Hosting | Azure Container Apps + ACR + Azure Postgres Flexible + Key Vault (NFR-01, NFR-02) |
| IaC | Terraform `azurerm` >= 4.x (NFR-06) - planned per WBS §4, not yet present |
| CI/CD | GitHub Actions - component CI live per CR-0010 (`_build-and-push-image.yml` reusable + `api.yml` / `fetcher.yml` / `frontend.yml` / `gateway.yml` callers); per CR-0013 + issue #46 two additional content-only callers: `demo-gha.yml` builds + pushes `deployment-dashboard-demo-gha` (baked `testing/fixtures/gha/demo/`) and `demo-driver.yml` builds + pushes `deployment-dashboard-demo-driver` (Python sidecar); `release.yml` publishes release assets per ADR-0005; `integration.yml` per CR-0012; `scripts.yml` for Pester + bats; `pages.yml` for Jekyll docs site; `.github/actions/notify/` composite present (dogfooding TODO deferred). |
| Docs site | Jekyll + Just the Docs remote-theme; mermaid via theme; private-repo Pages plan-gated |
| Demo sidecar runtime | Python 3 (gateway/demo-driver/entrypoint.py) - single standalone script consuming JVM WireMock admin API (post-#57 runtime migration); no Python framework footprint beyond `requests`-style HTTP |

## Do not introduce

| Forbidden | Why |
|---|---|
| Serverless / Functions / Lambda compute model | Constraint §6 - platform-agnostic OCI containers only |
| CORS configuration | SAD §7 - single origin via gateway; CORS-free by design |
| RBAC / per-user auth on Read group | NFR-04 - internal read-only tooling, no user auth |
| `.env` / `.env.local` files in `dev_env/` | `dev_env/README.md` - zero-setup, all dev values inline in compose files |
| CI/CD-specific SDKs in backend | SAD §1, FR-06 - backend is tool-agnostic; integration is one HTTP POST |
| Sticky sessions / session affinity on the API | NFR-05 - backend must be stateless across replicas |
| Topology payload on the SSE wire | CR-0003 - SSE carries slot updates only; topology refresh is a separate GET |
| External one-shot migration container | ADR-0009 supersedes ADR-0005 - API host self-applies migrations on startup |
| Host-published WireMock admin port outside `integration` profile | NFR-04 - admin-API access is opt-in via `-Integration` switch or CI workflow only; never published by release-install |
| Bind-mounts in release-install compose | Release-install images are self-contained (demo-gha + demo-driver bake their content); bind-mounts are reserved for the contributor flow / `integration` profile |

## Hard constraints (from NFRs)

| Constraint | Source | Implication |
|---|---|---|
| Azure-only hosting | NFR-01 | Single-cloud; no AWS / GCP / multi-cloud abstractions |
| Cost cap <= $30/month | NFR-02 | Minimal SKU sizing; ACA + B1ms Postgres baseline |
| Live updates <= 5 s | NFR-03 | SSE + LISTEN/NOTIFY (no polling) |
| No public ingress required (internal tooling) | NFR-04 | No public ACA ingress; no public load balancer; SPA never embeds the dev API key |
| Stateless backend | NFR-05 | Any number of replicas without sticky sessions; SSE clients reconnect via `Last-Event-ID`; each replica self-migrates idempotently on startup per ADR-0009 |
| IaC-defined | NFR-06 | All Azure resources via Terraform; no Portal-clicks |
| >= 90 days history retention | NFR-07 | `HISTORY_RETENTION_DAYS` default 365; daily pruning job |
| No build step in browser | NFR-08 | SPA shipped as static bundle into Read API `wwwroot` |
| UX reflow invariant - no overlap under any (services x envs x name-length x version-length x viewport) combo | NFR-09 | CSS Grid `auto`-env / fixed-leaf-width-box; `getBoundingClientRect()` + `ResizeObserver` + window-resize listener; mirrored verbatim atop the mockup |

Violation -> **stop, propose a doc update first** (CR + ADR pair if it changes a frozen FR/NFR).

## Roles - deterministic routing

| Role | Concerns |
|---|---|
| `team-lead` | Discovery / rediscovery; dispatch routing; parallel / serial decisions; TODO check-ins; lifecycle gate enforcement; post-acceptance doc-optimization trigger; GitHub issue operations (file / pick up / triage / promote / address-review); CR authoring (D25); `docs/WBS.md` operational ownership (D25); root governance files (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`); `CLAUDE.md` (D25); `.github/ISSUE_TEMPLATE/` + `.github/PULL_REQUEST_TEMPLATE.md`. |
| `solution-architect` | `docs/architecture.md`; `local/requirements.md`; `local/asr-utility-tree.md`; mockup governance review (no edits); UI option docs in `docs/ui/*.md`; ADRs in `docs/adr/`; CR architectural-coherence review (D25); `docs/index.md` + `docs/features.md` semantic content; coherence audits; tie-breaker resolution. |
| `frontend-engineer` (alias `client-engineer`) | `frontend/` (Angular workspace - dashboard / matrix / drawer / shared); `docs/ui/mockups/*.html` (mockup HTML/CSS/JS/SVG/fixtures + variants); Signal Store; Tailwind styling; client-side fetch / SSE; per-option mockup proposals under `docs/ui/`; per-app docs (D25 per-tier reassignment). |
| `backend-engineer` (alias `service-engineer`) | `backend/api/` host (`Program.cs`, composition root); `backend/write-api/` + `backend/read-api/` endpoint-group libraries; `backend/shared/` (DbContext, entities, migrations, API-key middleware, NOTIFY/LISTEN, SSE writer); `backend/fetcher/` + `backend/fetcher-host/` (Fetcher pull-mode adapter + worker host); wire-format JSON contract; per-service READMEs (D25 per-tier reassignment). |
| `devops-engineer` (alias `platform-engineer`) | `dev_env/` (compose + ps1 scripts); `gateway/` (nginx config + Dockerfile + `demo-gha/` + `demo-driver/`); per-tier Dockerfiles (`backend/api/Dockerfile`, `backend/fetcher-host/Dockerfile`, `frontend/dashboard/Dockerfile`, `gateway/Dockerfile`, `gateway/demo-gha/Dockerfile`, `gateway/demo-driver/Dockerfile`); `install/` (release-install compose + .ps1 / .sh entrypoints); `.github/actions/notify/`; `.github/workflows/` (all 11); `infrastructure/` (Terraform) once it lands; reverse-proxy config; secret provisioning; cost tracking; **`docs/ci-cd-integration.md` (D25 CI/CD guide stays with devops)**; `docs/ci-cd-pipelines.md`; `docs/install.md` + `docs/getting-started.md` + `docs/integration-tests.md` (operational shape); `docs/_config.yml` + `docs/Gemfile` + `docs/assets/`; `.config/dotnet-tools.json`; `CHANGELOG.md` (release pipeline owner). |
| `qa-engineer` (alias `quality-engineer`) | `testing/functional/` (xUnit functional API), `testing/integration/` (xUnit cross-stack CR-0012), `testing/e2e/` (Playwright), `testing/mockup-visual/` (Playwright visual contract), `testing/scripts/` (Pester + bats + `seed.ps1`), `testing/fixtures/` (incl. `testing/fixtures/gha/` - WireMock mappings + scenarios + demo bundle including `demo/mappings/statuses/` + `demo/ticks/` per CR-0013 §3e), `testing/config/`; harness assertions; `backend/**/Dashboard.*.Tests/` (xUnit unit tests - co-owned with `backend-engineer`); seed / cleanup scripts; test plans / scenario docs / QA reports (D25 per-tier reassignment); `docs/integration-tests.md` (semantics); `testing/integration/` xUnit suite content. |
| `ai-engineer` | Optimization passes on AI assets + docs; structure / topology / token economy; lossless restructures; `local/index/*` extraction + manifest maintenance per `core/index-protocol.md`. Between-phase only. |

Task spans two roles -> dispatch in parallel per `core/process.md` § Dispatch & parallelism rules.

## Project role boundaries

| Role | Must NOT edit |
|---|---|
| `solution-architect` | `docs/ui/mockups/*.html`; `backend/` source; `frontend/` source; `gateway/`; `dev_env/`; `install/`; Dockerfiles; `.github/`; `infrastructure/`; `docs/ci-cd-integration.md` (D25 - reviews only); `docs/ci-cd-pipelines.md`. |
| `frontend-engineer` | `backend/` source (incl. SQL in read-API endpoints); `gateway/`; `dev_env/`; `install/`; Dockerfiles; `.github/workflows/`; `infrastructure/`. |
| `backend-engineer` | `frontend/` source; `docs/ui/mockups/*.html`; `gateway/`; `dev_env/`; `install/`; Dockerfiles outside `backend/`; `.github/workflows/`; `infrastructure/`. |
| `devops-engineer` | Application-tier manifests / lockfiles (`backend/**/*.csproj`, `frontend/**/package.json`); application source under `backend/` + `frontend/`; mockup; CR/ADR semantics; `local/requirements.md`. |
| `qa-engineer` | `docs/ui/mockups/*.html`; production code under `backend/` + `frontend/`. Owns `testing/` directories + xUnit test projects (test code only) + fixtures + scenarios + runners + `testing/fixtures/gha/demo/{mappings/statuses,ticks}/` bundle content for the demo-driver. |
| `ai-engineer` | Rules / invariants / routing / requirements (semantics -> `solution-architect`); production code; test code; IaC; CI workflows. |
| `team-lead` | Production / test / IaC / workflow surfaces. Never edits production code. Edits CRs / WBS / governance / `CLAUDE.md` / `local/*` written during discovery. |

## Project-specific index citations

| Index file (or class) | Consumed by | Why this project needs it |
|---|---|---|
| `local/index/ui-options-index.idx` | `frontend-engineer`, `solution-architect` | `docs/ui/*.md` are mockup-supporting design records (compact / focus-layout / theme / tree-topology / version-display / env-tag-column-alignment / rate-limit-cluster) that drive per-option mockup proposals; both roles need quick lookup of which option doc covers which UX axis without loading the SAD. |
| `local/index/wbs-index.idx` | `team-lead`, `solution-architect` | `docs/WBS.md` is the operational backlog; team-lead consults it during pickup routing + phase-gate decisions, SA when proposing CRs that touch scope. |
| `local/index/ci-cd-integration-index.idx` | `devops-engineer`, `backend-engineer` | `docs/ci-cd-integration.md` is the operational companion to SAD §7 - devops authors / maintains the snippets, backend ensures the wire contract stays in sync. |
| `local/index/ci-pipelines-index.idx` | `devops-engineer`, `backend-engineer` | `docs/ci-cd-pipelines.md` is the operational doc for our component CI workflows - devops authors / maintains the workflow YAML + ops guide; backend consults it when tooling pins (`.config/dotnet-tools.json`, EF Design refs) need bumping. |
| `local/index/integration-tests-index.idx` | `qa-engineer`, `devops-engineer` | `docs/integration-tests.md` covers WireMock mapping authoring, scenario activation, mock-gha endpoint coverage matrix - qa-engineer authors mappings / scenarios; devops-engineer owns compose-profile gating + admin-port discipline. |
| `local/index/install-guide-index.idx` | `devops-engineer`, `team-lead` | `docs/install.md` documents flag-matrix + GHCR auth + prereqs; devops maintains; team-lead surfaces flags to users in support contexts. |
| `local/index/features-index.idx` | `solution-architect`, `frontend-engineer` | `docs/features.md` is the user-visible surface map citing source-of-truth docs; both roles consult it when proposing changes that affect public surfaces. |
| `local/index/governance-files-index.idx` | `team-lead`, `solution-architect` | Root `README.md` / `CONTRIBUTING.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` / `CHANGELOG.md` are project-instruction-class per D25 - team-lead edits; SA reviews architectural coherence. |
| `local/index/docs-site.yaml` | `devops-engineer`, `solution-architect` | Jekyll-site config + Gemfile pin + nav-ordered landing pages - devops maintains the workflow + theme pin; SA maintains semantic content. |
| `local/index/github-templates.yaml` | `team-lead`, `devops-engineer` | Issue + PR templates drive D14 inbound flow + `ginee:ready` labelling. |

## Per-role load-trigger overrides

| Role | Index file | Override | Why |
|---|---|---|---|
| `backend-engineer` | `local/index/api-matrix.yaml` | `always` | Two endpoint-group libraries (write / read) + Fetcher write-API client + wire-contract is core to almost every backend dispatch - preload over scope-trigger. |
| `frontend-engineer` | `local/index/mockup-index.idx` | `always` | Mockup is the visual contract (NFR-09) - `frontend-engineer` reads it on every dispatch, not only on visual-touch triggers. |
| `qa-engineer` | `local/index/mockup-index.idx` | `always` | `testing/mockup-visual/` directly mirrors mockup geometry; qa-engineer references the index on every visual + e2e dispatch. |
| `devops-engineer` | `local/index/topology.yaml` | `always` | Three compose surfaces (release + local + scaled) + 11 workflows + 6 Dockerfiles + 2 sidecars - devops touches topology on nearly every dispatch. |
| `devops-engineer` | `local/index/commands.yaml` | `always` | Cross-OS PowerShell + bash + dotnet + npm command inventory is hot for every CI / install / dev-env dispatch. |

## Out of scope (do not implement)

- Triggering or managing deployments - system is read-only / notification-only (SAD §3).
- Acting as a CI/CD engine; querying any CI/CD tool's API from the backend (SAD §3). The Fetcher worker queries CI/CD APIs externally and posts events back via the same write contract; backend remains tool-agnostic.
- Multi-organisation / multi-repository aggregation (SAD §3, MVP-out-of-scope).
- Role-based access control on Read endpoints (NFR-04 - internal read-only).
- Public ingress / public load balancer (NFR-04).
- Topology on the SSE wire (CR-0003 - refresh is a separate GET).
- Server-side persistence of per-user UI preferences (view / attrs / layout / theme / correlation-attribute - all `localStorage`-only per CR-0002 + CR-0005 + CR-0006).
- External one-shot migration container or release-asset migration script (retired by ADR-0009 supersession of ADR-0005).
- Host-published WireMock admin port outside the `integration` compose profile (NFR-04).
