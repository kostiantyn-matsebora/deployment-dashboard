# Discovery Report Template

<!--
  Produced by team-lead on first run + on `@team-lead rediscover`.
  Surfaces detected project shape + recommends optional specialists from extras/roles/.
  Replace bracketed placeholders. Drop empty sections or mark "(none detected)".
-->

---

## Discovery Report

**Project:** `<project name>` (`<repo root>`)
**Generated:** `<YYYY-MM-DD>`
**Trigger:** `initial discovery | rediscovery | profile-staleness flag`
**By:** `team-lead`

## Detected stack

| Tier | Choice | Evidence |
|---|---|---|
| Primary language(s) | `<TypeScript / C# / Python / Go / …>` | `<package.json · *.csproj · pyproject.toml · go.mod>` |
| Server framework | `<ASP.NET Core / Express / FastAPI / Spring Boot / …>` | `<files>` |
| Client framework | `<Angular / React / Vue / Svelte / Flutter / SwiftUI / …>` | `<files>` |
| Data store | `<PostgreSQL / MongoDB / DynamoDB / SQLite / …>` | `<files>` |
| Real-time mechanism | `<SSE / WebSocket / change-stream / push>` | `<files>` |
| Container runtime | `<Docker / Podman / none>` | `<files>` |
| IaC | `<Terraform / Pulumi / Bicep / none>` | `<files>` |
| CI/CD | `<GitHub Actions / GitLab CI / Azure Pipelines / Jenkins / none>` | `<files>` |

## Detected domain

<!-- 2–4 sentences from README + top-level docs. No invention. -->

`<domain summary>`

## Architecture artefacts (referenced — not copied)

| Concept | Path | Owner |
|---|---|---|
| Architecture doc | `<path or (none detected)>` | `solution-architect` |
| Mockup | `<path or (none detected)>` | `frontend-engineer` |
| API contract | `<path or (none detected)>` | `backend-engineer` (proposes) → `solution-architect` (ratifies) |
| ADR directory | `<path or (none detected)>` | `solution-architect` |
| CR directory | `<path or (none detected)>` | `team-lead` |
| Diagrams directory | `<path or (none detected)>` | `solution-architect` |
| Project-instruction file | `<CLAUDE.md / .github/copilot-instructions.md / .cursor/rules/*.mdc / AGENTS.md / …>` | per adapter |

## SDLC artefacts

| Concept | Path |
|---|---|
| TODO file (root) | `<path or (none detected)>` |
| TODO files (nested) | `<comma-separated paths or (none detected)>` |
| CI workflows | `<paths or (none detected)>` |
| Local-dev startup | `<path or (none detected)>` |
| Local-dev orchestration | `<paths or (none detected)>` |
| Test directories | `<paths or (none detected)>` |
| Fixtures directory | `<path or (none detected)>` |

## Active roles (7 cardinals)

| Role | Status |
|---|---|
| `team-lead` | always active |
| `solution-architect` | `active | inactive` |
| `frontend-engineer` | `active | inactive — no client tier detected` |
| `backend-engineer` | `active | inactive — no server tier detected` |
| `devops-engineer` | `active | inactive — no infra/CI detected` |
| `qa-engineer` | `active | inactive — no test surface detected` |
| `ai-engineer` | always available (between-phase) |

## Suggested specialists (from `extras/roles/`)

Recommendations only — NOT enabled. User copies file from `extras/roles/` → `local/roles/` to opt in.

| Specialist | Why suggested |
|---|---|
| `security-engineer` | `<auth code under <path>; <file> references encryption>` |
| `ml-engineer` | `<<dir> contains ML training pipelines + model artefacts>` |
| `mobile-engineer` | `<<dir> contains iOS/Android app shell>` |
| `sre` | `<project declares uptime SLO in <file>>` |
| `data-engineer` | `<ETL pipelines / data warehouse references>` |

## Indexed docs (`local/index/`)

Produced by `ai-engineer` per `core/protocols/index-protocol.md`. Canonical record: `local/index/manifest.yaml`. Pre-dispatch staleness compares against this entry.

| Class | Source(s) | Recipe | Index file(s) | SHA-256 |
|---|---|---|---|---|
| `architecture` | `docs/architecture.md` | `builtin:architecture` | `architecture.idx · architecture-fr.idx · api-matrix.yaml · ui-states.yaml · constraints.yaml · glossary.idx` | `<sha-hex or 'per-file in manifest'>` |
| `adr` | `docs/adr/*.md` | `builtin:adr` | `adr-index.idx` | `per-file in manifest` |
| `scenario` | `docs/scenarios/*.md` | `builtin:scenario` | `scenario-index.idx` | `per-file in manifest` |
| `rfc` (adopter-declared) | `docs/rfcs/*.md` | `builtin:adr` (reused) | `rfc-index.idx` | `per-file in manifest` |
| `runbook` (novel) | `ops/runbooks/*.md` | `inline (see manifest)` | `runbook-index.idx` | `per-file in manifest` |

## Artefacts written

| Path | From template |
|---|---|
| `local/project-profile.md` | `core/templates/project-profile.md` |
| `local/bindings.md` | `core/templates/bindings.md` |
| `local/framework.config.yaml` | `core/templates/framework.config.yaml` |
| `local/index/manifest.yaml` + per-class index files | `core/templates/index/*` |

## Next steps

1. Review the three `local/*` files.
2. Refine `local/bindings.md` if auto-detected forbidden-role-crossings need project-specific entries.
3. *(Optional)* Copy any suggested specialist from `extras/roles/` → `local/roles/`.
4. Dispatch `@team-lead <task>` per `core/process.md § Task model`.
