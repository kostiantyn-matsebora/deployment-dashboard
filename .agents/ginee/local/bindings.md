# Project Bindings — Deployment Dashboard

## Source-of-truth ownership

**Default reads:** `local/index/*` per `core/index-protocol.md`. The table below is a **governance map** — who edits each source + where the verbatim text lives when an index entry points to "see source." NOT a per-dispatch read list; pulling raw doc paths into every dispatch defeats the load-on-demand contract.

| File | Role | Edited by |
|---|---|---|
| `docs/architecture.md` | Requirements (FR/NFR), constraints, components, data model, API, §7 invariants, §10 decisions | `solution-architect` |
| `docs/ui/deployment-dashboard.html` | Visual + behavioural client contract (palette, six box states, NFR-09 reflow invariant) | mockup owner (`frontend-engineer`); `solution-architect` reviews, no edits |
| `docs/adr/` | Architecture Decision Records (ADR-0001 topology / ADR-0002 co-location mechanics — **superseded on framing by ADR-0006** / ADR-0003 theme persistence + FOIT bootstrap / ADR-0004 opaque-cursor + fetcher non-co-location / ADR-0005 release-install migration / ADR-0006 microservices architecture + container co-location) | `solution-architect` |
| `docs/cr/` | Change Requests (CR-0001..CR-0008) — SAD-level content owned by each CR after SAD freeze | `solution-architect` |
| `docs/ui/*.md` | UI option docs (compact / focus-layout / theme / tree-topology / version-display) — mockup-supporting design records | `solution-architect` (semantics) + `frontend-engineer` (proposes option mockups) |
| `docs/WBS.md` | Operational work-breakdown — per-phase items, MVP / Phase 2.0 split | `solution-architect` |
| `docs/ci-cd-integration.md` | Operational companion to SAD §7 — payload + snippet detail (inbound: adopter pipelines push TO us) | `solution-architect` (semantics) + `devops-engineer` (operational examples) |
| `docs/ci-cd-pipelines.md` | Operational pipeline doc — our component workflows (outbound: our pipelines build our images), per CR-0010 | `devops-engineer` |
| `install/docker-compose.release.yml`, `install/install.ps1` / `install.sh`, `install/uninstall.ps1` / `uninstall.sh` | Release-install stack — canonical service inventory; consumed by `dev_env/` via `-f` merge per ADR-0010 | `devops-engineer` |
| `CLAUDE.md` | Project-instruction file — ginee framework pointer | `project-manager` (during discovery / rediscovery) |

**Tie-breakers.**

| Conflict | Winner | Action |
|---|---|---|
| Visual / interactive behaviour: architecture doc vs. mockup | mockup | flag architecture doc for update |
| API / data / stack / infrastructure: architecture doc vs. mockup | architecture doc | flag mockup for update |
| SAD-frozen FR/NFR text vs. a CR's "SAD-level content owned by this CR" block | CR (post-freeze) | the CR is the source of truth; SAD is the frozen baseline |
| Request / instinct / existing code vs. docs | docs | **stop, flag owning role** — doc update lands first, code follows |

## Repository structure

```
deployment-dashboard/
├── backend/             .NET 10 — co-located Write + Read API services (microservices architecture per ADR-0006; co-location mechanics per ADR-0002)
│   ├── api/             host (Dashboard.Api) — single Dockerfile, single ACA container target
│   ├── write-api/       Write endpoint group library (Dashboard.WriteApi) + tests
│   ├── read-api/        Read endpoint group library (Dashboard.ReadApi) + tests
│   ├── shared/          DbContext, entities, DTOs, migrations, API-key middleware, NOTIFY/LISTEN, SSE writer + tests
│   └── Dashboard.sln
├── frontend/            Angular 20 workspace
│   ├── dashboard/       application shell (Tailwind entry, SSE bootstrap, header)
│   ├── matrix/          pipeline matrix + view templates + attribute picker
│   ├── drawer/          history drawer
│   └── shared/          Signal Store + API client + SSE service + models + fixtures
├── gateway/             nginx reverse proxy + Dockerfile (single public ingress on :8080)
├── install/             docker-compose.release.yml + install.ps1/.sh, uninstall.ps1/.sh — release-install canonical compose; dev_env layers on this via `-f` merge per ADR-0010
├── dev_env/             docker-compose.local.yml (override), docker-compose.scaled.yml (standalone), start.ps1, stop.ps1
├── docs/                architecture.md, WBS.md, ci-cd-integration.md, adr/, cr/, ui/ (mockup + options)
├── testing/             functional/ (xUnit), e2e/ (Playwright), mockup-visual/ (Playwright), scripts/, fixtures/, config/
├── .github/actions/     notify/ composite action
├── .github/workflows/   api.yml + fetcher.yml + frontend.yml + gateway.yml + _build-and-push-image.yml (reusable) — CR-0010
├── .agents/ginee/  framework install
├── CLAUDE.md
└── TODO
```

**Per-tier dependency rules (frontend):**

- `matrix/`, `drawer/` may import only from `@dd/shared`.
- `shared/` imports nothing else in the workspace.
- Only `dashboard/` imports from `@dd/matrix` and `@dd/drawer`.
- Each library exposes a single `public-api.ts`; no deep imports.

**Per-tier dependency rules (backend — co-located Write + Read API services per ADR-0006; co-location mechanics + project-reference graph per ADR-0002):**

- `backend/api/` (host) is the sole executable and the only backend Dockerfile.
- `backend/write-api/` + `backend/read-api/` are library projects; they expose extension methods composed by the host.
- Both reference `backend/shared/`; `shared/` references neither.
- API-key middleware applied **only** to the Write endpoint group (`MapGroup("/api").RequireApiKey()`), never globally.

## Stack — non-negotiable

| Layer | Choice |
|---|---|
| Server language / framework | C# / .NET 10, ASP.NET Core Minimal API |
| Server ORM | EF Core 10 + Npgsql |
| Storage | PostgreSQL 16; SQLite in-memory for unit tests |
| Real-time | SSE over PostgreSQL LISTEN/NOTIFY (no separate real-time service per SAD §7) |
| Client framework | Angular 20 standalone + NgRx Signal Store + Tailwind CSS |
| Edge / gateway | nginx reverse proxy, single public ingress on port 8080, no CORS |
| Container runtime | OCI containers, app port 8080 |
| Hosting | Azure Container Apps + ACR + Azure Postgres Flexible + Key Vault (NFR-01, NFR-02) |
| IaC | Terraform `azurerm` ≥ 4.x (NFR-06) — planned per WBS §4, not yet present |
| CI/CD | GitHub Actions — component CI live per CR-0010 (`_build-and-push-image.yml` reusable + `api.yml` / `fetcher.yml` / `frontend.yml` / `gateway.yml` callers); `.github/actions/notify/` composite present (not invoked by component CI yet — deferred dogfooding TODO) |

## Do not introduce

| Forbidden | Why |
|---|---|
| Serverless / Functions / Lambda compute model | Constraint §6 — platform-agnostic OCI containers only |
| CORS configuration | SAD §7 — single origin via gateway; CORS-free by design |
| RBAC / per-user auth on Read group | NFR-04 — internal read-only tooling, no user auth |
| `.env` / `.env.local` files in `dev_env/` | `dev_env/README.md:24-29` — zero-setup, all dev values inline in compose files |
| CI/CD-specific SDKs in backend | SAD §1, FR-06 — backend is tool-agnostic; integration is one HTTP POST |
| Sticky sessions / session affinity on the API | NFR-05 — backend must be stateless across replicas |
| Topology payload on the SSE wire | CR-0003 — SSE carries slot updates only; topology refresh is a separate GET |

## Hard constraints (from NFRs)

| Constraint | Source | Implication |
|---|---|---|
| Azure-only hosting | NFR-01 | Single-cloud; no AWS / GCP / multi-cloud abstractions |
| Cost cap ≤ $30/month | NFR-02 | Minimal SKU sizing; ACA + B1ms Postgres baseline |
| Live updates ≤ 5 s | NFR-03 | SSE + LISTEN/NOTIFY (no polling) |
| No public ingress required (internal tooling) | NFR-04 | No public ACA ingress; no public load balancer; SPA never embeds the dev API key |
| Stateless backend | NFR-05 | Any number of replicas without sticky sessions; SSE clients reconnect via `Last-Event-ID` |
| IaC-defined | NFR-06 | All Azure resources via Terraform; no Portal-clicks |
| ≥ 90 days history retention | NFR-07 | `HISTORY_RETENTION_DAYS` default 365; daily pruning job |
| No build step in browser | NFR-08 | SPA shipped as static bundle into Read API `wwwroot` |
| UX reflow invariant — no overlap under any (services × envs × name-length × version-length × viewport) combo | NFR-09 | CSS Grid `auto`-env / fixed-leaf-width-box; `getBoundingClientRect()` + `ResizeObserver` + window-resize listener; mirrored verbatim atop the mockup |

Violation → **stop, propose a doc update first** (CR + ADR pair if it changes a frozen FR/NFR).

## Roles — deterministic routing

| Role | Concerns |
|---|---|
| `project-manager` | Discovery / rediscovery; dispatch routing; parallel / serial decisions; TODO check-ins; lifecycle gate enforcement; post-acceptance doc-optimization trigger; GitHub issue operations. |
| `solution-architect` | `docs/architecture.md`; mockup governance review (no edits); `docs/ci-cd-integration.md`; `docs/WBS.md`; ADRs / CRs in `docs/adr/` + `docs/cr/`; UI option docs in `docs/ui/*.md`; `CLAUDE.md` ginee pointer block; coherence audits; tie-breaker resolution. |
| `frontend-engineer` (alias `client-engineer`) | `frontend/` (Angular workspace — dashboard / matrix / drawer / shared); `docs/ui/deployment-dashboard.html` (mockup HTML/CSS/JS/SVG/fixtures); Signal Store; Tailwind styling; client-side fetch / SSE; per-option mockup proposals under `docs/ui/`. |
| `backend-engineer` (alias `service-engineer`) | `backend/api/` host (`Program.cs`, composition root); `backend/write-api/` + `backend/read-api/` endpoint-group libraries; `backend/shared/` (DbContext, entities, migrations, API-key middleware, NOTIFY/LISTEN, SSE writer); wire-format JSON contract. |
| `devops-engineer` (alias `platform-engineer`) | `dev_env/` (compose + ps1 scripts); `gateway/` (nginx config + Dockerfile); per-tier Dockerfiles (`backend/api/Dockerfile`, `frontend/dashboard/Dockerfile`, `gateway/Dockerfile`); `.github/actions/notify/`; `.github/workflows/` once it lands; `infrastructure/` (Terraform) once it lands; reverse-proxy config; secret provisioning; cost tracking. |
| `qa-engineer` (alias `quality-engineer`) | `testing/functional/` (xUnit functional API), `testing/e2e/` (Playwright), `testing/mockup-visual/` (Playwright visual contract), `testing/scripts/` (Pester + `seed.ps1`), `testing/fixtures/`, `testing/config/`; harness assertions; `backend/**/Dashboard.*.Tests/` (xUnit unit tests — co-owned with `backend-engineer`); seed / cleanup scripts. |
| `ai-engineer` | Optimization passes on AI assets + docs; structure / topology / token economy; lossless restructures. Between-phase only. |

Task spans two roles → dispatch in parallel per `core/process.md` § Dispatch & parallelism rules.

## Project role boundaries

| Role | Must NOT edit |
|---|---|
| `solution-architect` | `docs/ui/deployment-dashboard.html` (mockup); `backend/` source; `frontend/` source; `gateway/`; `dev_env/`; Dockerfiles; `.github/`; `infrastructure/`. |
| `frontend-engineer` | `backend/` source (incl. SQL in read-API endpoints); `gateway/`; `dev_env/`; Dockerfiles; `.github/workflows/`; `infrastructure/`. |
| `backend-engineer` | `frontend/` source; `docs/ui/deployment-dashboard.html` (mockup); `gateway/`; `dev_env/`; Dockerfiles outside `backend/`; `.github/workflows/`; `infrastructure/`. |
| `devops-engineer` | Application-tier manifests / lockfiles (`backend/**/*.csproj`, `frontend/**/package.json`); application source under `backend/` + `frontend/`; mockup. |
| `qa-engineer` | `docs/ui/deployment-dashboard.html` (mockup); production code under `backend/` + `frontend/`. Owns `testing/` directories + xUnit test projects (test code only) + fixtures + scenarios + runners. |
| `ai-engineer` | Rules / invariants / routing / requirements (semantics → `solution-architect`); production code; test code; IaC; CI workflows. |
| `project-manager` | Everything except `local/*` files written during discovery. Never edits production surfaces. |

## Project-specific index citations

| Index file (or class) | Consumed by | Why this project needs it |
|---|---|---|
| `local/index/ui-options-index.idx` | `frontend-engineer`, `solution-architect` | `docs/ui/*.md` are mockup-supporting design records (compact / focus-layout / theme / tree-topology / version-display options) that drive per-option mockup proposals; both roles need quick lookup of which option doc covers which UX axis without loading the SAD. |
| `local/index/wbs-index.idx` | `project-manager`, `solution-architect` | `docs/WBS.md` is the operational backlog; PM consults it during pickup routing + phase-gate decisions, SA when proposing CRs that touch scope. |
| `local/index/ci-cd-integration-index.idx` | `devops-engineer`, `backend-engineer` | `docs/ci-cd-integration.md` is the operational companion to SAD §7 — devops authors / maintains the snippets, backend ensures the wire contract stays in sync. |
| `local/index/ci-pipelines-index.idx` | `devops-engineer`, `backend-engineer` | `docs/ci-cd-pipelines.md` is the operational doc for our component CI workflows (per CR-0010) — devops authors / maintains the workflow YAML + ops guide; backend consults it when tooling pins (`.config/dotnet-tools.json`, EF Design refs) need bumping. |

(All four are novel classes; `ai-engineer` will author inline recipes per `core/index-protocol.md § Consumer coupling`. If a class proves to have no consumer after extraction it surfaces in the dormant-index audit.)

## Per-role load-trigger overrides

| Role | Index file | Override | Why |
|---|---|---|---|
| `backend-engineer` | `local/index/api-matrix.yaml` | `always` | Two endpoint-group libraries (write / read) + wire-contract is core to almost every backend dispatch — preload over scope-trigger. |
| `frontend-engineer` | `local/index/mockup-index.idx` | `always` | Mockup is the visual contract (NFR-09) — `frontend-engineer` reads it on every dispatch, not only on visual-touch triggers. |
| `qa-engineer` | `local/index/mockup-index.idx` | `always` | `testing/mockup-visual/` directly mirrors mockup geometry; qa-engineer references the index on every visual + e2e dispatch. |

## Out of scope (do not implement)

- Triggering or managing deployments — system is read-only / notification-only (SAD §3).
- Acting as a CI/CD engine; querying any CI/CD tool's API (SAD §3).
- Multi-organisation / multi-repository aggregation (SAD §3, MVP-out-of-scope).
- Role-based access control on Read endpoints (NFR-04 — internal read-only).
- Public ingress / public load balancer (NFR-04).
- Topology on the SSE wire (CR-0003 — refresh is a separate GET).
- Server-side persistence of per-user UI preferences (view / attrs / layout / theme / correlation-attribute — all `localStorage`-only per CR-0002 + CR-0005 + CR-0006).
