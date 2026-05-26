# Project Bindings — `local/bindings.md` Template

<!--
  Per-project; authored by team-lead during discovery; maintained as project evolves.
  Records role → paths · forbidden role-crossings · hard constraints (NFRs) · stack · tie-breakers · repo structure.
  Replace bracketed placeholders; drop sections with no content.
-->

---

# Project Bindings — `<project name>`

## Source-of-truth ownership

**Default reads:** `local/index/*` per `core/protocols/index-protocol.md`. The table below is a **governance map** (who edits each source + where verbatim text lives when an index entry says "see source"), NOT a per-dispatch read list — pulling raw doc paths into every dispatch defeats the load-on-demand contract.

| File | Role | Edited by |
|---|---|---|
| `<architecture-doc path>` | Architecture — components · data model · API · invariants · target architecture | `solution-architect` |
| `local/requirements.md` | FRs · NFRs · Constraints register | `solution-architect` |
| `local/asr-utility-tree.md` | ASR utility tree | `solution-architect` |
| `<ADR directory>` | Architecture decision records | `solution-architect` |
| `<diagrams directory>` | System / topology / sequence diagrams | `solution-architect` |
| `<CR directory>` | Change requests (coordination, not architectural) | `team-lead` |
| `<project-instruction file>` (`CLAUDE.md` / `AGENTS.md` / equivalent) | Repo-structure tree · routing table · coordination protocol · hard constraints · principles | `team-lead`; SA reviews for coherence |
| `<work-breakdown doc>` | Operational work plan — per-phase items | `team-lead` |
| `<CI/CD guide>` | Operational companion to architecture doc's CI/CD section | `devops-engineer`; SA reviews |
| `<infrastructure runbook directory>` | Per-environment deployment + rollback | `devops-engineer` |
| `<backend READMEs · API docs · service docs>` | Per-service docs | `backend-engineer`; SA reviews |
| `<frontend READMEs · component docs>` | Per-app docs | `frontend-engineer`; SA reviews |
| `<test plans · scenario docs · QA reports>` | Quality docs | `qa-engineer`; SA reviews |
| `<mockup>` (if present) | Visual + behavioural client contract | Mockup owner (default `frontend-engineer`); SA reviews — no edits |

**Tie-breakers.**

| Conflict | Winner | Action |
|---|---|---|
| Visual / interactive behaviour — architecture doc vs mockup | mockup | flag architecture doc for update |
| API · data · stack · infra — architecture doc vs mockup | architecture doc | flag mockup for update |
| Request / instinct / existing code vs docs | docs | **stop, flag owning role** — doc update lands first, code follows |

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
| Server language / framework | `<e.g. C# / .NET 10 · ASP.NET Core Minimal API>` |
| Server ORM | `<e.g. EF Core 10 + Npgsql>` |
| Storage | `<e.g. PostgreSQL 16; SQLite in-memory for unit tests>` |
| Real-time | `<e.g. SSE over PostgreSQL LISTEN/NOTIFY>` |
| Client framework | `<e.g. Angular 20 + NgRx Signal Store + Tailwind>` |
| Edge / gateway | `<e.g. nginx reverse proxy · single public ingress · no CORS>` |
| Container runtime | `<e.g. OCI containers · port 8080>` |
| Hosting | `<e.g. Azure Container Apps + ACR + Postgres Flexible + Key Vault>` |
| IaC | `<e.g. Terraform azurerm ≥ 4.x · state in Azure Storage>` |
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

<!-- 7 cardinals + local/roles/*. Orchestrator does NOT self-execute role-owned work — dispatch instead. -->

| Role | Concerns |
|---|---|
| `team-lead` | Discovery / rediscovery · dispatch routing · parallel / serial decisions · TODO check-ins · lifecycle gates · post-acceptance doc-optimization trigger. |
| `solution-architect` | `<architecture-doc>` · mockup governance review (no edits) · `<CI/CD guide>` · project-instruction file rules / routing / repo-structure · ADRs / CRs · coherence audits · tie-breaker resolution. |
| `frontend-engineer` (alias `client-engineer`) | `<client tier paths>` · `<mockup>` (HTML/CSS/JS/SVG/fixtures) · state · styling · client-side fetch / realtime. |
| `backend-engineer` (alias `service-engineer`) | `<server tier paths>` · ORM entities / migrations · schema · indexes · realtime hub · auth middleware · wire-format JSON contract. |
| `devops-engineer` (alias `platform-engineer`) | `<infra path>` · Dockerfiles · compose / orchestration · IaC · CI workflows · reverse-proxy config · secret provisioning · cost tracking · **unit tests + lint + coverage for devops-owned scripts** under `<devops-scripts.tests-path>`. |
| `qa-engineer` (alias `quality-engineer`) | `<testing path>` · scenario specs · e2e / functional / smoke · harness assertions · fixtures · seed / cleanup scripts · **script-suite tests for QA-owned scripts only** (devops scripts → `devops-engineer`). |
| `ai-engineer` | Optimization passes on AI assets + docs · structure / topology / token economy · lossless restructures. Between-phase only. |
| `<local custom role>` | `<owned paths/concerns>` |

Task spans two roles → parallel dispatch per `core/process.md § Dispatch & parallelism rules`.

## Project role boundaries

<!-- Forbidden role-crossings. Each row is a hard stop; cross-domain need → hand-off in final report, never patch across. -->

| Role | Must NOT edit |
|---|---|
| `solution-architect` | `<mockup>` · `<server source>` · `<client source>` · IaC · Dockerfiles · compose · CI workflows. |
| `frontend-engineer` | `<server source>` (incl. SQL in read-API endpoints) · IaC · Dockerfiles · CI workflows. |
| `backend-engineer` | `<client source>` · `<mockup>` · IaC · Dockerfiles · CI workflows. |
| `devops-engineer` | Application-tier manifests / lockfiles · application source · client config. MAY NOT skip script-quality obligation (lint + tests + coverage at `<devops-scripts.coverage-threshold>`) on any devops-owned script change. |
| `qa-engineer` | `<mockup>` · production server / client code · **lint / unit tests / coverage for devops-owned scripts** (those → `devops-engineer`). Owns application + functional test code · fixtures · scenarios · runners · QA-owned script-suite only. |
| `ai-engineer` | Rules / invariants / routing / requirements (semantics → `solution-architect`) · production code · test code · IaC · CI workflows. |
| `team-lead` | Everything except `local/*` written during discovery. Never edits production surfaces. |

## Visual oracle fields (optional — pixel-check)

<!-- Required when `local/framework.config.yaml § qa.pixel-check.enabled: true`. Spec: core/protocols/pixel-check-protocol.md. Omit when disabled. -->

| Field | Required | Purpose |
|---|---|---|
| `seed-script.path` | yes (when enabled) | Command / script bringing the app to the canonical state |
| `mockup-snapshot.path` | yes | Per-viewport mockup renders (e.g. `docs/mockup-snapshots/<viewport>.png`) |
| `app-render.command` | yes | Deterministic screenshot command (e.g. `npm run snapshot`) |
| `visual-source-of-truth.path` | (already required by `blueprint-diff-protocol.md`) | Mockup source — unchanged |

## Project-specific index citations

<!--
  Wires novel-class index files to cardinal role baselines without editing `core/roles/*.md` (framework-owned).
  Read by team-lead at dispatch + ai-engineer at dormant-index audit per index-protocol.md.
  Rule: every `local/index/*` entry NOT cited by a cardinal `## Source of truth` table MUST appear here
  with at least one consuming role (else class is dormant).
  May also promote a built-in class to additional cardinals.
-->

| Index file (or class) | Consumed by | Why this project needs it |
|---|---|---|
| `local/index/<class>-index.<ext>` | `<cardinal-role>` | `<one-line — what signal the role reads>` |

Empty → no novel-class citations. Discovery surfaces any unwired novel class as dormant.

## Per-role load-trigger overrides

<!--
  Raises or lowers per-file load tier vs cardinal kernel default per
  `core/protocols/index-protocol.md § Role consumption pattern § Adopter overrides`.
  One row per (role, index-file) override.
  `Override` column: `always` to promote scope→always, OR a trigger phrase to demote always→scope.
-->

| Role | Index file | Override | Why |
|---|---|---|---|
| `<role>` | `local/index/<file>` | `<always | trigger-phrase>` | `<one-line>` |

Empty → cardinal kernel defaults.

## Out of scope (do not implement)

- `<e.g. "Triggering or managing deployments — system is read-only.">`
- `<e.g. "Multi-tenant or multi-org aggregation.">`
- `<e.g. "RBAC on read endpoints — delegated to a sidecar.">`
