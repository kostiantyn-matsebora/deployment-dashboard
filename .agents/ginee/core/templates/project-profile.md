# Project Profile — `local/project-profile.md` Template

<!--
  Scope:
  - Per-project.
  - Path: local/project-profile.md.
  Authored by:
  - team-lead during discovery.
  - Refreshed on rediscover OR staleness flag.
  Contents — detected snapshot of project shape:
  - Stack.
  - Domain.
  - Architecture artefacts.
  - SDLC artefacts.
  Sibling files:
  - local/bindings.md — per-project routing + role boundaries (handwritten, seeded by discovery).
  - local/framework.config.yaml — concept → file-path mappings (machine-readable).
  Lifecycle:
  - Read-mostly for roles.
  - team-lead OVERWRITES on rediscover.
  Usage:
  - Replace bracketed placeholders.
  - Drop sections with no content (mark "(none detected)").
-->

---

# Project Profile — `<project name>`

**Generated:** `<YYYY-MM-DD>` by `team-lead`
**Source:** `initial discovery | rediscovery | staleness refresh`
**Revision:** `<N>` (incremented on each rediscovery)

## Domain

<!--
  Form:
  - 2–4 sentence summary from README + top-level docs.
  Rules:
  - Cite the file(s).
  - No invention.
  - Empty README → say so, flag for the user.
-->

`<domain summary>`

**Cited from:** `<file:line(s)>`

## Tech stack

| Layer | Choice | Source of evidence |
|---|---|---|
| Primary language(s) | `<e.g. C# / TypeScript / Python / Go>` | `<file(s)>` |
| Server runtime | `<e.g. .NET 10 / Node.js 22 / Python 3.13 / Go 1.23>` | `<file(s)>` |
| Server framework | `<e.g. ASP.NET Core / Express / FastAPI / Spring Boot>` | `<file(s)>` |
| Server ORM / persistence | `<e.g. EF Core / Prisma / SQLAlchemy / Hibernate>` | `<file(s)>` |
| Data store | `<e.g. PostgreSQL 16 / MongoDB 7 / DynamoDB>` | `<file(s)>` |
| Real-time mechanism | `<e.g. SSE over LISTEN/NOTIFY / WebSocket via SignalR / change-stream>` | `<file(s)>` |
| Auth approach | `<e.g. API key middleware on writes / OAuth2 / mTLS>` | `<file(s)>` |
| Client framework | `<e.g. Angular 20 standalone / React 18 / Vue 3 / Svelte 5>` | `<file(s)>` |
| Client state | `<e.g. NgRx Signal Store / Redux Toolkit / Pinia / Zustand>` | `<file(s)>` |
| Client styling | `<e.g. Tailwind CSS / CSS Modules / Sass / Styled Components>` | `<file(s)>` |
| Container runtime | `<e.g. Docker / Podman / none>` | `<file(s)>` |
| Orchestration | `<e.g. Docker Compose for local / Azure Container Apps for prod>` | `<file(s)>` |
| IaC | `<e.g. Terraform azurerm 4.x / Pulumi TypeScript / Bicep / none>` | `<file(s)>` |
| CI/CD | `<e.g. GitHub Actions / GitLab CI / Azure Pipelines / Jenkins / none>` | `<file(s)>` |
| Test runners | `<e.g. xUnit + Jest + Playwright + Pester>` | `<file(s)>` |

## Architecture artefacts (referenced — not copied)

| Concept | Path | Status |
|---|---|---|
| Architecture doc | `<path or (none detected)>` | `present | absent — flag to user` |
| Mockup | `<path or (none detected)>` | `present | absent` |
| API contract | `<path or "inside architecture doc" or (none)>` | `present | absent` |
| ADR directory | `<path or (none)>` | `present | absent` |
| CR directory | `<path or (none)>` | `present | absent` |
| Diagrams directory | `<path or (none)>` | `present | absent` |
| Project-instruction file | `<CLAUDE.md / copilot-instructions.md / etc.>` | `present | absent` |

Source-doc summaries land in `local/index/` (one file per detected doc class — `architecture.idx`, `adr-index.idx`, `scenario-index.idx`, `api-matrix.yaml`, `ui-states.yaml`, `constraints.yaml`, plus any adopter-specific class). Roles read the index first; originals only when an entry needs verbatim consumption. Canonical record + per-source SHA-256: `local/index/manifest.yaml`. Spec: `core/index-protocol.md`.

## SDLC artefacts

| Concept | Path |
|---|---|
| TODO file (root) | `<path or (none)>` |
| Nested TODO files | `<comma-separated paths or (none)>` |
| CI workflows | `<paths or (none)>` |
| Local-dev startup script | `<path or (none)>` |
| Local-dev orchestration | `<paths or (none)>` |
| Test directories | `<paths or (none)>` |
| Fixtures directory | `<path or (none)>` |
| Seed / cleanup scripts | `<paths or (none)>` |

## Repository structure (auto-detected)

```
<project root>/
├── <top-level dir 1>/    <one-line description>
├── <top-level dir 2>/    <one-line description>
├── <top-level dir 3>/    <one-line description>
└── ...
```

## Detected tiers + role attributions

| Tier | Path | Default cardinal owner |
|---|---|---|
| Server | `<path>` | `backend-engineer` |
| Client | `<path>` | `frontend-engineer` |
| Mockup | `<path>` | `frontend-engineer` |
| Infrastructure | `<path>` | `devops-engineer` |
| CI | `<path>` | `devops-engineer` |
| Tests | `<path>` | `qa-engineer` |
| Architecture docs | `<path>` | `solution-architect` |

**Defaults don't fit?** Refine in `local/bindings.md`.

## Active roles

| Role | Status |
|---|---|
| `team-lead` | always active |
| `solution-architect` | `active | inactive` |
| `frontend-engineer` | `active | inactive — no client tier detected` |
| `backend-engineer` | `active | inactive — no server tier detected` |
| `devops-engineer` | `active | inactive — no infra/CI detected` |
| `qa-engineer` | `active | inactive — no test surface detected` |
| `ai-engineer` | always available (between-phase invocation) |

## Project-local roles (under `local/roles/`)

| Role file | Description (from front-matter) |
|---|---|
| `<local/roles/<name>.md>` | `<one-line>` |

## Specialist suggestions (from `extras/roles/`)

<!--
  Status:
  - Recommendations from discovery.
  - NOT enabled.
  Opt-in:
  - User copies the chosen file into local/roles/.
-->

| Suggested specialist | Trigger |
|---|---|
| `<e.g. security-engineer>` | `<one-line evidence>` |

## Out-of-scope / non-applicable

| Item | Reason |
|---|---|
| `<e.g. mobile-engineer suggestion declined>` | `<one-line>` |

## Staleness watchlist

<!-- Triggers auto-staleness flag (per core/roles/team-lead.md § Auto-flag staleness). -->

| Trigger | Where |
|---|---|
| New top-level directory not listed above | repo root |
| New file type not represented in the tech-stack table | anywhere |
| New CI workflow file | `<CI workflows path>` |
| Significant new doc not listed in architecture artefacts | `<docs directory>` |
