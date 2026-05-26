# Project Profile — `local/project-profile.md` Template

<!--
  Per-project; authored by team-lead during discovery; refreshed on rediscover OR staleness flag.
  Detected snapshot of project shape — stack · domain · architecture artefacts · SDLC artefacts.
  Sibling: bindings.md (per-project routing + role boundaries) · framework.config.yaml (machine-readable mappings).
  Read-mostly for roles; team-lead OVERWRITES on rediscover.
  Replace bracketed placeholders; mark empty sections "(none detected)".
-->

---

# Project Profile — `<project name>`

**Generated:** `<YYYY-MM-DD>` by `team-lead`
**Source:** `initial discovery | rediscovery | staleness refresh`
**Revision:** `<N>` (incremented per rediscovery)

## Domain

<!-- 2–4 sentences from README + top-level docs. Cite the file(s); no invention. Empty README → flag for user. -->

`<domain summary>`

**Cited from:** `<file:line(s)>`

## Tech stack

| Layer | Choice | Evidence |
|---|---|---|
| Primary language(s) | `<C# / TypeScript / Python / Go / …>` | `<files>` |
| Server runtime | `<.NET 10 / Node.js 22 / Python 3.13 / Go 1.23 / …>` | `<files>` |
| Server framework | `<ASP.NET Core / Express / FastAPI / Spring Boot / …>` | `<files>` |
| Server ORM / persistence | `<EF Core / Prisma / SQLAlchemy / Hibernate / …>` | `<files>` |
| Data store | `<PostgreSQL 16 / MongoDB 7 / DynamoDB / …>` | `<files>` |
| Real-time mechanism | `<SSE over LISTEN/NOTIFY · WebSocket via SignalR · change-stream / …>` | `<files>` |
| Auth approach | `<API key on writes · OAuth2 · mTLS / …>` | `<files>` |
| Client framework | `<Angular 20 standalone · React 18 · Vue 3 · Svelte 5 / …>` | `<files>` |
| Client state | `<NgRx Signal Store · Redux Toolkit · Pinia · Zustand / …>` | `<files>` |
| Client styling | `<Tailwind · CSS Modules · Sass · Styled Components / …>` | `<files>` |
| Container runtime | `<Docker / Podman / none>` | `<files>` |
| Orchestration | `<Docker Compose for local · Azure Container Apps for prod / …>` | `<files>` |
| IaC | `<Terraform azurerm 4.x / Pulumi TS / Bicep / none>` | `<files>` |
| CI/CD | `<GitHub Actions / GitLab CI / Azure Pipelines / Jenkins / none>` | `<files>` |
| Test runners | `<xUnit + Jest + Playwright + Pester / …>` | `<files>` |

## Architecture artefacts (referenced — not copied)

| Concept | Path | Status |
|---|---|---|
| Architecture doc | `<path or (none detected)>` | `present | absent — flag to user` |
| Mockup | `<path or (none detected)>` | `present | absent` |
| API contract | `<path or "inside SAD" or (none)>` | `present | absent` |
| ADR directory | `<path or (none)>` | `present | absent` |
| CR directory | `<path or (none)>` | `present | absent` |
| Diagrams directory | `<path or (none)>` | `present | absent` |
| Project-instruction file | `<CLAUDE.md / copilot-instructions.md / AGENTS.md / …>` | `present | absent` |

Source-doc summaries land in `local/index/*` (`architecture.idx · adr-index.idx · scenario-index.idx · api-matrix.yaml · ui-states.yaml · constraints.yaml` + adopter-specific). Roles read index first; canonical record + SHA-256: `local/index/manifest.yaml`. Spec: `core/protocols/index-protocol.md`.

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
├── <top-level dir 1>/    <one-line>
├── <top-level dir 2>/    <one-line>
└── ...
```

## Detected tiers + role attributions

| Tier | Path | Owner |
|---|---|---|
| Server | `<path>` | `backend-engineer` |
| Client | `<path>` | `frontend-engineer` |
| Mockup | `<path>` | `frontend-engineer` |
| Infrastructure | `<path>` | `devops-engineer` |
| CI | `<path>` | `devops-engineer` |
| Tests | `<path>` | `qa-engineer` |
| Architecture docs | `<path>` | `solution-architect` |

Defaults don't fit → refine in `local/bindings.md`.

## Active roles

| Role | Status |
|---|---|
| `team-lead` | always active |
| `solution-architect` | `active | inactive` |
| `frontend-engineer` | `active | inactive — no client tier` |
| `backend-engineer` | `active | inactive — no server tier` |
| `devops-engineer` | `active | inactive — no infra/CI` |
| `qa-engineer` | `active | inactive — no test surface` |
| `ai-engineer` | always available (between-phase) |

## Project-local roles (under `local/roles/`)

| Role file | Description (from frontmatter) |
|---|---|
| `local/roles/<name>.md` | `<one-line>` |

## Specialist suggestions (from `extras/roles/`)

Recommendations only — NOT enabled. User copies into `local/roles/` to opt in.

| Specialist | Trigger |
|---|---|
| `<security-engineer>` | `<one-line evidence>` |

## Out-of-scope / non-applicable

| Item | Reason |
|---|---|
| `<mobile-engineer suggestion declined>` | `<one-line>` |

## Staleness watchlist

Triggers auto-staleness flag per `team-lead.md § Auto-flag staleness`.

| Trigger | Where |
|---|---|
| New top-level directory not listed | repo root |
| New file type not in tech-stack table | anywhere |
| New CI workflow file | `<CI workflows path>` |
| Significant new doc not in architecture artefacts | `<docs directory>` |
