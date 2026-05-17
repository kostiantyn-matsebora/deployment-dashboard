# Project Bindings — `local/bindings.md` Template

<!--
  Scope:
  - Per-project.
  - Authored by project-manager during discovery.
  - Maintained as project evolves.
  Records:
  - Role → paths.
  - Forbidden role-crossings.
  - Hard constraints (NFRs).
  - Stack.
  - Tie-breakers.
  - Repo structure.
  Usage:
  - Replace bracketed placeholders.
  - Drop sections with no content.
-->

---

# Project Bindings — `<project name>`

## Source of truth (read before any work)

| File | Role | Edited by |
|---|---|---|
| `<architecture-doc path>` | Requirements, constraints, components, data model, API, decisions | `solution-architect` |
| `<mockup path>` (if present) | Visual + behavioural client contract | mockup owner (default `frontend-engineer`); `solution-architect` reviews, no edits |
| `<ADR directory path>` | Architecture decision records | `solution-architect` |
| `<CR directory path>` | Change requests | `solution-architect` |

**Tie-breakers.**

| Conflict | Winner | Action |
|---|---|---|
| Visual / interactive behaviour: architecture doc vs. mockup | mockup | flag architecture doc for update |
| API / data / stack / infrastructure: architecture doc vs. mockup | architecture doc | flag mockup for update |
| Request / instinct / existing code vs. docs | docs | **stop, flag owning role** — doc update lands first, code follows |

## Repository structure

```
<project root>/
├── <backend or service path>/
├── <frontend or client path>/
├── <infrastructure path>/
├── <local-dev directory>/
├── <testing directory>/
├── <docs directory>/
├── <CI directory>/
└── ...
```

**Per-tier dependency rules:**

- `<e.g. feature libs may only reference shared>`
- `<e.g. shared may not reference feature libs>`

## Stack — non-negotiable

| Layer | Choice |
|---|---|
| Server language / framework | `<e.g. C# / .NET 10, ASP.NET Core Minimal API>` |
| Server ORM | `<e.g. EF Core 10 + Npgsql>` |
| Storage | `<e.g. PostgreSQL 16; SQLite in-memory for unit tests>` |
| Real-time | `<e.g. SSE over PostgreSQL LISTEN/NOTIFY>` |
| Client framework | `<e.g. Angular 20 + NgRx Signal Store + Tailwind>` |
| Edge / gateway | `<e.g. nginx reverse proxy, single public ingress, no CORS>` |
| Container runtime | `<e.g. OCI containers, port 8080>` |
| Hosting | `<e.g. Azure Container Apps + ACR + Postgres Flexible + Key Vault>` |
| IaC | `<e.g. Terraform azurerm ≥ 4.x, state in Azure Storage>` |
| CI/CD | `<e.g. GitHub Actions>` |

## Do not introduce

| Forbidden | Why |
|---|---|
| `<library / pattern / platform>` | `<one line>` |

## Hard constraints (from NFRs)

| Constraint | Source | Implication |
|---|---|---|
| `<e.g. Single-cloud (Azure-only)>` | `<NFR-NN>` | `<implication>` |
| `<e.g. Cost cap ≤ $30/mo>` | `<NFR-NN>` | `<implication>` |
| `<e.g. Live updates within 5 s>` | `<NFR-NN>` | `<implication>` |
| `<e.g. Internal-only; no public ingress>` | `<NFR-NN>` | `<implication>` |
| `<e.g. Stateless backend>` | `<NFR-NN>` | `<implication>` |
| `<e.g. IaC-defined>` | `<NFR-NN>` | `<implication>` |
| `<e.g. ≥ 90 days data retention>` | `<NFR-NN>` | `<implication>` |

Violation → **stop, propose a doc update first**.

## Roles — deterministic routing

<!--
  Scope:
  - 7 cardinals + local/roles/*.
  Rule:
  - Orchestrator thread does NOT do role-owned work — dispatch instead.
-->

| Role | Concerns |
|---|---|
| `project-manager` | Discovery / rediscovery; dispatch routing; parallel / serial decisions; TODO check-ins; lifecycle gate enforcement; post-acceptance doc-optimization trigger. |
| `solution-architect` | `<architecture-doc path>`; mockup governance review (no edits); `<CI/CD integration guide>`; project-instruction file rules / routing / repo-structure; ADRs / CRs; coherence audits; tie-breaker resolution. |
| `frontend-engineer` (alias `client-engineer`) | `<client tier paths>`; `<mockup path>` (HTML/CSS/JS/SVG/fixtures); state; styling; client-side fetch / realtime. |
| `backend-engineer` (alias `service-engineer`) | `<server tier paths>`; ORM entities / migrations; schema, indexes; realtime hub; auth middleware; wire-format JSON contract. |
| `devops-engineer` (alias `platform-engineer`) | `<infra path>`; Dockerfiles; compose / orchestration; IaC; CI workflows; reverse-proxy config; secret provisioning; cost tracking. |
| `qa-engineer` (alias `quality-engineer`) | `<testing path>`; scenario specs; e2e / functional / smoke; harness assertions; fixtures; seed / cleanup scripts. |
| `ai-engineer` | Optimization passes on AI assets + docs; structure / topology / token economy; lossless restructures. Between-phase only. |
| `<local custom role>` | `<owned paths/concerns>` |

Task spans two roles → dispatch in parallel per `core/process.md` § Dispatch & parallelism rules.

## Project role boundaries

<!--
  Rules:
  - Forbidden role-crossings.
  - Each row is a hard stop.
  - Cross-domain need surfaced mid-task → propose a hand-off in the final report.
  - Do NOT patch across.
-->

| Role | Must NOT edit |
|---|---|
| `solution-architect` | `<mockup path>`; `<server source>`; `<client source>`; IaC, Dockerfiles, compose, CI workflows. |
| `frontend-engineer` | `<server source>` (incl. SQL in read-API endpoints); IaC, Dockerfiles, CI workflows. |
| `backend-engineer` | `<client source>`; `<mockup path>`; IaC, Dockerfiles, CI workflows. |
| `devops-engineer` | Application-tier manifests / lockfiles; application source; client config. |
| `qa-engineer` | `<mockup path>`; production server / client code. Owns test code, fixtures, scenarios, runners only. |
| `ai-engineer` | Rules / invariants / routing / requirements (semantics → `solution-architect`); production code; test code; IaC; CI workflows. |
| `project-manager` | Everything except `local/*` written during discovery. Never edits production surfaces. |

## Out of scope (do not implement)

- `<e.g. "Triggering or managing deployments — system is read-only.">`
- `<e.g. "Multi-tenant or multi-org aggregation.">`
- `<e.g. "RBAC on read endpoints — delegated to a sidecar.">`
