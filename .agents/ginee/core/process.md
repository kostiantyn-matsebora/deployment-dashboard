# Engineering Process

## Purpose

- Generic, project-agnostic process model for a small multi-agent engineering team.
- Authoritative spec for every role (orchestrator + specialists).
- **Project-specific knowledge lives elsewhere** — never in this file:
  - Stack, repo layout, role roster, forbidden role-crossings, owned-paths bindings → `local/bindings.md` + `local/project-profile.md`.

## Reading order

| File | Role | Owner |
|---|---|---|
| `core/process.md` (this file) | Common process — principles · doc style · reporting · load-on-demand index | upstream framework |
| `core/process/phase-<N>-<name>.md` | One file per lifecycle phase (1–8); load only the phases in this role's `phase-participation:` | upstream framework |
| `core/process/dispatch.md` | Orchestration — skill-runner boundary · dispatch & parallelism · automatic mode · task model · cross-domain bugs mapping | upstream framework |
| `core/roles/*.md` | Generic role charters (7 cardinals) — frontmatter `phase-participation:` declares which phases the role loads | upstream framework |
| `local/bindings.md` | Per-project role → owned paths/concerns table | the project |
| `local/project-profile.md` | Per-project stack, domain, architecture artefacts | the project (written by `team-lead` on discovery) |
| `local/framework.config.yaml` | Concept → file-path mapping (architecture doc, mockup, API contract, ADR dir, TODO file, ...) | the project |

**Conflict resolution:**

| Conflict class | Winner |
|---|---|
| Per-project routing | `local/bindings.md` |
| Generic process rule | `core/process.md` (this file) or the relevant `core/process/<file>.md` |

Bindings may NOT override generic process.

**Invocation notation.** This spec uses `@<role>` as vendor-neutral shorthand for "dispatch to that role." The literal `@<agent>` syntax works in some clients (Cursor) but not others (Claude Code). Per-client invocation surfaces (AgentSkills, natural-language routing, etc.) ship via the adapters — see `adapters/<x>/install.md § How to invoke`. Framework workflows (discovery / file / pick-up / triage / promote / reindex / update) auto-activate as Skills in any AgentSkills-compatible client; specialist dispatches route via subagent description match.

## Lifecycle — load topology (D35-process-md-load-topology)

- **8 phases**, one file each — `core/process/phase-<N>-<name>.md`. Specialists within a phase run in parallel; phases overlap wherever a contract surface decouples them. Each phase file declares: **Goal · Acceptance** (+ phase-specific anchors).
- **Per-role loading.** Cardinal kernel frontmatter `phase-participation: [N, M, …]` selects which phase files load. Roster: `team-lead [1-8]` · `solution-architect [1, 2, 4, 5, 6, 7]` · backend / frontend / devops [2, 4, 5, 6] · `qa-engineer [5, 6]` · `ai-engineer []` (between-phase only).
- **Orchestration** (`core/process/dispatch.md`) — skill-runner boundary · dispatch & parallelism · automatic mode · task model · cross-domain bugs mapping. Loaded by `team-lead` always; by skill-runner main thread on entry to any `ginee-*` skill body. Other cardinals do NOT load.

## Engineering principles — apply across all roles

### Configuration vs. data — declarative over imperative

- Binds every role. Signal a value belongs in a declarative file: "hard to change without editing imperative code".
- **Configuration** (URLs, ports, env vars, flags, retention windows, defaults) lives in declarative files per tier; **never** as literals inside controllers, components, scripts, or test specs.

  | Tier | Typical file |
  |---|---|
  | Service runtime | environment file / app-settings config |
  | Client runtime | environment file / build-config |
  | Container orchestration | `docker-compose.*.yml` / Helm values |
  | IaC | `*.tfvars` / Pulumi config / etc. |
  | Scripting / tooling | `*.json` / `*.yaml` config files |

- **Data** (fixtures, seed sets, snapshot baselines, expected payloads, scenarios) lives in dedicated declarative files; **never** as inline literals inside test code.
- **Imperative code stays thin** — scripts / runners / wrappers read declarative files and call the underlying tool. Exceptions require a doc update before they land.

### Test oracles can be wrong

- A passing test against broken software = defect in the oracle, not a green light.
- Test results contradict observed behaviour → trust observed behaviour; route to test owner to tighten assertion.
- Examples of weak oracles:
  - Harness anchored to wrapper, not inner element.
  - POST asserting status without response shape.
  - UI element opened without exercising its action.
- Tightening is `qa-engineer`'s job; respecting the signal is everyone's.

## Documentation style — structure over prose

**Binding, not aspirational** — framework-self-dev (per `CLAUDE.md § Framework authoring`) + adopter-project outputs authored by any role (D22-doc-authoring-protocol — protocol + 6 paired examples + discovery-driven enforcement: `core/protocols/doc-authoring-protocol.md`).

**Scope.** Applies to project-instruction files · role definitions (`core/roles/`, `local/roles/`) · future skills · architecture doc + mockup + ADRs · per-component READMEs · **GitHub issue bodies authored via `ginee-file-*` skills (D26-doc-protocol-scope-extension)** · **framework-authored GitHub comments — Phase-transition · sticky `ginee:score` / `ginee:review-cycle` · audit comments · per-thread review-replies (D26-doc-protocol-scope-extension)**.

| Rule | Application |
|---|---|
| **Default to structure** | Bullets · numbered lists · tables · headings. Not prose paragraphs. |
| **Steps / actions / instructions** | Bullet list. Never a multi-sentence paragraph. |
| **Pairs, mappings, choices** | Table. Examples: "Before / after" · "concern → owner" · "endpoint → status code". |
| **One idea per bullet** | A bullet wanting three sentences → promote to sub-list or table. |
| **Headings carry weight** | Use `##` / `###` to chunk. Don't bury rules inside walls of prose. |
| **Code shapes** | Fenced code blocks — wire formats · env vars · file paths · commands. |
| **Cross-reference, don't duplicate** | Cite the section ("per architecture-doc §X"); don't restate. |
| **Drop filler** | No "It is important to note that…", "Please ensure…", "In general…". Lead with the verb or noun. |
| **Prose** | Narrative exposition only — explaining *why*. Keep tight. |
| **Framework-self-dev (D21-context-economy-gates)** | Framework-source PRs in the ginee repo are gated by `scripts/context-economy-check.ps1` (Claude Code hook + git hooks + CI workflow). Threshold breach without an `Optimized-By: ai-engineer` trailer fails the gate. Spec: `core/MIGRATIONS/D21-context-economy-gates.md`. |

### Default-shape map (D22-doc-authoring-protocol)

| Doc artefact | Default shape |
|---|---|
| Component / service / image / endpoint / env-var inventory | Table |
| Design properties, invariants, NFRs | Bullet list — one rule per bullet |
| Sequence / workflow / runbook steps | Numbered list |
| Term definitions | `**Term.** Gloss.` lines |
| Trade-off / decision-rationale | Two-column table (option / consequence) |
| Narrative *why* (rationale only) | Prose — tight, < 4 sentences |

### Mandatory checks before report-as-done (D22-doc-authoring-protocol)

1. No paragraph contains > 2 rules (sentence terminators: `. ` `! ` `? `).
2. No table cell holds a multi-sentence sub-paragraph.
3. No bullet runs > 25 words *unless* it carries nested sub-bullets.
4. Inventories (services, components, endpoints, env vars) are tables, not prose.
5. Cross-references cite anchors (`§Name`, `#anchor`); never restate content. **Taxonomy identifiers carry their short name in slug-glued form (D34-identifier-short-name-pairing)** — `D28-skill-runner-boundary` / `ADR-0001-topology-derivation-five-pass` / `CR-0010-component-ci-pipeline` / `FR-04-deploy-rollback`, never bare `D28` / `ADR-0001` / `CR-0010` / `FR-04`. Issue / PR / commit references are NOT taxonomy IDs and stay bare (`#87`, PR-link, SHA). Full lookup procedure: `core/protocols/doc-authoring-protocol.md § Taxonomy identifier pairing (D34-identifier-short-name-pairing)`.

**Enforcement procedure** (lint command, attestation format, no-tool fallback): `core/protocols/doc-authoring-protocol.md` — load at Phase 5 / report-as-done.
**Paired bad-vs-good examples** (6 doc classes): `core/doc-authoring-examples.md` — load on first-time authoring or explicit request.

## Reporting — schema-bound (D29-strict-subagent-return-schema)

**Every cardinal-dispatch return is schema-bound** per `core/templates/phase-report.md`. Same machinery as D22-doc-authoring-protocol / D26-doc-protocol-scope-extension doc-authoring protocol, scoped to the subagent-return surface.

- **Mandatory sections** — `## Files touched` · `## Decisions made` · `## Verification log` · `## Open issues` · `## Next dispatch needed`. Empty case: `(none)`. `## Hand-off` required on forced-handoff per `core/cross-agent-handoff.md`. `## Stop-state` required when `Status: In-progress`.
- **Optional escape hatch** — `## Notes` for narrative rationale (≤ 200 words). Code-snippet carve-out: ≤ 5 lines, only when the orchestrator needs verbatim text.
- **Forbidden patterns** — narrative preamble · restated dispatch context · code snippets outside the carve-out · verbose rationale outside `## Notes` · parenthetical comma-soup.
- **Self-lint at report-as-done** — 6 mandatory checks (5 from D22-doc-authoring-protocol / D26-doc-protocol-scope-extension + "no narrative preamble"); LLM self-review against the schema before returning. No external linter.
- **Mandatory marker (D33-d29-enforcement-hardening)** — every return ends with the literal line `<!-- D29 self-lint: pass -->` as attestation that the 6 checks ran. Absence = structural skip signal; orchestrator surfaces the advisory at receive-time + carries the rule forward to the next dispatch. Marker is not a pass/fail gate; the return is still consumed.
- **Orchestrator on non-compliance** — surfaces one-line advisory · consumes the return · never re-dispatches purely for format · never auto-rewrites · skill-runner forbidden from "cleaning up" the return before passing to team-lead (D28-skill-runner-boundary boundary).

Full schema (cardinality table · default-shape map · caps · forbidden patterns · 6 checks · worked size targets): **`core/templates/phase-report.md`**.

## Coordination protocol

| Trigger | Rule |
|---|---|
| Any PR | Cite requirement / NFR / architecture-doc section / mockup section implemented or validated. Template: `core/templates/pr-description.md`. |
| Wire-contract breaking change (API shape, event format, env-var names) | Flag in PR title. Service-owning role + client-owning role + `devops-engineer` all confirm before merge. |
| Cost-relevant change (new resource, larger SKU) | Fresh estimate vs. project cost cap in PR description. `devops-engineer` owns. |

### Load-on-demand specs — kernel summary + load triggers

Each row gives the spec's kernel summary + full-spec path + load triggers. Default short tasks do not load these unless a trigger fires.

#### Project-doc + code-derived index — `local/index/`

- Heavy project docs (architecture · mockup · ADRs · CRs · scenarios + any adopter-specific class) → lightweight summaries under `local/index/`.
- Roles read the index first; originals only when an entry points to a section needing verbatim consumption.
- Full spec + extraction recipes + staleness mechanism: **`core/protocols/index-protocol.md`**. `.idx` DSL grammar: **`core/index-syntax.md`**.
- **Load triggers:** `team-lead` enumerates classes during initial discovery or `rediscover` · `team-lead` detects SHA-256 drift in `local/index/manifest.yaml` pre-dispatch · `ai-engineer` dispatched to extract or re-extract · role's "Source of truth" lookup pointed at `local/index/<file>` needs the protocol contract (rare).

#### Team-lead-only specs

Three specs are orchestration-only and live in `core/process/dispatch.md § Team-lead-only load-on-demand specs` (loaded only by `team-lead` and the skill-runner main thread on `ginee-*` skill entry): **GitHub integration — issues + discussions** · **Triage scoring — value × complexity priority** · **Post-task check-in**. Cross-references from specialist outputs continue to resolve at their full-spec paths (`core/github-integration.md` · `core/triage-scoring.md` · `core/post-task-check-in.md`); specialists need not load the kernel summaries.

#### Delivery modes — branch+PR / working-tree / commit-no-push

- Every task resolves to one of three modes: **Mode 1** (feature branch + PR) / **Mode 2** (working-tree only) / **Mode 3** (commit-no-push).
- Picked via per-task prefix (`branch:` / `wt:` / `commit:`), Phase-3 user answer, or `local/framework.config.yaml § delivery.default-mode`.
- Resolved before Phase 4; honoured through Phase 8 finalize.
- Full spec (precedence · per-mode procedure · auto-mode integration · forbidden actions): **`core/delivery-modes.md`**.
- **Load triggers:** `team-lead` about to dispatch a task needs to resolve / propose the mode · specialist enters Phase 4 needs commit cadence · `team-lead` at Phase 8 finalize · auto-mode delivery-handoff (D12-automatic-mode) Accept action fires.

#### Strict-domain rule — no specialist works outside its domain

- A bug in domain X is fixed by the engineer who owns X. Never by an adjacent specialist "while they're in the area". Cross-domain bugs require collaboration, not single-specialist heroics.
- **Project-specific forbidden role-crossings table:** `local/bindings.md` → "Project role boundaries". Each row is a hard stop; propose a hand-off in the final report instead.
- **Size is not an exemption.** Estimated effort (in-thread "5-min fix", "tiny tweak") does not override surface ownership. Dispatch the owning specialist; if scope is genuinely ≤ 15 min, dispatch flags it explicitly so the iteration-protocol load is skipped.
- **Regression-grade failure modes.** Catalogued in `team-lead.details.md § Common failure modes` — orchestrator self-check before any in-thread edit on a specialist-owned surface.

#### Doc roles — all-roles authorship + ai-engineer shape (D25-classical-architect)

- **Ownership split.** Authoring role owns documentation **semantics** per `core/doc-roles.md § Authorship` — authoring role differs by doc class (SA · team-lead · backend-engineer · frontend-engineer · devops-engineer · qa-engineer · mockup-owning role). `ai-engineer` owns **shape + load topology** across the whole doc set. Neither overrides the other's invariants.
- **Runs under** `core/protocols/iteration-protocol.md` below.
- Full definition (authorship table · routing table · lossless edit rule · SA architectural-coherence review · dispatch triggers): **`core/doc-roles.md`**.
- **Load triggers** (when to fetch the full file): new role-owned doc landing · doc grows past size threshold · cross-reference repair after a split/move · structure dispute (author vs. ai-engineer).

#### Iteration protocol — propose → review → implement

- Generalized loop for non-trivial work.
- Full definition (scope · estimation-first dispatch · sizing · each-iteration steps · loop termination · conflict resolution · stoppable intermediate states · timeframe-bounded autonomous work): **`core/protocols/iteration-protocol.md`**.
- **Load triggers** — orchestrator (or specialist) fetches when any holds: Phase 4 / 5 / 6 / 7 dispatch with estimated total scope > 15 min · doc-roles pass between `ai-engineer` and any authoring role (per `core/doc-roles.md`) · user gives a timeframe (e.g., "spend 30 min on X"). Default short tasks ( ≤ 15 min, no timeframe ) do not load this file.

#### Cross-domain bugs — integration + compliance cycle

- **Trigger.** A bug spans 2+ domains.
- **Model.** Four-phase: (1) contract change · (2) parallel domain implementations · (3) integration verification with manual smoke · (4) compliance review.
- **Full procedure** (manual-smoke checklist + anti-pattern rules): `core/cross-domain-bugs.md`. Load when a cross-domain bug or task is detected.
- **Lifecycle mapping:** cycle Phases 1 / 2 / 3 / 4 → lifecycle Phases 2 / 4 / 5–6 / 7. Detailed mapping table in `core/process/dispatch.md § Relation to the cross-domain bugs cycle`.

#### Cross-agent handoff — diagnose ≠ fix

- When a specialist discovers a root cause **outside** their domain: diagnose fully, do NOT fix, hand off to the owning specialist with a structured note.
- Full procedure (5-step hand-off · orchestrator wiring · doc-update routing): **`core/cross-agent-handoff.md`**.
- **Load triggers:** specialist's final report flags a root cause outside their domain · orchestrator detects a hand-off-shaped event and needs the procedure. Default in-domain tasks do not load this file.

