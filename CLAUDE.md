# Deployment Dashboard — Project Instructions

## Source of truth (read before any work)

Authoritative files — every agent reads them:

| File | Role | Edited by |
|---|---|---|
| `docs/deployment-dashboard-architecture.md` (SAD) | Requirements, constraints, components, data model, API contract, decisions, WBS | `solution-architect` |
| `docs/deployment-dashboard.html` (mockup) | Visual + behavioural contract for the SPA | `frontend-engineer` (authoring); `solution-architect` (governance review, no edits) |

Rules:
- Read the relevant section of both before designing or implementing anything.
- Never invent behaviour, fields, or constraints absent from these docs.
- Conflict between request / instinct / existing code and the docs → **stop, flag for the owning agent**. Doc update lands first, code follows.
- Conflict between the two docs:
  - Visual / interactive behaviour → **mockup wins**; flag the SAD for update.
  - API / data / stack / infrastructure → **SAD wins**; flag the mockup for update.
- SAD / `CLAUDE.md` / `docs/ci-cd-integration.md` / ADRs → only `solution-architect` writes. Other agents propose in their final reports.
- Mockup → only `frontend-engineer` writes. SAD-level changes (new view, attribute, invariant) require `solution-architect` to land the SAD update first, then `frontend-engineer` mirrors.

## Process model

This project follows the process defined in [`docs/engineering-process.md`](docs/engineering-process.md). Read it before any work. Key sections:

- Dispatch & parallelism rules
- Task lifecycle (Phases 1–8)
- Engineering principles (declarative-over-imperative + test-oracles-can-be-wrong)
- Strict-domain rule + cross-domain bug cycle + cross-agent handoff
- TODO-driven workflow
- Documentation style

## Repository structure

Top-level directories — keep work in the directory that matches the concern. No files outside these directories without a doc update.

**Component-per-subdirectory rule:** every deployable / independently-versioned component → its own subdirectory under `backend/` or `frontend/`. Shared code between same-tier components → `shared/` subdirectory. No flat single-project layout.

```
deployment-dashboard/
├── backend/                # .NET 10 modular-monolith host
│   ├── api/                # ASP.NET Core executable (only Dockerfile)
│   ├── write-api/          # Library — write endpoint group
│   ├── read-api/           # Library — read endpoint groups
│   ├── shared/             # EF Core, NOTIFY/LISTEN, middleware
│   └── Dashboard.sln
├── frontend/               # Angular 20 workspace (modular monolith)
│   ├── dashboard/          # App project + nginx container artefacts
│   ├── matrix/             # Feature library — pipeline matrix
│   ├── drawer/             # Feature library — history drawer
│   ├── shared/             # Signal Store, API client, SSE, models
│   ├── angular.json
│   └── tailwind.config.js
├── gateway/                # nginx reverse proxy (public ingress)
│   ├── Dockerfile
│   └── nginx.conf
├── infrastructure/         # Terraform modules + dev/prod workspaces
├── dev_env/                # Local Compose + start.ps1 / stop.ps1
├── testing/                # All test code outside per-project units
├── docs/                   # Authoritative specs
├── .github/                # GitHub Actions workflows + composite actions
├── .claude/                # Agent definitions + Claude Code settings
└── CLAUDE.md
```

### `backend/`

*Authoritative architecture: SAD §7 "Backend module architecture" + §10 Decision 11. This section adds only repo-layout invariants not in the SAD.*

- Owned by `backend-engineer`. One deployable container (image built from `backend/api/`); two logical surfaces; libraries kept separate so a future re-split is host-project + gateway-config only.
- `api/` is the **only** ASP.NET Core executable — only backend `Dockerfile`. `write-api/` and `read-api/` are **library projects** (`Microsoft.NET.Sdk`, `OutputType` library) — they expose endpoint-group extension methods (`MapWriteEndpoints`, `MapReadEndpoints`); no `Program.cs`, no Dockerfile.
- Dependency rules:

  | Project | May reference |
  |---|---|
  | `api/` | `write-api/`, `read-api/`, `shared/` |
  | `write-api/` | `shared/` only — never `read-api/` or `api/` |
  | `read-api/` | `shared/` only — never `write-api/` or `api/` |
  | `shared/` | none of the above |
- `shared/` holds: EF Core `DbContext`, entities, migrations, NOTIFY/LISTEN abstractions, `ApiKeyMiddleware`. One migration set serves both surfaces.
- API-key middleware applied **only** to the Write endpoint group via `MapGroup("/api").RequireApiKey()` in `api/Program.cs`. No global `UseMiddleware<ApiKeyMiddleware>()`. Read group is unauthenticated (SAD §8).
- API container serves **JSON only** — no `wwwroot`, no static-file middleware. SPA hosting lives in `frontend/dashboard/`.
- SQLite-in-memory unit tests live alongside their source project.
- No third API surface — new responsibility → doc update first. Re-splitting the host into two container apps is a future option (SAD §7 "Future split — trigger conditions"); engineers do NOT pre-split.

### `frontend/`

*Authoritative architecture: SAD §7 "Module architecture". This section adds only repo-layout invariants.*

- Angular source owned by `frontend-engineer`; `dashboard/Dockerfile` + `dashboard/nginx.conf` owned by `devops-engineer`.
- Dependency rules:

  | Source | May reference |
  |---|---|
  | Feature libraries (`matrix/`, `drawer/`) | `shared/` only — never each other or `dashboard/` |
  | `shared/` | no feature library |
  | `dashboard/` | feature libraries + `shared/` |
- New feature area → new library under `frontend/`, never a folder inside `dashboard/`. Cross-cutting concerns → `shared/`.
- Enforcement: `@angular-eslint/no-restricted-imports` + workspace `tsconfig.base.json` path mappings.
- Build: `ng build dashboard` → one SPA bundle → copied into `frontend/dashboard/Dockerfile`'s nginx image.
- `frontend/dashboard/` container serves static assets + SPA history fallback only — **no upstream proxying** (the App Gateway does that).

### `gateway/`

- Owned by `devops-engineer`. Single public-facing nginx reverse proxy; only container with public ingress (host port `8080` locally; ACA public ingress in Azure).
- Routing (path + method-based; per SAD §7). Both API surfaces resolve to a single `api` upstream today; the path+method matrix is preserved so a future re-split is config-only (SAD §7 "Future split"):

  | Method + Path | Upstream | Surface |
  |---|---|---|
  | `POST /api/deployments` | `api:8080` | Write |
  | `PATCH /api/config/topology` | `api:8080` | Write (admin) |
  | `GET /api/*`, `GET /api/stream`, `GET /health` | `api:8080` | Read |
  | Everything else | `dashboard:80` | n/a |
- SSE pass-through requirements:
  - `proxy_buffering off`
  - `proxy_cache off`
  - `proxy_read_timeout 1h`
  - forward `Last-Event-ID` and `X-Accel-Buffering: no`
- Zero per-request state — adding routes requires no backend or frontend changes.

### `infrastructure/`

- Owned by `devops-engineer`. `terraform/modules/` → reusable modules; `terraform/envs/{dev,prod}/` → per-environment roots. Terraform state lives in Azure Storage — **never** in the repo.

### `dev_env/`

- Owned by `devops-engineer`. Anything a developer runs to bring up a local stack. Compose files reference images built from `backend/api/`, `frontend/dashboard/`, and `gateway/`.

### `testing/`

- Owned by `qa-engineer`. Layered organisation:

  | Subdirectory | Contents |
  |---|---|
  | `testing/functional/` | API/integration tests |
  | `testing/e2e/` | Playwright specs + Gherkin scenarios |
  | `testing/scripts/` | PowerShell seed/cleanup/notify/init |
  | `testing/pester/` | Pester suites for non-trivial PowerShell |
  | `testing/fixtures/` | Canonical 6-state fixtures |

## Agents — deterministic routing

Six subagents in `.claude/agents/`. Route work per the table — do not do agent-owned work yourself in the main thread.

| Agent | Concerns |
|---|---|
| `solution-architect` | SAD edits; mockup governance review (no edits); `docs/ci-cd-integration.md`; `CLAUDE.md` rules / routing / repo-structure; ADRs and architectural artefacts under `docs/`; coherence audits between SAD and mockup; tie-breaker resolution. |
| `backend-engineer` | ASP.NET Core Minimal APIs (Write + Read surfaces + the `api/` host); EF Core 10 entities, `DbContext`, migrations; PostgreSQL schema, indexes, matrix/history SQL, `LISTEN/NOTIFY`, pruning job; API-key middleware, SSE endpoint, `Last-Event-ID` reconnect; matrix derivation (`lastSuccessful`, `previousFailed`), wire-format JSON contract. |
| `frontend-engineer` | Mockup (`docs/deployment-dashboard.html`) — HTML/CSS/JS/Alpine.js/SVG/embedded fixture edits; Angular 20 standalone components, zoneless change detection; NgRx Signal Store, derived signals, slot-update dispatch; Tailwind layout, 6 box states, hover highlight, history drawer, filters, stats bar; browser-native `EventSource` client and reconnect logic. |
| `qa-engineer` | Functional / API tests against running stack; Playwright e2e + scenario specs; `seed.ps1`, `cleanup.ps1`, `test-notify.ps1`, `init-data.ps1`; smoke suite (post-deploy validation); Pester tests for non-trivial PowerShell or composite-action logic; mockup-visual harness assertions. |
| `devops-engineer` | Dockerfiles, `docker-compose.*.yml`, scaled compose; Terraform (ACR, ACA, Postgres Flexible B1ms, Key Vault, networking); GitHub Actions CI + release workflows, ACA revision updates; composite `notify` action under `.github/actions/notify/`; secret provisioning, cost tracking against ≤ $30/month cap. |
| `ai-engineer` | AI-asset and documentation optimization for LLM context economy: compaction, file splitting / lazy-loading topology, cross-referencing, vocabulary normalization, prompt-structure tightening across `.claude/agents/*.md`, `CLAUDE.md`, `docs/*.md`, READMEs, ADRs, skills. |

Task spans two agents (e.g. wire contract touches backend + frontend) → dispatch to both per the dispatch rules in [`docs/engineering-process.md`](docs/engineering-process.md) § Dispatch & parallelism rules.

## Project role boundaries

Project-specific forbidden role-crossings (the principle is in [`docs/engineering-process.md`](docs/engineering-process.md) § Strict-domain rule). Each row is a hard stop — propose a hand-off in the final report instead.

| Agent | Must NOT edit |
|---|---|
| `solution-architect` | Mockup HTML/CSS/JS/Alpine.js/SVG; backend C# (controllers, EF entities, migrations, middleware); Angular code (components, services, store, templates); Terraform, Dockerfiles, `docker-compose.*.yml`, `.github/` CI workflows. |
| `frontend-engineer` | Backend C# code (including SQL queries inside Read API endpoints); Terraform, Dockerfiles, `.github/` CI workflows. |
| `backend-engineer` | Angular code, Tailwind, `docs/deployment-dashboard.html` (mockup); Terraform, Dockerfiles, `.github/` CI workflows. |
| `devops-engineer` | `.csproj`, NuGet config, any C# source to dodge a build issue; Angular code or Tailwind config. |
| `qa-engineer` | Mockup HTML, backend production C#, frontend production TypeScript. QA owns test code, fixtures, scenarios, runner scripts — never production surfaces. |
| `ai-engineer` | Production code (`backend/`, `frontend/`, `gateway/`, `infrastructure/`, `.github/`, `testing/`); mockup HTML/CSS/JS; configuration files (`appsettings.json`, `*.tfvars`, `docker-compose.*.yml`); CI workflows. Must NOT add / remove / reword any rule, routing entry, invariant, FR/NFR, or governance decision (semantic content is `solution-architect`'s). Must NOT delete a doc without SA approval. Must NOT split a file without updating every dependent cross-reference in the same pass. |

## Stack — non-negotiable (per SAD §6, §7)

| Layer | Choice |
|---|---|
| Backend | C# / .NET 10, ASP.NET Core Minimal API, EF Core 10 + Npgsql |
| Storage | PostgreSQL 16 (prod + dev); SQLite in-memory (unit tests only) |
| Real-time | PostgreSQL `LISTEN/NOTIFY` + SSE (`text/event-stream`) |
| Frontend | Angular 20 (standalone, zoneless), NgRx Signal Store, Tailwind CSS |
| Edge | nginx (`gateway/`) — single public ingress, no CORS, SSE-tuned |
| Container runtime | OCI-compliant, port 8080 (no Azure Functions / proprietary bindings) |
| Hosting | Azure Container Apps + Azure Container Registry + Azure Database for PostgreSQL Flexible Server (B1ms) + Azure Key Vault |
| IaC | Terraform (`azurerm` ≥ 4.x), state in Azure Storage |
| CI/CD | GitHub Actions |

**Do not introduce:**
- SignalR
- Redis
- In-memory event buses
- MediatR
- AutoMapper
- FluentValidation
- Material / PrimeNG / Bootstrap
- Sass / Less
- Azure Functions
- Sticky sessions
- In-process SSE fan-out across instances
- Any cloud-proprietary compute model

## Hard constraints (from NFRs and §6)

- **NFR-01 / §6** — Azure-only hosting.
- **NFR-02 / §6** — ≤ $30/month total infrastructure cost.
- **NFR-03** — Live updates within 5 s of a successful ingest.
- **NFR-04 / §6** — Internal-only; no public internet exposure.
- **NFR-05** — Stateless backend; no sticky sessions.
- **NFR-06** — All infrastructure defined in Terraform.
- **NFR-07** — ≥ 90 days of deployment history retained (default 365).
- **NFR-08** — Dashboard loads in a browser with no build step (SPA pre-built into the image).
- **§6 platform agnosticism** — Backend deployable as a standard container on any OCI-compliant host.

Task that would violate any → stop, propose a doc update first.

## Out of scope (do not implement)

- Triggering or managing deployments — the system is read-only / notification-only.
- Querying any CI/CD tool — push-based only.
- Multi-organisation or multi-repo aggregation.
- Role-based access control on read endpoints (delegated to a sidecar per §8).
- The v2.0 desktop Notification Client is planned but not part of MVP. Do not implement unless explicitly requested.
