# Discovery Report Template

<!--
  Produced by:
  - team-lead on first run.
  - team-lead on @team-lead rediscover.
  Purpose:
  - Surface detected project shape.
  - Recommend optional specialists from extras/roles/.
  Usage:
  - Replace bracketed placeholders.
  - Drop sections with no content (mark "(none detected)").
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
| Primary language(s) | `<e.g. TypeScript / C# / Python / Go>` | `<file(s) — package.json, *.csproj, pyproject.toml, go.mod>` |
| Server framework | `<e.g. ASP.NET Core / Express / FastAPI / Spring Boot>` | `<files>` |
| Client framework | `<e.g. Angular / React / Vue / Svelte / Flutter / SwiftUI>` | `<files>` |
| Data store | `<e.g. PostgreSQL / MongoDB / DynamoDB / SQLite>` | `<files>` |
| Real-time mechanism | `<SSE / WebSocket / change-stream / push>` | `<files>` |
| Container runtime | `<Docker / Podman / none>` | `<files>` |
| IaC | `<Terraform / Pulumi / Bicep / none>` | `<files>` |
| CI/CD | `<GitHub Actions / GitLab CI / Azure Pipelines / Jenkins / none>` | `<files>` |

## Detected domain

<!-- 2–4 sentences from README + top-level docs. No invention. -->

`<domain summary>`

## Architecture artefacts (referenced — not copied)

| Concept | Path | Owner per default routing |
|---|---|---|
| Architecture doc | `<path or (none detected)>` | `solution-architect` |
| Mockup | `<path or (none detected)>` | `frontend-engineer` |
| API contract | `<path or (none detected)>` | `backend-engineer` (proposes) → `solution-architect` (ratifies) |
| ADR directory | `<path or (none detected)>` | `solution-architect` |
| CR directory | `<path or (none detected)>` | `solution-architect` |
| Diagrams directory | `<path or (none detected)>` | `solution-architect` |
| Project-instruction file | `<CLAUDE.md / .github/copilot-instructions.md / .cursor/rules/*.mdc / etc.>` | per-tool — see adapter |

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

| Role | Status | Bindings file ref |
|---|---|---|
| `team-lead` | always active | n/a |
| `solution-architect` | `active | inactive` | `local/bindings.md` |
| `frontend-engineer` | `active | inactive — no client tier detected` | `local/bindings.md` |
| `backend-engineer` | `active | inactive — no server tier detected` | `local/bindings.md` |
| `devops-engineer` | `active | inactive — no infra/CI detected` | `local/bindings.md` |
| `qa-engineer` | `active | inactive — no test surface detected` | `local/bindings.md` |
| `ai-engineer` | always available (between-phase invocation) | n/a |

## Suggested specialists (from `extras/roles/`)

<!--
  Status:
  - Recommendations only.
  - NOT enabled.
  Opt-in:
  - User copies the chosen file from extras/roles/ into local/roles/.
-->

| Specialist | Why suggested |
|---|---|
| `<e.g. security-engineer>` | `<e.g. auth code under `<path>`; `<file>` references encryption>` |
| `<e.g. ml-engineer>` | `<e.g. `<dir>` contains ML training pipelines + model artefacts>` |
| `<e.g. mobile-engineer>` | `<e.g. `<dir>` contains iOS/Android app shell>` |
| `<e.g. sre>` | `<e.g. project declares uptime SLO in `<file>`>` |
| `<e.g. data-engineer>` | `<e.g. project contains ETL pipelines / data warehouse references>` |

## Indexed docs (`local/index/`)

<!--
  Produced by ai-engineer per core/protocols/index-protocol.md.
  Every detected doc class has an entry. SHA-256 + recipe + index-file list
  recorded canonically in local/index/manifest.yaml; this section is a
  human-readable view of that manifest at discovery time.
-->

| Class | Source(s) | Recipe | Index file(s) | SHA-256 |
|---|---|---|---|---|
| `<e.g. architecture>` | `<docs/architecture.md>` | `builtin:architecture` | `architecture.idx, architecture-fr.idx, api-matrix.yaml, ui-states.yaml, constraints.yaml, glossary.idx` | `<sha256-hex or 'per-file in manifest'>` |
| `<e.g. adr>` | `<docs/adr/*.md>` | `builtin:adr` | `adr-index.idx` | `<per-file in manifest>` |
| `<e.g. scenario>` | `<docs/scenarios/*.md>` | `builtin:scenario` | `scenario-index.idx` | `<per-file in manifest>` |
| `<e.g. rfc — adopter-declared>` | `<docs/rfcs/*.md>` | `builtin:adr` (reused shape) | `rfc-index.idx` | `<per-file in manifest>` |
| `<e.g. runbook — novel class>` | `<ops/runbooks/*.md>` | `inline (see manifest)` | `runbook-index.idx` | `<per-file in manifest>` |

Canonical record: `local/index/manifest.yaml`. Pre-dispatch staleness checks compute current SHA-256 and compare against this entry — see `core/protocols/index-protocol.md § Pre-dispatch staleness check`.

## Artefacts written

| Path (absolute) | Source template |
|---|---|
| `local/project-profile.md` | `core/templates/project-profile.md` |
| `local/bindings.md` | `core/templates/bindings.md` |
| `local/framework.config.yaml` | `core/templates/framework.config.yaml` |
| `local/index/manifest.yaml` + per-class index files | `core/templates/index/*` |

## Next step for the user

1. Review the three `local/*` files.
2. Refine `local/bindings.md` if auto-detected forbidden-role-crossings need project-specific entries.
3. *(Optional)* Copy any suggested specialist from `extras/roles/` into `local/roles/`.
4. Begin work — dispatch `@team-lead <task>` per `core/process.md` § Task model.
