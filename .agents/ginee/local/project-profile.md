# Project Profile — Deployment Dashboard

**Generated:** 2026-05-18 by `project-manager`
**Source:** initial discovery
**Revision:** 1

## Domain

Real-time deployment dashboard. Renders a services × environments matrix sourced from CI/CD pipeline events (any tool that can `POST /api/deployments`), with per-slot history, six visual box states, configurable views (Detailed / Compact / Glance / Focus), three layouts (Matrix / Swim-lane / Workflow-rows), per-service topology derivation, and light / dark / auto theme. Internal read-only tooling (NFR-04); no RBAC; no public ingress. Target hosting: Azure Container Apps + Azure Postgres Flexible, ≤ $30/month.

**Cited from:** `docs/architecture.md:9-46` (Problem Statement, Goals, FRs) + `docs/WBS.md:1-3` + `dev_env/README.md:5-29` + `frontend/README.md:1-5`.

## Tech stack

| Layer | Choice | Source of evidence |
|---|---|---|
| Primary language(s) | C# (.NET 10) + TypeScript | `backend/api/Dashboard.Api/Dashboard.Api.csproj:4`, `frontend/package.json:14-42` |
| Server runtime | .NET 10 (`net10.0`) | `backend/api/Dashboard.Api/Dashboard.Api.csproj:4` |
| Server framework | ASP.NET Core Minimal API (`Microsoft.NET.Sdk.Web`) | `backend/api/Dashboard.Api/Dashboard.Api.csproj:1`, SAD §7 |
| Server ORM / persistence | EF Core 10 (Npgsql) + EF migrations in `shared/Dashboard.Shared/Migrations/` | `backend/README.md:18-22,69-75` |
| Data store | PostgreSQL 16 (prod); SQLite in-memory for unit tests | `dev_env/docker-compose.local.yml`, `backend/README.md:30-33` |
| Real-time mechanism | SSE (`GET /api/stream`) over PostgreSQL `LISTEN/NOTIFY` | SAD §7, `backend/README.md:123` |
| Auth approach | Static API-key middleware (`X-Api-Key`) on the Write endpoint group only; Read group unauthenticated by design | SAD §8, WBS §1.1.4, `backend/README.md:57` |
| Client framework | Angular 20 (standalone components, zoneless) | `frontend/package.json:14-29`, `frontend/README.md:1` |
| Client state | NgRx Signal Store (`@ngrx/signals` 20) | `frontend/package.json:21`, WBS §1.3.2 |
| Client styling | Tailwind CSS 3.4 | `frontend/package.json:40`, `frontend/tailwind.config.js` |
| Container runtime | Docker (Docker Compose v2 for local) | `dev_env/docker-compose.local.yml`, `backend/api/Dockerfile`, `frontend/dashboard/Dockerfile`, `gateway/Dockerfile` |
| Orchestration | Docker Compose for local; Azure Container Apps for prod (per SAD §7) | `dev_env/docker-compose.*.yml`, SAD §7 |
| IaC | Terraform `azurerm` planned per WBS §4 / NFR-06 (no `infrastructure/` directory present yet) | WBS §4.1-4.3 — (none on disk) |
| CI/CD | GitHub Actions planned (`.github/actions/notify/` composite action present; `.github/workflows/` does NOT exist) | `.github/actions/notify/`, WBS §1.4.2 |
| Test runners | xUnit (.NET) + Karma/Jasmine (Angular) + Playwright (e2e + mockup-visual) + Pester (PowerShell scripts) | `backend/*/Dashboard.*.Tests/*.csproj`, `frontend/package.json:36-39`, `testing/e2e/playwright.config.ts`, `testing/mockup-visual/playwright.config.ts`, WBS §3.2 |

## Architecture artefacts (referenced — not copied)

| Concept | Path | Status |
|---|---|---|
| Architecture doc | `docs/architecture.md` | present |
| Mockup | `docs/ui/deployment-dashboard.html` | present |
| API contract | inside `docs/architecture.md` §7 (no standalone file) | present |
| ADR directory | `docs/adr/` (ADR-0001, ADR-0002 [superseded by ADR-0006 on framing — mechanics-of-record], ADR-0003, ADR-0004, ADR-0005, ADR-0006 + README) | present |
| CR directory | `docs/cr/` (CR-0001..CR-0010 + README) | present |
| Diagrams directory | (none — diagrams embedded as ASCII art in `docs/architecture.md`) | absent |
| UI options directory | `docs/ui/` (compact / focus-layout / theme / tree-topology / version-display option docs) | present |
| Operational companion | `docs/ci-cd-integration.md` | present |
| Work breakdown | `docs/WBS.md` | present |
| Project-instruction file | `CLAUDE.md` | present |

Source-doc summaries land in `local/index/` (one file per detected doc class — `architecture.idx`, `adr-index.idx`, `cr-index.idx`, `mockup-index.idx`, `api-matrix.yaml`, `ui-states.yaml`, `constraints.yaml`, `glossary.idx`, plus any adopter-specific class such as `ui-options-index.idx`). Roles read the index first; originals only when an entry needs verbatim consumption. Canonical record + per-source SHA-256: `local/index/manifest.yaml`. Spec: `core/index-protocol.md`.

## SDLC artefacts

| Concept | Path |
|---|---|
| TODO file (root) | `TODO` |
| Nested TODO files | (none) |
| CI workflows | (none — `.github/workflows/` does not exist; planned per WBS §3-4) |
| Composite actions | `.github/actions/notify/` (CI/CD notify step per WBS §1.4.2) |
| Local-dev startup script | `dev_env/start.ps1` |
| Local-dev orchestration | `dev_env/docker-compose.local.yml`, `dev_env/docker-compose.scaled.yml` |
| Test directories | `testing/functional/`, `testing/e2e/`, `testing/mockup-visual/`, `testing/scripts/`, `backend/*/Dashboard.*.Tests/` |
| Fixtures directory | `testing/fixtures/` (`seed-data.json`) |
| Seed / cleanup scripts | `testing/scripts/seed.ps1`, `dev_env/stop.ps1` |

## Repository structure (auto-detected)

```
deployment-dashboard/
├── backend/         .NET 10 — co-located Write + Read API services (Dashboard.sln + api/ host + write-api/, read-api/, shared/ libraries; microservices architecture per ADR-0006, co-location mechanics per ADR-0002)
├── frontend/        Angular 20 workspace — dashboard/ (shell), matrix/, drawer/, shared/
├── gateway/         nginx reverse proxy — single public ingress (port 8080)
├── install/         Release-install stack — docker-compose.release.yml (canonical service inventory) + install.ps1/.sh + uninstall.ps1/.sh; dev_env layers on this via `-f` merge per ADR-0010
├── dev_env/         Docker Compose contributor stacks (docker-compose.local.yml = override on install/release.yml; docker-compose.scaled.yml = standalone NFR-05 variant) + PowerShell start/stop scripts
├── docs/            architecture.md, WBS.md, ci-cd-integration.md, adr/, cr/, ui/ (mockup + option docs)
├── testing/         functional (xUnit), e2e (Playwright), mockup-visual (Playwright), scripts (Pester + seed), fixtures
├── .agents/         ginee framework install (vendor-neutral)
├── .claude/         Claude Code adapter (skills + agents)
├── .github/         actions/notify/ (composite action) — no workflows/ yet
├── CLAUDE.md        Project-instruction file (always-loaded)
└── TODO             Repo-root TODO list (MVP + Phase 2.0)
```

## Detected tiers + role attributions

| Tier | Path | Default cardinal owner |
|---|---|---|
| Server | `backend/` | `backend-engineer` |
| Client | `frontend/` | `frontend-engineer` |
| Mockup | `docs/ui/deployment-dashboard.html` | `frontend-engineer` |
| Gateway | `gateway/` | `devops-engineer` |
| Local-dev orchestration | `dev_env/` | `devops-engineer` |
| Infrastructure (planned) | `infrastructure/` (absent) | `devops-engineer` |
| CI workflows (planned) | `.github/workflows/` (absent) | `devops-engineer` |
| Composite actions | `.github/actions/` | `devops-engineer` |
| Tests | `testing/` + `backend/**/Dashboard.*.Tests/` | `qa-engineer` |
| Architecture docs | `docs/architecture.md`, `docs/adr/`, `docs/cr/`, `docs/ui/*.md` (option docs), `docs/WBS.md`, `docs/ci-cd-integration.md` | `solution-architect` |

**Defaults don't fit?** Refine in `local/bindings.md`.

## Active roles

| Role | Status |
|---|---|
| `project-manager` | always active |
| `solution-architect` | active — SAD + ADRs + CRs + WBS + UI option docs all present |
| `frontend-engineer` | active — Angular 20 workspace + mockup |
| `backend-engineer` | active — ASP.NET Core API host + write/read library surfaces + EF migrations |
| `devops-engineer` | active — Dockerfiles + compose + gateway + Terraform planned + GH Actions composite present |
| `qa-engineer` | active — functional + e2e + mockup-visual + fixtures + seed/scripts |
| `ai-engineer` | always available (between-phase invocation) |

## Project-local roles (under `local/roles/`)

| Role file | Description (from front-matter) |
|---|---|
| `local/roles/devops-engineer.md` | Project-local extension to the cardinal `devops-engineer` charter. Captures deployment-dashboard-specific craft notes — cross-OS PowerShell rules, CI-defect history, and gotcha patterns that benefit this project's devops dispatches but don't belong on the framework-upstream side. |

## Specialist suggestions (from `extras/roles/`)

| Suggested specialist | Trigger |
|---|---|
| `security-engineer` | Auth surface (X-Api-Key middleware on Write group only) + dev-token vs prod-secret split documented in `dev_env/README.md:24-29` — low surface (internal-only per NFR-04) but discrete; suggest only on demand |
| `sre` | Azure Container Apps multi-replica deploy + NFR-05 stateless requirement + scaled compose variant for fan-out validation — small ops surface today; recommend if/when prod cutover lands |

## External-catalog candidates (awesome-copilot)

| Specialist | Source | One-line | Why considered |
|---|---|---|---|
| accessibility | `agents/accessibility.agent.md` (github/awesome-copilot) | WCAG 2.1/2.2 a11y expert for Angular SPAs | NFR-09 reflow invariant + six box states + history drawer — Angular SPA could benefit from a dedicated a11y reviewer. Not covered by `frontend-engineer` cardinal. |

Other awesome-copilot matches (.NET / Angular / API Architect / AI Team Dev / AI Team QA / ADR Generator) were dropped as redundant with cardinal coverage.

## Out-of-scope / non-applicable

| Item | Reason |
|---|---|
| `mobile-engineer` suggestion | No mobile tier — web SPA only |
| `ml-engineer` suggestion | No ML components |
| `data-engineer` suggestion | EF Core migrations + Postgres adequately owned by `backend-engineer` |

## Staleness watchlist

| Trigger | Where |
|---|---|
| `infrastructure/` directory appears (Terraform lands) | repo root |
| `.github/workflows/` populates with CI workflow files | repo root |
| Root `README.md` lands | repo root |
| New top-level directory not listed above | repo root |
| New tier-1 doc class under `docs/` (e.g. runbooks, threat-model, scenarios) | `docs/` |
| Backend layout changes — `backend/api/` co-location of Write + Read services (per ADR-0006 framing, ADR-0002 mechanics) fully removes legacy top-level dirs, or a future move from co-location to per-service images lands | `backend/` |
