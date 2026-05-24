# Project Profile - Deployment Dashboard

**Generated:** 2026-05-23 by `team-lead`
**Source:** rediscovery
**Revision:** 2 (previous: rev 1 on 2026-05-18 by `project-manager`)

## Domain

Real-time deployment dashboard. Renders a services x environments matrix sourced from CI/CD pipeline events (any tool that can `POST /api/deployments`), with per-slot history, six visual box states, configurable views (Detailed / Compact / Glance / Focus), three layouts (Matrix / Swim-lane / Workflow-rows), per-service topology derivation, and light / dark / auto theme. Internal read-only tooling (NFR-04); no RBAC; no public ingress. Target hosting: Azure Container Apps + Azure Postgres Flexible, <= $30/month. **Demo-mode is the no-flag default per CR-0013**: `install.ps1` / `install.sh` boot a self-contained demo stack (mock-gha + demo-driver sidecar + fetcher) requiring no PAT and no external network beyond the GHCR image pull. End-to-end built by AI specialists routed through the `ginee` multi-agent framework (per `README.md`, `CONTRIBUTING.md`).

**Cited from:** `docs/architecture.md:1-92` (Problem Statement, Goals, FRs, NFRs, Target Architecture) + `docs/WBS.md:1-3` + `README.md:1-86` + `CONTRIBUTING.md:1-15` + `docs/index.md:1-85` + `docs/install.md:1-50` + `dev_env/README.md:5-29`.

## Tech stack

| Layer | Choice | Source of evidence |
|---|---|---|
| Primary language(s) | C# (.NET 10) + TypeScript + Python 3 (sidecar) | `backend/api/Dashboard.Api/Dashboard.Api.csproj:4`, `frontend/package.json`, `gateway/demo-driver/entrypoint.py` |
| Server runtime | .NET 10 (`net10.0`) | `backend/api/Dashboard.Api/Dashboard.Api.csproj:4`, `backend/fetcher/Dashboard.Fetcher/Dashboard.Fetcher.csproj:4` |
| Server framework | ASP.NET Core Minimal API (`Microsoft.NET.Sdk.Web`) + .NET Generic Host (Fetcher worker) | `backend/api/Dashboard.Api/Dashboard.Api.csproj`, `backend/fetcher-host/Dashboard.Fetcher.Host/Dashboard.Fetcher.Host.csproj`, SAD §7 |
| Server ORM / persistence | EF Core 10 (Npgsql) + EF migrations in `backend/shared/Dashboard.Shared/Migrations/`; **applied at API host startup via `Migrate()`** per ADR-0009 (supersedes ADR-0005 external one-shot model) | `backend/README.md`, `docs/adr/ADR-0009-startup-applied-ef-migrations.md` |
| Data store | PostgreSQL 16 (prod); SQLite in-memory for unit tests | `dev_env/docker-compose.local.yml`, `install/docker-compose.release.yml`, `backend/README.md` |
| Real-time mechanism | SSE (`GET /api/stream`) over PostgreSQL `LISTEN/NOTIFY` | SAD §7, `backend/README.md` |
| Auth approach | Static API-key middleware (`X-Api-Key`) on the Write endpoint group only; Read group unauthenticated by design; **fetcher transport gates anonymous-mode (no `Authorization` header) when `GHA_TOKEN` is empty / placeholder** per CR-0011 / ADR-0008 | SAD §8, WBS §1.1.4, `backend/README.md`, `local/roles/devops-engineer.md § anonymous-vs-authed fetcher mode` |
| Pull-mode adapter | Optional `Dashboard.Fetcher` worker (GitHub Actions adapter) per CR-0009; **leaky-bucket cap + republish-on-tick usage reporting** per CR-0011 / ADR-0008; needs:-derived `parent_deployments` edges via 3 GHA endpoints per ADR-0007 | `backend/fetcher/`, `backend/fetcher-host/`, `docs/cr/CR-0009-pull-mode-fetcher-and-progress-reporter.md`, `docs/cr/CR-0011-fetcher-rate-limit-governance.md`, `docs/adr/ADR-0008-leaky-bucket-cap-and-republish-on-tick.md`, `docs/adr/ADR-0007-vendor-adapters-emit-parent-deployments.md` |
| Client framework | Angular 20 (standalone components, zoneless) | `frontend/package.json`, `frontend/README.md` |
| Client state | NgRx Signal Store (`@ngrx/signals` 20) | `frontend/package.json`, WBS §1.3.2 |
| Client styling | Tailwind CSS 3.4 | `frontend/package.json`, `frontend/tailwind.config.js` |
| Container runtime | Docker (Docker Compose v2 for local + release-install) | `dev_env/docker-compose.local.yml`, `install/docker-compose.release.yml`, `backend/api/Dockerfile`, `backend/fetcher-host/Dockerfile`, `frontend/dashboard/Dockerfile`, `gateway/Dockerfile`, `gateway/demo-gha/Dockerfile`, `gateway/demo-driver/Dockerfile` |
| Orchestration | Docker Compose for local + release-install (dev_env layers on install via `-f` merge per ADR-0010); Azure Container Apps for prod (per SAD §7) | `dev_env/docker-compose.*.yml`, `install/docker-compose.release.yml`, ADR-0010, SAD §7 |
| IaC | Terraform `azurerm` planned per WBS §4 / NFR-06 (no `infrastructure/` directory present yet) | WBS §4 - (none on disk) |
| CI/CD | GitHub Actions - 11 workflows live: `_build-and-push-image.yml` (reusable) + 6 component callers (`api.yml`, `fetcher.yml`, `frontend.yml`, `gateway.yml`, `demo-gha.yml`, `demo-driver.yml`) per CR-0010 + CR-0013 + issue #46; `integration.yml` per CR-0012; `release.yml` per ADR-0005 (release-asset publication; migrations now in-process per ADR-0009 supersession); `scripts.yml` for Pester + bats; `pages.yml` for Jekyll docs site. Composite `.github/actions/notify/`. Issue + PR templates under `.github/ISSUE_TEMPLATE/` + `.github/PULL_REQUEST_TEMPLATE.md`. | `.github/workflows/`, `.github/actions/notify/`, `.github/ISSUE_TEMPLATE/` |
| Docs site | Jekyll + Just the Docs theme published to GitHub Pages via `pages.yml`; nav-ordered pages with `nav_order:` front-matter; mermaid diagrams via theme; private-repo Pages plan-gated | `docs/_config.yml`, `docs/Gemfile`, `docs/index.md`, `.github/workflows/pages.yml` |
| Test runners | xUnit (.NET - functional + integration + per-tier unit tests) + Karma/Jasmine (Angular) + Playwright (e2e + mockup-visual) + Pester + bats (PowerShell + bash scripts) | `backend/**/Dashboard.*.Tests/*.csproj`, `testing/integration/Dashboard.Integration.Tests/`, `testing/functional/Dashboard.Functional.Tests/`, `frontend/package.json`, `testing/e2e/playwright.config.ts`, `testing/mockup-visual/playwright.config.ts`, `testing/scripts/*.Tests.ps1`, `testing/scripts/*.bats`, WBS §3.2 |

## Architecture artefacts (referenced - not copied)

| Concept | Path | Status |
|---|---|---|
| Architecture doc | `docs/architecture.md` | present |
| Mockup (canonical) | `docs/ui/mockups/deployment-dashboard.html` | present (relocated from `docs/ui/` per PR #62) |
| Mockup variants | `docs/ui/mockups/env-tag-column-alignment-variant-{a,b}.html` | present (per `docs/ui/env-tag-column-alignment.md` option) |
| API contract | inside `docs/architecture.md` §7 (no standalone file) | present |
| ADR directory | `docs/adr/` (ADR-0001..ADR-0010 + README; ADR-0009 supersedes ADR-0005; ADR-0002 superseded on framing by ADR-0006 - mechanics-of-record) | present |
| CR directory | `docs/cr/` (CR-0001..CR-0013 + README) | present |
| Diagrams directory | (none - diagrams embedded as ASCII art in `docs/architecture.md` + mermaid in `docs/index.md` / `README.md`) | absent |
| UI options directory | `docs/ui/` (compact / focus-layout / theme / tree-topology / version-display / env-tag-column-alignment / rate-limit-cluster + `index.md` Jekyll landing) | present |
| Operational companion (inbound) | `docs/ci-cd-integration.md` | present |
| Operational companion (outbound) | `docs/ci-cd-pipelines.md` | present |
| Operational companion (cross-stack) | `docs/integration-tests.md` (CR-0012) | present |
| User-facing docs (Jekyll site) | `docs/index.md`, `docs/getting-started.md`, `docs/install.md`, `docs/features.md`, `docs/_config.yml`, `docs/Gemfile`, `docs/assets/` | present |
| Work breakdown | `docs/WBS.md` | present |
| Project-instruction file | `CLAUDE.md` | present |
| Root governance files | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `LICENSE` | present |

Source-doc summaries land in `local/index/` (one file per detected doc class - `architecture.idx`, `adr-index.idx`, `cr-index.idx`, `mockup-index.idx`, `api-matrix.yaml`, `ui-states.yaml`, `constraints.yaml`, plus adopter-declared `ui-options-index.idx`, `wbs-index.idx`, `ci-cd-integration-index.idx`, `ci-pipelines-index.idx`, `integration-tests-index.idx`, `install-guide-index.idx`, `features-index.idx`, `governance-files-index.idx`, `docs-site.yaml`, `github-templates.yaml`). Roles read the index first; originals only when an entry needs verbatim consumption. Canonical record + per-source SHA-256: `local/index/manifest.yaml`. Spec: `core/index-protocol.md`.

## SDLC artefacts

| Concept | Path |
|---|---|
| TODO file (root) | `TODO` |
| Nested TODO files | (none) |
| CI workflows | `.github/workflows/_build-and-push-image.yml`, `api.yml`, `fetcher.yml`, `frontend.yml`, `gateway.yml`, `demo-gha.yml`, `demo-driver.yml`, `integration.yml`, `release.yml`, `scripts.yml`, `pages.yml` (11 total) |
| Composite actions | `.github/actions/notify/` (CI/CD notify step; tests scaffolded under `tests/`) |
| Issue + PR templates | `.github/ISSUE_TEMPLATE/{bug-report.md,feature-request.md,config.yml}` + `.github/PULL_REQUEST_TEMPLATE.md` |
| Local-dev startup script | `dev_env/start.ps1` (-Scaled / -Fetcher / -Demo / -AllowMissingGhaToken / -Integration switches) |
| Local-dev stop script | `dev_env/stop.ps1` (-Volumes; tears down both local + scaled compose) |
| Local-dev orchestration | `dev_env/docker-compose.local.yml` (override on `install/docker-compose.release.yml` per ADR-0010), `dev_env/docker-compose.scaled.yml` (standalone NFR-05 variant) |
| Release-install orchestration | `install/docker-compose.release.yml` (canonical service inventory), `install/install.ps1`, `install/install.sh`, `install/uninstall.ps1`, `install/uninstall.sh` |
| .NET tool manifest | `.config/dotnet-tools.json` (pinned `dotnet-ef` 10.0.0 for CI EF migration script generation) |
| Test directories | `testing/functional/Dashboard.Functional.Tests/` (xUnit), `testing/integration/Dashboard.Integration.Tests/` (xUnit + CR-0012 cross-stack), `testing/e2e/` (Playwright), `testing/mockup-visual/` (Playwright), `testing/scripts/` (Pester + bats), `backend/**/Dashboard.*.Tests/` (xUnit unit + per-tier integration including new `Dashboard.Api.Tests/` host tests + `Dashboard.Fetcher.Tests/`) |
| Fixtures directory | `testing/fixtures/` (`seed-data.json`) + `testing/fixtures/gha/` (JVM WireMock mappings + scenarios + demo bundle per CR-0012 / CR-0013 - `mappings/`, `scenarios/<state-id>/`, `scenarios/_cross-cutting/`, `demo/mappings/`, `demo/mappings/statuses/`, `demo/ticks/`) |
| Config directory | `testing/config/` (`local.json` - declarative seed config consumed by `testing/scripts/seed.ps1`) |
| Seed / cleanup scripts | `testing/scripts/seed.ps1`, `dev_env/stop.ps1` |
| Docs site config | `docs/_config.yml`, `docs/Gemfile` |

## Repository structure (auto-detected)

```
deployment-dashboard/
|-- backend/             .NET 10 - microservices architecture per ADR-0006; container co-location of Write + Read API per ADR-0002 mechanics
|   |-- api/             host (Dashboard.Api + Dashboard.Api.Tests) - single Dockerfile, single ACA container target; applies EF migrations on startup per ADR-0009
|   |-- write-api/       Write endpoint group library (Dashboard.WriteApi) + tests
|   |-- read-api/        Read endpoint group library (Dashboard.ReadApi) + tests
|   |-- shared/          DbContext, entities, DTOs, migrations, API-key middleware, NOTIFY/LISTEN, SSE writer + tests
|   |-- fetcher/         Pull-mode adapter library (Dashboard.Fetcher + Dashboard.Fetcher.Tests) per CR-0009 - GHA adapter, scheduler, typed write-API client
|   `-- fetcher-host/    Fetcher worker host (Dashboard.Fetcher.Host) + Dockerfile - separate ACA container target
|-- frontend/            Angular 20 workspace - dashboard/ (shell), matrix/, drawer/, shared/
|-- gateway/             nginx reverse proxy - single public ingress (port 8080)
|   |-- demo-gha/        Demo-gha image source (Dockerfile + bakes testing/fixtures/gha/demo/ as JVM WireMock mappings per CR-0013)
|   `-- demo-driver/     Demo-driver sidecar source (Dockerfile + entrypoint.py - Python ticker driving demo-gha admin API per CR-0013 §3e amendment / issue #46)
|-- install/             Release-install stack - docker-compose.release.yml (canonical) + install.ps1/.sh + uninstall.ps1/.sh; dev_env layers via `-f` merge per ADR-0010
|-- dev_env/             Contributor stacks (docker-compose.local.yml = override; docker-compose.scaled.yml = standalone NFR-05) + PowerShell start/stop scripts
|-- docs/                architecture.md, WBS.md, ci-cd-integration.md, ci-cd-pipelines.md, integration-tests.md, install.md, getting-started.md, features.md, index.md, _config.yml, Gemfile, adr/, cr/, ui/ (option docs + mockups/ subdir), assets/
|-- testing/             functional/ (xUnit), integration/ (xUnit cross-stack CR-0012), e2e/ (Playwright), mockup-visual/ (Playwright), scripts/ (Pester + bats), fixtures/ (incl. fixtures/gha/ - mappings + scenarios + demo bundle), config/
|-- .agents/             ginee framework install (vendor-neutral)
|-- .claude/             Claude Code adapter (skills + agents)
|-- .config/             .NET tool manifest (dotnet-ef pin)
|-- .github/             actions/notify/ (composite), workflows/ (11 workflows), ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md
|-- CLAUDE.md            Project-instruction file (always-loaded)
|-- README.md            Public landing (badge bar, quickstart, mermaid C4)
|-- CONTRIBUTING.md      Contributor guide + ginee orchestration pointer
|-- SECURITY.md          Disclosure + scope (NFR-04 anchored)
|-- CODE_OF_CONDUCT.md   Community standard
|-- CHANGELOG.md         Keep-a-Changelog (Unreleased; pre-1.0)
|-- LICENSE              MIT
`-- TODO                 Repo-root TODO (MVP + Phase 2.0)
```

## Detected tiers + role attributions

| Tier | Path | Default cardinal owner |
|---|---|---|
| Server (API host + composed groups + shared) | `backend/api/`, `backend/write-api/`, `backend/read-api/`, `backend/shared/` | `backend-engineer` |
| Server (Fetcher) | `backend/fetcher/`, `backend/fetcher-host/` | `backend-engineer` |
| Client | `frontend/` | `frontend-engineer` |
| Mockup | `docs/ui/mockups/deployment-dashboard.html` + `docs/ui/mockups/*.html` variants | `frontend-engineer` |
| Gateway | `gateway/` (nginx + Dockerfile) | `devops-engineer` |
| Gateway demo sidecars | `gateway/demo-gha/`, `gateway/demo-driver/` | `devops-engineer` (Dockerfiles + Python entrypoint) + `qa-engineer` (bundle content under `testing/fixtures/gha/demo/`) |
| Local-dev orchestration | `dev_env/` | `devops-engineer` |
| Release-install orchestration | `install/` | `devops-engineer` |
| Infrastructure (planned) | `infrastructure/` (absent) | `devops-engineer` |
| CI workflows | `.github/workflows/` | `devops-engineer` |
| Composite actions | `.github/actions/` | `devops-engineer` |
| Issue + PR templates | `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` | `team-lead` (D14 governance) + `devops-engineer` (form mechanics) |
| Tests | `testing/` + `backend/**/Dashboard.*.Tests/` | `qa-engineer` |
| WireMock fixtures + scenarios | `testing/fixtures/gha/` | `qa-engineer` |
| Architecture docs | `docs/architecture.md`, `docs/adr/`, `docs/WBS.md` | `solution-architect` |
| Change records | `docs/cr/` | `team-lead` (per D25 - coordination decisions) with `solution-architect` review |
| UI option design records | `docs/ui/*.md` (option docs) | `solution-architect` (semantics) + `frontend-engineer` (proposes option mockups) |
| User-facing docs (Jekyll site) | `docs/index.md`, `docs/getting-started.md`, `docs/install.md`, `docs/features.md`, `docs/integration-tests.md`, `docs/_config.yml`, `docs/Gemfile`, `docs/assets/` | co-owned per D25 - see `local/bindings.md § Source-of-truth ownership` |
| Root governance files | `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `LICENSE` | `team-lead` (per D25 - project-instruction class) with `solution-architect` architectural-coherence review |
| .NET tool manifest | `.config/dotnet-tools.json` | `devops-engineer` (CI tooling pin) + `backend-engineer` (consumer) |

**Defaults don't fit?** Refine in `local/bindings.md`.

## Active roles

| Role | Status |
|---|---|
| `team-lead` | always active |
| `solution-architect` | active - SAD + 10 ADRs + 13 CRs + WBS + UI option docs + integration-tests doc all present |
| `frontend-engineer` | active - Angular 20 workspace + mockup |
| `backend-engineer` | active - ASP.NET Core API host + write/read library surfaces + EF migrations + Fetcher worker tier |
| `devops-engineer` | active - Dockerfiles + compose (release + dev + scaled) + gateway + demo sidecars + Terraform planned + 11 GH Actions workflows + composite + Jekyll Pages workflow |
| `qa-engineer` | active - functional + integration (CR-0012) + e2e + mockup-visual + fixtures (incl. WireMock fixtures + demo bundle) + seed/scripts + Pester + bats |
| `ai-engineer` | always available (between-phase invocation) |

## Project-local roles (under `local/roles/`)

| Role file | Description (from front-matter) |
|---|---|
| `local/roles/devops-engineer.md` | Project-local extension to the cardinal `devops-engineer` charter. Captures deployment-dashboard-specific craft notes - cross-OS PowerShell rules, gh CLI prereqs + scope hierarchy, anonymous-vs-authed fetcher transport, CI-defect history, gotcha patterns. |

## Specialist suggestions (from `extras/roles/`)

| Suggested specialist | Trigger |
|---|---|
| `security-engineer` | Auth surface (X-Api-Key middleware on Write group only) + dev-token vs prod-secret split documented in `dev_env/README.md` + GHA token scope hierarchy + anonymous-mode transport split in `local/roles/devops-engineer.md` - low surface (internal-only per NFR-04) but discrete; suggest only on demand |
| `sre` | Azure Container Apps multi-replica deploy + NFR-05 stateless requirement + scaled compose variant for fan-out validation + 11 component CI workflows - small ops surface today; recommend if/when prod cutover lands |

## External-catalog candidates (awesome-copilot)

| Specialist | Source | One-line | Why considered |
|---|---|---|---|
| accessibility | `agents/accessibility.agent.md` (github/awesome-copilot) | WCAG 2.1/2.2 a11y expert for Angular SPAs | NFR-09 reflow invariant + six box states + history drawer + light/dark/auto theme - Angular SPA could benefit from a dedicated a11y reviewer. Not covered by `frontend-engineer` cardinal. Status: previously surfaced, not enabled. |

Other awesome-copilot matches (.NET / Angular / API Architect / AI Team Dev / AI Team QA / ADR Generator) were dropped as redundant with cardinal coverage. Status preserved from prior discovery.

## Out-of-scope / non-applicable

| Item | Reason |
|---|---|
| `mobile-engineer` suggestion | No mobile tier - web SPA only |
| `ml-engineer` suggestion | No ML components |
| `data-engineer` suggestion | EF Core migrations + Postgres adequately owned by `backend-engineer` |
| `technical-writer` external-agent suggestion | Docs co-owned per D25 between SA + tier-engineers + team-lead; Jekyll surface is small (5 nav pages + indexes); not enabled |
| `python-engineer` external-agent suggestion | Single Python sidecar (`gateway/demo-driver/entrypoint.py`, ~ standalone script consuming `requests`-style HTTP); owned by `devops-engineer` (same governance as a bash entrypoint) |

## Staleness watchlist

| Trigger | Where |
|---|---|
| `infrastructure/` directory appears (Terraform lands) | repo root |
| Backend layout changes - co-location of Write + Read fully removes legacy top-level dirs, or a future move from co-location to per-service images lands (per ADR-0002 mechanics, ADR-0006 framing) | `backend/` |
| Fetcher gains a second adapter beyond GHA (e.g. ADO, Jenkins) | `backend/fetcher/` |
| New top-level directory not listed above | repo root |
| New tier-1 doc class under `docs/` (e.g. runbooks, threat-model, scenarios) | `docs/` |
| New mockup file outside `docs/ui/mockups/` | `docs/ui/` |
| New CI workflow file (cron / scanning / dogfooding hook) | `.github/workflows/` |
| `.gitattributes` added (cross-OS EOL discipline) | repo root - see `local/roles/devops-engineer.md` |
| New root governance file (e.g. `GOVERNANCE.md`, `MAINTAINERS.md`) | repo root |
| Jekyll docs site evolves beyond Just the Docs (custom layouts / plugins / assets explosion) | `docs/` |
