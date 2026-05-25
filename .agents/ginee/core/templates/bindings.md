# Project Bindings — `local/bindings.md` Template

<!--
  Scope:
  - Per-project.
  - Authored by team-lead during discovery.
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

## Source-of-truth ownership

**Default reads:** `local/index/*` per `core/protocols/index-protocol.md`. The table below is a **governance map** — who edits each source + where the verbatim text lives when an index entry points to "see source." NOT a per-dispatch read list; pulling raw doc paths into every dispatch defeats the load-on-demand contract.

| File | Role | Edited by |
|---|---|---|
| `<architecture-doc path>` | Architecture — components · data model · API · invariants · target architecture | `solution-architect` |
| `local/requirements.md` | FRs · NFRs · Constraints register | `solution-architect` |
| `local/asr-utility-tree.md` | ASR utility tree | `solution-architect` |
| `<ADR directory path>` | Architecture decision records | `solution-architect` |
| `<diagrams directory path>` | System / topology / sequence diagrams | `solution-architect` |
| `<CR directory path>` | Change requests (reassigned to `team-lead` — coordination decisions, not architectural) | `team-lead` |
| `<project-instruction file>` (`CLAUDE.md` / `AGENTS.md` / equivalent) | Repo-structure tree · routing table · coordination protocol · hard constraints · principles | `team-lead`; SA reviews for architectural coherence |
| `<work-breakdown doc path>` | Operational work plan — per-phase items | `team-lead` |
| `<CI/CD guide path>` | Operational companion to architecture doc's CI/CD section | `devops-engineer`; SA reviews for architectural coherence |
| `<infrastructure runbook directory>` | Per-environment deployment + rollback procedures | `devops-engineer` |
| `<backend READMEs / API docs / service docs>` | Per-service docs | `backend-engineer`; SA reviews for architectural coherence |
| `<frontend READMEs / component docs>` | Per-app docs | `frontend-engineer`; SA reviews for architectural coherence |
| `<test plans / scenario docs / QA reports>` | Quality docs | `qa-engineer`; SA reviews for architectural coherence |
| `<mockup path>` (if present) | Visual + behavioural client contract | mockup owner (default `frontend-engineer`); `solution-architect` reviews, no edits |

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
| `team-lead` | Discovery / rediscovery; dispatch routing; parallel / serial decisions; TODO check-ins; lifecycle gate enforcement; post-acceptance doc-optimization trigger. |
| `solution-architect` | `<architecture-doc path>`; mockup governance review (no edits); `<CI/CD integration guide>`; project-instruction file rules / routing / repo-structure; ADRs / CRs; coherence audits; tie-breaker resolution. |
| `frontend-engineer` (alias `client-engineer`) | `<client tier paths>`; `<mockup path>` (HTML/CSS/JS/SVG/fixtures); state; styling; client-side fetch / realtime. |
| `backend-engineer` (alias `service-engineer`) | `<server tier paths>`; ORM entities / migrations; schema, indexes; realtime hub; auth middleware; wire-format JSON contract. |
| `devops-engineer` (alias `platform-engineer`) | `<infra path>`; Dockerfiles; compose / orchestration; IaC; CI workflows; reverse-proxy config; secret provisioning; cost tracking; **unit tests + lint + coverage for devops-owned scripts** under `<devops-scripts.tests-path>`. |
| `qa-engineer` (alias `quality-engineer`) | `<testing path>`; scenario specs; e2e / functional / smoke; harness assertions; fixtures; seed / cleanup scripts; **script-suite tests for QA-owned scripts only** (devops scripts → `devops-engineer`). |
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
| `devops-engineer` | Application-tier manifests / lockfiles; application source; client config. May NOT skip script-quality obligation (lint + tests + coverage at `<devops-scripts.coverage-threshold>`) on any devops-owned script change. |
| `qa-engineer` | `<mockup path>`; production server / client code; **lint / unit tests / coverage for devops-owned scripts** (those belong to `devops-engineer`). Owns application + functional test code, fixtures, scenarios, runners, QA-owned script-suite only. |
| `ai-engineer` | Rules / invariants / routing / requirements (semantics → `solution-architect`); production code; test code; IaC; CI workflows. |
| `team-lead` | Everything except `local/*` written during discovery. Never edits production surfaces. |

## Project-specific index citations

<!--
  Scope:
  - Per-project; wires novel-class index files to cardinal role baselines
    without editing upstream `core/roles/*.md` kernels (those are
    framework-owned and replaced on upgrade).
  - Read by `team-lead` at dispatch time + `ai-engineer` at
    dormant-index audit time (per `core/protocols/index-protocol.md § Consumer coupling`
    + `§ Dormant-index audit`).
  Rule:
  - Every entry in `local/index/*` that is NOT cited by a cardinal role's
    `## Source of truth` table MUST be listed here with at least one
    consuming role; otherwise the class is dormant and surfaces in the
    discovery report.
  Effect:
  - Listed class's `consumed-by` is updated in `manifest.yaml`.
  - Listed role's baseline reads extend to include the index file(s)
    on every dispatch.
  Cardinal-role overrides allowed:
  - This table can ALSO promote a built-in class to additional cardinal
    roles beyond the kernel default (e.g. project where backend-engineer
    consumes mockup-index.idx for API + UI co-design).
-->

| Index file (or class) | Consumed by | Why this project needs it |
|---|---|---|
| `local/index/<class>-index.<ext>` | `<cardinal-role>` | `<one-line — what signal the role reads from it>` |

Empty table → no novel-class citations declared. Discovery will surface any unwired novel class extracted by `ai-engineer` as dormant.

## Per-role load-trigger overrides

<!--
  Scope:
  - Per-project; raises or lowers a role's per-file load tier vs the
    cardinal kernel default (per `core/protocols/index-protocol.md § Role consumption
    pattern § Adopter overrides`).
  Rule:
  - One row per (role, index-file) override.
  - `Override` column: `always` to promote a scope-load file to always-load
    for this role on this project, OR a trigger phrase to demote always-load
    to scope-load.
  - Read by `team-lead` at dispatch time + the dispatched specialist
    on its first reasoning step.
  When to use:
  - Project where backend tasks routinely touch infra (topology.yaml goes
    always for backend).
  - Project where conventions.yaml is huge and trivial fixes shouldn't load
    it (demote to a `style/lint touch` trigger).
-->

| Role | Index file | Override | Why |
|---|---|---|---|
| `<role>` | `local/index/<file>` | `<always | trigger-phrase>` | `<one-line — what about this project changes the default>` |

Empty table → use cardinal kernel defaults.

## Out of scope (do not implement)

- `<e.g. "Triggering or managing deployments — system is read-only.">`
- `<e.g. "Multi-tenant or multi-org aggregation.">`
- `<e.g. "RBAC on read endpoints — delegated to a sidecar.">`
