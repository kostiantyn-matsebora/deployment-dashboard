# Engineering Process

## Purpose

- Generic, project-agnostic process model for a small multi-agent engineering team.
- Authoritative spec for every role (orchestrator + specialists).
- **Project-specific knowledge lives elsewhere** — never in this file:
  - Stack, repo layout, role roster, forbidden role-crossings, owned-paths bindings → `local/bindings.md` + `local/project-profile.md`.

## Reading order

| File | Role | Owner |
|---|---|---|
| `core/process.md` (this file) | Generic lifecycle, dispatch rules, principles | upstream framework |
| `core/roles/*.md` | Generic role charters (7 cardinals) | upstream framework |
| `local/bindings.md` | Per-project role → owned paths/concerns table | the project |
| `local/project-profile.md` | Per-project stack, domain, architecture artefacts | the project (written by `team-lead` on discovery) |
| `local/framework.config.yaml` | Concept → file-path mapping (architecture doc, mockup, API contract, ADR dir, TODO file, ...) | the project |

**Conflict resolution:**

| Conflict class | Winner |
|---|---|
| Per-project routing | `local/bindings.md` |
| Generic process rule | `core/process.md` (this file) |

Bindings may NOT override generic process.

**Invocation notation.** This spec uses `@<role>` as vendor-neutral shorthand for "dispatch to that role." The literal `@<agent>` syntax works in some clients (Cursor) but not others (Claude Code). Per-client invocation surfaces (AgentSkills, natural-language routing, etc.) ship via the adapters — see `adapters/<x>/install.md § How to invoke`. Framework workflows (discovery / file / pick-up / triage / promote / reindex / update) auto-activate as Skills in any AgentSkills-compatible client; specialist dispatches route via subagent description match.

## Dispatch & parallelism rules

| Rule | Action |
|---|---|
| Independent work (no shared contract change) | Dispatch specialists in parallel in ONE message. |
| N independent specialists in one phase | ONE message with N dispatch calls. Never serialize across messages. |
| Cross-phase overlap (e.g. quality authoring tests while client implements) | ONE message with all overlapping specialists; each prompt names the shared contract surface (architecture-doc §X, mockup behaviour Y, wire shape Z). |
| Parallel-by-default for cross-domain Phase 2 | Default for Phase 2 of the cross-domain cycle is parallel. Justify any sequential Phase 2 dispatch in the dispatch prompt itself (one sentence). Habitual serialization is the failure mode. |
| Doc-only changes | `solution-architect` only (architecture-family) or mockup-owning role only (UI-only edit with no architecture implication). |
| Infrastructure changes affecting application config (env var, secret, endpoint URL) | Coordinate `devops-engineer` + affected service-owning role; service-owner first to confirm the app reads the new value, devops second. |
| Surface owns the dispatch decision | Routing is determined by the touched surface per `local/bindings.md` — never by estimated task size. "Looks fast" is not grounds to self-execute or assign to a non-owning role. |

**Overlap patterns** — next phase starts when its contract surface is fixed, not when prior phase's code lands:

- **Test authoring overlaps implementation.**
  - Trigger: Phase 2 fixes wire shape / mockup behaviour.
  - `qa-engineer` authors specs and fixtures in parallel with implementation.
  - Both reference the contract — not each other's source.
- **Bug fix overlaps continued testing.**
  - QA reports a defect.
  - Owning engineer fixes immediately.
  - QA continues exercising other scenarios in parallel.
- **Doc update overlaps implementation.**
  - `solution-architect` hands engineers the contract context.
  - Engineers proceed.
  - SA updates architecture doc / project-instruction files / ADRs in parallel.
  - The doc commit is a paper trail, not a gate.

**Implementation gate.**

- Phase 4 starts only when:
  - Phase 2 contract surface is fixed, AND
  - Phase 3 design-review gate has passed.
- No engineer codes against an unapproved design.

## Task lifecycle — phased pipeline with maximum parallelism

**Binding.**

- Phases are named and ordered.
- Specialists within a phase run in parallel.
- Phases overlap wherever a contract surface decouples them.
- Each phase carries: **Goal · Acceptance** (and additional anchors where the phase warrants).

### Phase 1 — Analysis

- **Goal.** Bound scope; identify touched domains.
- **Reads.** TODO line + relevant architecture sections + mockup + code.
- **`solution-architect` design dip (D25).** On any non-trivial scope, SA elicits the requirements register (FRs / NFRs / constraints in `local/requirements.md`) AND derives the ASR utility tree (`local/asr-utility-tree.md`) per `core/roles/solution-architect.md § Design`. Resolves **greenfield vs delta** mode. Output goes to Phase 2 dispatch.
- **Output.** Phase 2 dispatch plan + requirements / ASR diff + resolved design mode + surfaced ambiguities.
- **Acceptance.** Scope bounded enough to plan Phase 2. ≤ 1 unresolved scope question. ASR utility tree captures every quality-attribute-driver the proposed change touches.

### Phase 2 — Design & architecture

- **Goal.** Lock contracts before any code — system, API, visual, work breakdown.
- **Dispatch.** Owning role per `local/bindings.md`:

  | Surface | Owner |
  |---|---|
  | Target architecture (system / infrastructure / security / data / integration) | `solution-architect` per `core/roles/solution-architect.md § Design` |
  | ADRs + diagrams + requirements / ASR updates | `solution-architect` |
  | Mockup | mockup-owning role |
  | Wire contract | service-owning role |
  | Work breakdown | `team-lead` (per D25); each engineer contributes their slice |
  | Engineer-proposed architectural deltas | originating engineer drafts; `solution-architect` reviews per `§ Review` (APPROVE / REJECT / REQUEST-CHANGES) |

  Parallel where independent. **Mode-aware** — greenfield mode authors the architecture doc; delta mode produces ADRs + CRs and never rewrites the doc wholesale.
- **Acceptance.**
  - Fixed wire shape + mockup behaviour + work breakdown.
  - Visual / contract harness green (where one exists).
  - Cross-references resolved.
  - Artefacts presentable as a coherent whole.
  - ASRs traceable to ADRs (each ASR is addressed by ≥ 1 ADR OR an existing architecture-doc section).

### Phase 3 — Design review

- **Goal.** Synchronous gate — explicit user approval of Phase 2 before implementation.
- **Action.** Orchestrator MUST present: architecture-doc diff + mockup link + API contract + work-breakdown.
- **Outcomes.**
  - Approval → Phase 4 dispatches.
  - Remarks → loop back to Phase 2.
- **Distinct from.** Phase 8 (closes TODO); TODO-workflow checkpoint (sits before Phase 1).
- **Acceptance.** Explicit user approval. Without it, Phase 4 does not start.
- **In automatic mode.** Elided when Phase 2 produces no user-visible behaviour change. Forced back to interactive per `core/automatic-mode.md § Forced-interactive triggers`.

### Phase 4 — Implementation

- **Goal.** Working code mirroring approved Phase 2 contracts.
- **Rules.**
  - Each engineering role implements its part in its owned paths (`local/bindings.md`).
  - Parallel where independent.
  - Phase 5 overlaps once Phase 3 passes.
  - Runs under `core/iteration-protocol.md`.
- **`solution-architect` governance dip (D25).** Triggered only when the in-flight PR touches an SA-owned file per `local/bindings.md § Source-of-truth ownership` (NOT every Phase 4 PR). Spot-checks engineer deltas against architecture invariants + ASRs. Drift → PR comment + dispatch back to owning engineer. Per `core/roles/solution-architect.md § Governance`.
- **`solution-architect` review on in-flight proposals (D25).** If an engineer proposes an architectural change mid-Phase 4 (new contract / topology / stack / NFR-affecting decision), SA reviews per `§ Review` — APPROVE / REJECT / REQUEST-CHANGES. SA never edits the engineer's code.
- **Acceptance.**
  - Compiles / builds clean.
  - Per-project unit tests pass.
  - No new lint or type errors.

### Phase 5 — Testing

- **Goal.** Verify implementation against contracts: executable suites + manual smoke against the running solution.
- **Scope — change-scoped by default.** Run only:

  | Layer | What runs |
  |---|---|
  | New / modified scenarios | functional / API / e2e / harness / script for touched code paths |
  | Per-project unit specs | in modified files |
  | Pre-existing scenarios | only if their covered contract was edited in Phase 2 or 4 |

- **Full regression — opt-in only.**
  - User must explicitly request it.
  - `team-lead` MAY remind it's available (wide-reach refactor / infra change / risky touch).
  - `team-lead` MUST warn of significant wall-clock + token cost.
  - Runs separately AFTER change-scoped pass is green.
  - Reports: pass/fail per suite + wall-clock + approximate token cost.
- **Discipline.**
  - Tests reference contracts, not implementation internals.
  - Oracles TIGHT per `### Test oracles can be wrong`.
  - Manual smoke against the running solution (project's local-dev startup command), NOT design artefacts.
  - Runs under `core/iteration-protocol.md`.
- **`solution-architect` governance dip (D25).** Triggered when an NFR-oracle fails or a test surfaces an architectural concern (e.g. latency NFR breached, contract drift visible in failed assertion). SA reviews per `§ Governance`; never edits test code; routes the architectural finding back through Phase 6 or as a new ADR.
- **Acceptance.**
  - Change-scoped suite green.
  - Oracles reflect correctness for touched surfaces.
  - Manual-smoke report recorded (caveat if not run, e.g. headless).
  - Failures → Phase 6.
  - Opt-in full regression is its own pass — not a precondition.

### Phase 6 — Bug fixing

- **Goal.** Resolve defects from Phase 5 (or manual smoke) until all change-scoped oracles are green.
- **Rules.**
  - Owning engineer fixes the failing surface.
  - QA exercises other scenarios in parallel — a fix never freezes the test run.
  - Routes back to the specific Phase 4 surface, not a full Phase 4 rerun.
  - Runs under `core/iteration-protocol.md`.
- **`solution-architect` review on architectural fixes (D25).** If a proposed fix involves an architectural change (vs. local bug fix), SA reviews per `§ Review`. APPROVE → engineer implements; REJECT / REQUEST-CHANGES → iterate. Local bug fixes route directly engineer → engineer, no SA dispatch.
- **Acceptance.**
  - Change-scoped oracles green.
  - No regression in touched surfaces.
  - Manual smoke re-run if a user-visible surface was touched.
  - Opt-in full regression is part of that opt-in pass — not a Phase 6 gate.

### Phase 7 — SA review

- **Goal.** `solution-architect` confirms compliance with architecture invariants, requirements, mockup behavioural contracts.
- **Lighter under D25.** Governance already ran continuously across Phase 4 / 5 / 6 (per `core/roles/solution-architect.md § Governance`); Phase 7 is the **final coherence check**, not a first-pass review. Most concerns should already be resolved.
- **Checks.**
  - Architecture invariants honoured (cross-check against ASR utility tree).
  - Mockup behavioural contract honoured.
  - Phase 5 manual-smoke section was actually written (empty = REJECT, return to Phase 5).
  - ASR coverage — every ASR touched by the change is addressed by ≥ 1 ADR or architecture-doc section.
- **Constraint.** Sign-off only; no code edits.
- **Iteration.** Runs under `core/iteration-protocol.md` when follow-up architecture-doc edits exceed 15 min.
- **Acceptance.**
  - APPROVE (with or without pending additive architecture-doc edits), OR
  - RETURN-TO-engineer with specific findings.

### Phase 8 — User approval

- **Goal.** User confirms delivered work satisfies the TODO line.
- **Action.** Orchestrator surfaces per the Task model. If manual smoke wasn't run (e.g. headless), asks the user to run it.
- **User choices.**
  - "Yes — mark complete" → see Acceptance below.
  - "No — needs more work" → loop back to Phase 6 with feedback.
- **Acceptance.**
  - TODO line `☐` → `☒` (TODO-sourced).
  - Issue closed + final comment (GitHub-issue-sourced; per `core/github-integration.md`).
  - Project-progress refresh (if used).
  - **Delivery finalize** per the resolved delivery mode — `core/delivery-modes.md`:
    - Mode 1 (branch + PR) → push branch + open PR per `core/templates/pr-description.md`.
    - Mode 2 (working-tree only) → surface diff; user commits / discards manually.
    - Mode 3 (commit-no-push) → surface commit list; user pushes manually.
  - Never commit / push outside the resolved mode (the framework's "commit only when the user explicitly asks" invariant is realized via mode selection at Phase 3, not silent commits).
- **In automatic mode.** Realized as the **delivery handoff** per `core/automatic-mode.md § Delivery handoff`.
  - User-approval invariant preserved: single explicit accept.
  - Accept / Feedback / Reject replace yes/no.
  - Accept's concrete action depends on resolved mode (see `core/delivery-modes.md § Auto-mode integration`).
- **Post-acceptance doc-optimization hook.** If the task touched any documentation (project-instruction files, architecture docs, role definitions, ADRs, CRs, READMEs):
  - Orchestrator MUST dispatch `ai-engineer` to run `core/iteration-protocol.md` scoped to the doc diff.
  - Polish step, not a gate.
  - First proposal batch returns "no productive proposals" → hook completes immediately.
  - No user permission required to invoke.
  - User sees the cumulative optimization diff in the final report; may accept or revert as a unit.

### Cross-phase rule

- Artefact classes do not cross phases.
- A change needing both design and code:
  1. Phase 2 — land design artefacts in docs.
  2. Phase 4 — land code artefacts in solution.

### Relation to the cross-domain bugs cycle

- Source: `core/cross-domain-bugs.md` — specific instantiation of this lifecycle for bugs cutting across 2+ domains.
- **Phase mapping:**

  | Cross-domain phase | Lifecycle phase |
  |---|---|
  | 1 — contract change | 2 (design) |
  | 2 — domain implementations | 4 (implementation) |
  | 3 — integration + bug fixing | 5–6 (test + fix) |
  | 4 — compliance review | 7 (SA review) |

- Lifecycle Phase 3 (design review) still applies when the bug requires user-visible behaviour change.

## Automatic mode

- **Trigger.** Task prefixed `auto:`, OR `team-lead`-proposed and user-accepted.
- **Effect.** Lifecycle runs end-to-end without per-phase user gates; presents a single final delivery handoff.
- **Default.** Interactive (no auto mode).
- **Full definition** — activation triggers, gates elided/respected, forced-interactive triggers, delivery handoff procedure: `core/automatic-mode.md`. `team-lead` loads on activation.
- **Invariant preserved.** Phase 8 user-approval = the single delivery-handoff gate.

## Engineering principles — apply across all roles

### Configuration vs. data — declarative over imperative

- Binds every role.
- Signal a value belongs in a declarative file: "hard to change without editing imperative code".

**Configuration** (URLs, ports, env vars, feature flags, retention windows, defaults):

- Lives in declarative files per tier (project stack determines format):

  | Tier | Typical file |
  |---|---|
  | Service runtime | environment file / app-settings config |
  | Client runtime | environment file / build-config |
  | Container orchestration | `docker-compose.*.yml` / Helm values |
  | IaC | `*.tfvars` / Pulumi config / etc. |
  | Scripting / tooling | `*.json` / `*.yaml` config files |

- **Never** as literals inside controllers, components, scripts, or test specs.

**Data** (fixtures, seed sets, snapshot baselines, expected payloads, scenarios):

- Lives in dedicated declarative files.
- **Never** as inline literals inside test code.

**Imperative code stays thin.**

- Scripts / runners / wrappers read declarative files and call the underlying tool.
- Exceptions require a doc update before they land.

### Test oracles can be wrong

- A passing test against broken software = defect in the oracle, not a green light.
- Test results contradict observed behaviour → trust observed behaviour; route to test owner to tighten assertion.
- Examples of weak oracles:
  - Harness anchored to wrapper, not inner element.
  - POST asserting status without response shape.
  - UI element opened without exercising its action.
- Tightening is `qa-engineer`'s job; respecting the signal is everyone's.

## Documentation style — structure over prose

**Binding, not aspirational** for both framework-self-dev outputs (per `CLAUDE.md § Framework authoring`) and adopter-project outputs authored by any role (per **D22** — full protocol + 6 paired examples + discovery-driven enforcement in `core/doc-authoring-protocol.md`).

Applies to **all** written artefacts:

- Project-instruction files.
- Role definitions (`core/roles/`, `local/roles/`).
- Future skills.
- Architecture doc, mockup, ADRs.
- Per-component READMEs.
- **GitHub issue bodies authored via `ginee-file-*` skills** (D26).
- **Framework-authored GitHub comments** — Phase-transition · sticky `ginee:score` / `ginee:review-cycle` · audit comments · per-thread review-replies (D26).

- **Default to structure** — bullets, numbered lists, tables, headings. Not prose paragraphs.
- **Steps / actions / instructions** → bullet list. Never a multi-sentence paragraph.
- **Pairs, mappings, choices** → table. Examples: "Before / after", "concern → owner", "endpoint → status code".
- **One idea per bullet.** A bullet wanting three sentences → promote to sub-list or table.
- **Headings carry weight.**
  - Use `##` / `###` to chunk.
  - Don't bury rules inside walls of prose.
- **Code shapes go in fenced code blocks** — wire formats, env vars, file paths, commands.
- **Cross-reference, don't duplicate.** Cite the section ("per architecture-doc §X"); don't restate.
- **Drop filler.**
  - No "It is important to note that…", "Please ensure…", "In general…".
  - Lead with the verb or noun.
- **Prose is for narrative exposition only** — explaining *why*. Keep tight.
- **Framework-self-dev (D21).** Framework-source PRs in the ginee repo are gated by `scripts/context-economy-check.ps1` (Claude Code hook + git hooks + CI workflow). Threshold breach without an `Optimized-By: ai-engineer` trailer fails the gate. Spec: `core/MIGRATIONS/D21-context-economy-gates.md`.

### Default-shape map (D22)

| Doc artefact | Default shape |
|---|---|
| Component / service / image / endpoint / env-var inventory | Table |
| Design properties, invariants, NFRs | Bullet list — one rule per bullet |
| Sequence / workflow / runbook steps | Numbered list |
| Term definitions | `**Term.** Gloss.` lines |
| Trade-off / decision-rationale | Two-column table (option / consequence) |
| Narrative *why* (rationale only) | Prose — tight, < 4 sentences |

### Mandatory checks before report-as-done (D22)

1. No paragraph contains > 2 rules (sentence terminators: `. ` `! ` `? `).
2. No table cell holds a multi-sentence sub-paragraph.
3. No bullet runs > 25 words *unless* it carries nested sub-bullets.
4. Inventories (services, components, endpoints, env vars) are tables, not prose.
5. Cross-references cite anchors (`§Name`, `#anchor`); never restate content.

**Enforcement procedure** (lint command, attestation format, no-tool fallback): `core/doc-authoring-protocol.md` — load at Phase 5 / report-as-done.
**Paired bad-vs-good examples** (6 doc classes): `core/doc-authoring-examples.md` — load on first-time authoring or explicit request.

## Coordination protocol

| Trigger | Rule |
|---|---|
| Any PR | Cite requirement / NFR / architecture-doc section / mockup section implemented or validated. Template: `core/templates/pr-description.md`. |
| Wire-contract breaking change (API shape, event format, env-var names) | Flag in PR title. Service-owning role + client-owning role + `devops-engineer` all confirm before merge. |
| Cost-relevant change (new resource, larger SKU) | Fresh estimate vs. project cost cap in PR description. `devops-engineer` owns. |

### Project-doc index — local/index/

- Heavy project docs (architecture, mockup, ADRs, CRs, scenarios, plus any adopter-specific doc class) → lightweight summaries under `local/index/`.
- Roles read the index first; originals only when an index entry points to a section needing verbatim consumption.
- Full spec + extraction recipes + staleness mechanism: **`core/index-protocol.md`**.
- `.idx` DSL grammar: **`core/index-syntax.md`**.

**Load triggers:**

- `team-lead` enumerates classes during initial discovery or `rediscover`.
- `team-lead` detects SHA-256 drift in `local/index/manifest.yaml` pre-dispatch.
- `ai-engineer` is dispatched to extract or re-extract.
- Role's "Source of truth" lookup pointed at `local/index/<file>` and the role needs the protocol contract (rare).

Default short tasks do not load these specs.

### GitHub integration — issues + discussions

`team-lead` files, picks up, triages, and closes GitHub issues as a task source alongside TODO files and direct instructions; promotes discussions to issues on user request; threads phase progress as issue comments; links resulting PRs to issues via `Closes #N`. Full spec — tool surface (gh CLI / MCP / HTTPS), repo discovery (origin inference + override), label scheme, state mapping, outbound/inbound/triage/promote workflows, forbidden actions: **`core/github-integration.md`**.

**Load triggers:**

- `team-lead` dispatched to file an issue (`file bug` / `file feature`).
- `team-lead` dispatched to pick up / triage an issue (`pick up #<N>` / `triage`).
- `team-lead` dispatched to promote a discussion (`promote discussion #<N>`).
- Specialist needs to post phase-transition progress on a tracking issue mid-task.

Default tasks not sourced from a GitHub issue (TODO files, direct instructions) do not load this file.

### Triage scoring — value × complexity priority

- `ginee-triage` ranks ready work by `score = value / complexity` (default WSJF formula; `H=3, M=2, L=1`).
- Two label namespaces (ATAM convention): `value:high|medium|low` + `complexity:high|medium|low`; TODO equivalent `☐ [v:H c:L] …`.
- On pickup: `team-lead` asks user (H/M/L) for missing `value`; dispatches `solution-architect` for missing `complexity`.
- Full spec (axes, formula, label provisioning, auto-estimate hook, TODO parser, sort contract, adopter overrides): **`core/triage-scoring.md`**.

**Load triggers:**

- `team-lead` runs `triage` and needs the sort contract.
- `team-lead` picks up an issue and needs to evaluate / record scoring labels.
- `ginee-triage` / `ginee-pick-up` skills sort or auto-estimate.

Default freeform tasks and untagged TODOs do not load this file.

### Delivery modes — branch+PR / working-tree / commit-no-push

- Every task resolves to one of three modes: **Mode 1** (feature branch + PR) / **Mode 2** (working-tree only) / **Mode 3** (commit-no-push).
- Picked via per-task prefix (`branch:` / `wt:` / `commit:`), Phase-3 user answer, or `local/framework.config.yaml § delivery.default-mode`.
- Resolved before Phase 4; honoured through Phase 8 finalize.
- Full spec (precedence, per-mode procedure, auto-mode integration, forbidden actions): **`core/delivery-modes.md`**.

**Load triggers:**

- `team-lead` is about to dispatch a task and needs to resolve / propose the mode.
- A specialist enters Phase 4 and needs to know the commit cadence.
- `team-lead` is at Phase 8 finalize.
- Auto-mode delivery-handoff (D12) Accept action fires.

### Strict-domain rule — no specialist works outside its domain

- A bug in domain X is fixed by the engineer who owns X.
- Never by an adjacent specialist "while they're in the area".
- Cross-domain bugs require collaboration, not single-specialist heroics.
- **Project-specific forbidden role-crossings table:** `local/bindings.md` → "Project role boundaries".
  - Each row is a hard stop.
  - Propose a hand-off in the final report instead.
- **Size is not an exemption.** Estimated effort (in-thread "5-min fix", "tiny tweak") does not override surface ownership. Dispatch the owning specialist; if scope is genuinely ≤ 15 min, dispatch flags it explicitly so the iteration-protocol load is skipped.
- **Regression-grade failure modes.** Catalogued in `team-lead.details.md § Common failure modes` — orchestrator self-check before any in-thread edit on a specialist-owned surface.

### Doc roles — all-roles authorship + ai-engineer shape (D25)

- **Ownership split:**
  - Authoring role owns documentation **semantics** per `core/doc-roles.md § Authorship`. Per D25, the authoring role differs by doc class (SA · team-lead · backend-engineer · frontend-engineer · devops-engineer · qa-engineer · mockup-owning role).
  - `ai-engineer` owns **shape + load topology** across the whole doc set.
  - Neither overrides the other's invariants.
- **Runs under** `core/iteration-protocol.md` below.
- **Full definition** (authorship table + routing table + lossless edit rule + SA architectural-coherence review + dispatch triggers): `core/doc-roles.md`.
- **Load triggers** (when to fetch the full file):
  - New role-owned doc landing.
  - Doc grows past size threshold.
  - Cross-reference repair after a split/move.
  - Structure dispute (author vs. ai-engineer).

### Iteration protocol — propose → review → implement

Generalized loop for non-trivial work. **Full definition** (scope, estimation-first dispatch, sizing, each-iteration steps, loop termination, conflict resolution, stoppable intermediate states, timeframe-bounded autonomous work): **`core/iteration-protocol.md`**.

**Load triggers** — orchestrator (or specialist) fetches the file when any holds:

- Phase 4 / 5 / 6 / 7 dispatch with estimated total scope > 15 min.
- Doc-roles pass between `ai-engineer` and any authoring role (per `core/doc-roles.md`).
- User gives a timeframe (e.g., "spend 30 min on X").

Default short tasks ( ≤ 15 min, no timeframe ) do not load this file.

### Cross-domain bugs — integration + compliance cycle

- **Trigger.** A bug spans 2+ domains.
- **Model.** Four-phase:
  1. Contract change.
  2. Parallel domain implementations.
  3. Integration verification with manual smoke.
  4. Compliance review.
- **Full procedure** (manual-smoke checklist + anti-pattern rules): `core/cross-domain-bugs.md`. Load when a cross-domain bug or task is detected.
- **Lifecycle mapping:** cycle Phases 1 / 2 / 3 / 4 → lifecycle Phases 2 / 4 / 5–6 / 7.

### Cross-agent handoff — diagnose ≠ fix

When a specialist discovers a root cause **outside** their domain: diagnose fully, do NOT fix, hand off to the owning specialist with a structured note. **Full procedure** (5-step hand-off, orchestrator wiring, doc-update routing): **`core/cross-agent-handoff.md`**.

**Load triggers:**

- Specialist's final report flags a root cause outside their domain.
- Orchestrator detects a hand-off-shaped event and needs the procedure.

Default in-domain tasks do not load this file.

## Task model

Phase 1–8 applies to any task. A task originates from one of four sources:

| Source | Scope | State mechanic |
|---|---|---|
| Repo-root `TODO` (file name per `local/framework.config.yaml` → `todo`) | Project-wide | Glyphs `☐` / `☒`; orchestrator updates the line on completion |
| Nested `TODO` (e.g., `client/TODO`, `service/api/TODO`) | Component-scoped | Same glyph mechanic, scoped to that component file |
| Direct user instruction | Ad hoc; scope inferred from the instruction | No `TODO` file; no glyph mechanic |
| GitHub issue (per `local/framework.config.yaml § github.repo`) | Project-wide; routed via `## Affected area` field in issue body | Native `open`/`closed` + configurable labels (`ginee:ready` / `:in-progress` / `:blocked`); PM swaps labels per phase; closes on Phase 8 acceptance. Full spec: `core/github-integration.md`. |

**TODO file rules.**

- User-curated at any location — never auto-generated, never auto-extended.
- Glyphs:
  - `☐` = open.
  - `☒` = completed.
- Optional priority marker `[v:H c:L]` between glyph and description (H / M / L, case-insensitive); ranked by `ginee-triage` per `core/triage-scoring.md`.

**GitHub issue rules.**

- Reporter-authored (user or anyone with repo access) — never auto-created without explicit user approval.
- Pickup is always explicit (`@team-lead pick up #<N>` / `triage`). Never auto-picked on session start.
- Issue body is reporter-owned; PM may add comments + swap framework labels but does not edit the body.
- PR descriptions for issue-sourced tasks include `Closes #<N>` so GitHub auto-closes the issue on merge.
- Priority signals via `value:high|medium|low` + `complexity:high|medium|low` labels (ATAM convention); ranked by `ginee-triage` per `core/triage-scoring.md`.

### Post-task check-in

After every completed user request, orchestrator runs a check-in: pick next pending TODO item, ask the user a fixed set of options, mark `☐` → `☒` on Yes. **Full procedure** (4-step check-in, TODO option tables, cross-cutting rules, nested-TODO discovery): **`core/post-task-check-in.md`**.

**Load triggers:**

- A user request just completed (work delivered or question answered).
- Phase 8 user-approval is about to fire (interactive mode), OR delivery handoff Accept fires (auto mode).

Mid-task turns do not load this file.
