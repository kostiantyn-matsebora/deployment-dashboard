# Engineering Process

## Purpose

Generic, project-agnostic process model for a small multi-agent engineering team. Read by every agent (orchestrator + subagents) as the authoritative process spec; project-specific rules (stack, repo layout, agent roster, forbidden role-crossings table) live in the project's `CLAUDE.md` and the project's authoritative architecture docs.

## Dispatch & parallelism rules

Single canonical section. Apply to every cross-domain dispatch decision.

| Rule | Action |
|---|---|
| Independent work (no shared contract change) | Dispatch agents in parallel in ONE message. |
| N independent agents in one phase | ONE message with N `Agent` tool calls. Never serialize across messages. |
| Cross-phase overlap (e.g. qa authoring tests while frontend implements) | ONE message with all overlapping agents; each prompt names the shared contract surface (SAD §X, mockup behaviour Y, wire shape Z). |
| Parallel-by-default for cross-domain Phase 2 | Default for Phase 2 of the cross-domain cycle (see below) is parallel. Justify any sequential Phase 2 dispatch in the dispatch prompt itself (one sentence — e.g. "frontend needs qa's generated mock types as input"). Habitual serialization is the failure mode. |
| Doc-only changes | `solution-architect` only (SAD-family) or `frontend-engineer` only (mockup-only HTML/CSS/JS tweak with no SAD implication). |
| Infrastructure changes affecting application config (env var, secret, endpoint URL) | Coordinate `devops-engineer` + `backend-engineer`; backend first to confirm the app reads the new value, devops second. |

Overlap patterns (next phase starts when its contract surface is fixed, not when the prior phase's code lands):

- **Test authoring overlaps implementation.** Once the wire shape / mockup behaviour is fixed (Phase 2 output), `qa-engineer` authors specs and fixtures in parallel with `backend-engineer` / `frontend-engineer` coding. Both reference the contract, not each other's source.
- **Bug fix overlaps continued testing.** When QA reports a defect, the owning engineer fixes immediately while QA continues exercising other scenarios.
- **Doc update overlaps implementation.** `solution-architect` hands engineers the contract context (decision wording, FR/NFR delta, wire-shape change); engineers proceed; SA updates SAD / `CLAUDE.md` / `ci-cd-integration.md` / ADRs in parallel. The doc commit is a paper trail, not a gate.

Implementation gate: Phase 4 (implementation) starts only when the Phase 2 contract surface is fixed AND the Phase 3 design-review gate has passed. No engineer codes against an unapproved design.

## Task lifecycle — phased pipeline with maximum parallelism

**Guidance — binding, not flavour.** Operate the lifecycle as a real software-engineering team operates: separation of concerns, contract-driven parallelism, testing as a first-class deliverable, fail-fast on contract drift, no idle agents. Phases are named and ordered; agents within a phase run in parallel; phases overlap wherever a contract surface decouples them.

Each phase below: **Goal · Actions · Artefacts · Criteria of acceptance.**

### Phase 1 — Analysis
- **Goal.** Understand the problem; define scope boundary; identify which domains the work touches.
- **Actions.** Read the TODO line, relevant SAD sections, mockup, existing code as needed. Surface ambiguities. Ask clarifying questions when scope is unclear. Decide which agents Phase 2 will dispatch.
- **Artefacts.** Problem statement + scope boundary in the orchestrator's plan or the discovering agent's final report. Occasionally a discovery note under `docs/`.
- **Acceptance.** Scope bounded sufficiently for the orchestrator to plan Phase 2 dispatches. ≤ 1 unresolved scope question outstanding.

### Phase 2 — Design & architecture
- **Goal.** Lock contracts (system, API, visual, WBS) before any code is written. User must be able to review the design as a coherent whole.
- **Actions.** `solution-architect` edits SAD + ratifies API contract before Phase 3 opens. `frontend-engineer` edits the mockup + design notes. `backend-engineer` drafts the HTTP/JSON contract (SPA-visible side is `frontend-engineer`'s). All engineers contribute to the WBS. Dispatched in parallel where independent.
- **Artefacts.** Documents under `docs/`: SAD, mockup, design notes (`ui-*.md`), API contract proposals, ADRs. CLAUDE.md amendments where process/governance changes.
- **Acceptance.** Fixed wire shape + fixed mockup behaviour + fixed WBS. Mockup-visual harness green. All cross-references resolved. Artefacts presentable as a coherent whole.

### Phase 3 — Design review
- **Goal.** Explicit user approval of the Phase 2 design before implementation effort is spent.
- **Actions.** Synchronous gate. Orchestrator MUST present Phase 2 artefacts (SAD diff, mockup link, API contract, WBS) via `AskUserQuestion`. User approves or returns remarks; remarks loop back to Phase 2. Distinct from Phase 8 (closes the TODO line) and from the TODO-workflow checkpoint (sits before Phase 1).
- **Artefacts.** None — verbal / chat approval.
- **Acceptance.** Explicit user approval. Without it, Phase 4 does not start.

### Phase 4 — Implementation
- **Goal.** Working code that mirrors the approved Phase 2 contracts.
- **Actions.** `frontend-engineer` writes Angular; `backend-engineer` writes .NET; `devops-engineer` writes Dockerfile / compose / Terraform / GitHub Actions. Each works against the approved contracts in `docs/`. Test authoring (Phase 5) overlaps once Phase 3 has passed. Dispatched in parallel where independent.
- **Artefacts.** Code in `frontend/`, `backend/`, `gateway/`, `infrastructure/`, `.github/`. Dockerfiles, compose files, scripts.
- **Acceptance.** Compiles / builds clean. Per-project unit tests pass. No new lint or type errors. Presentable to Phase 5.

### Phase 5 — Testing
- **Goal.** Verify implementation against contracts via executable suites + manual browser smoke against the running solution.
- **Actions.** `qa-engineer` authors and runs functional / API / e2e (Playwright) / mockup-visual / Pester / smoke. Tests reference contracts, not implementation internals. Oracles must be TIGHT per **Test oracles can be wrong** below. Manual browser smoke runs against the running solution (`dev_env/start.ps1` or `ng serve dashboard`), NOT against design artefacts.
- **Artefacts.** Test code under `testing/` (`functional/`, `e2e/`, `mockup-visual/`, `pester/`, `fixtures/`, `scripts/`) + per-project unit specs alongside source. Manual-smoke report.
- **Acceptance.** Suite executes; oracle pass/fail accurately reflects correctness. Manual-smoke report recorded (with explicit caveat if smoke could not be run — e.g. headless). Failures route to Phase 6.

### Phase 6 — Bug fixing
- **Goal.** Resolve defects found in Phase 5 (or manual smoke) until all oracles are green with no regressions.
- **Actions.** Engineer owning the failing surface fixes the defect. QA continues exercising other scenarios in parallel — a bug fix never freezes the test run. Routes back to the specific Phase 4 surface that broke, not a full Phase 4 rerun.
- **Artefacts.** Edits to existing Phase 4 / Phase 5 artefacts.
- **Acceptance.** All oracles green. No regressions. Manual smoke re-run if a user-visible surface was touched.

### Phase 7 — SA review
- **Goal.** Confirm the result complies with SAD invariants, FR/NFRs, and mockup contracts before user approval.
- **Actions.** `solution-architect` reads the diff against SAD invariants (NFR-09, 6-box-state contract, modular-monolith dependency rules, etc.) and the mockup's behavioural contract. Verifies the Phase 5 manual-smoke section was actually written (empty section = REJECT, return to Phase 5). Sign-off; no code edits.
- **Artefacts.** Sign-off note in PR / final report; rarely a new ADR.
- **Acceptance.** APPROVE (with or without pending additive SAD edits) or RETURN-TO-engineer with specific findings.

### Phase 8 — User approval
- **Goal.** User confirms the delivered work satisfies the TODO line.
- **Actions.** Orchestrator surfaces the work via `AskUserQuestion` per the TODO-driven workflow. If manual smoke wasn't run (e.g. headless), the orchestrator asks the user to run it. User picks "Yes — mark complete" or "No — needs more work" (loops back to Phase 6 with specific feedback).
- **Artefacts.** TODO line transition ☐ → ☒. PROGRESS.md refresh. Commit (only when the user explicitly asks).
- **Acceptance.** User selects "Yes — mark complete".

### Cross-phase rule

Artefact classes do not cross phases. A change that needs both design and code runs through Phase 2 first (artefacts land in `docs/`), then Phase 4 (artefacts land in the solution).

### Relation to the cross-domain bugs cycle

The four-phase model in "Cross-domain bugs — integration + compliance cycle" below is the specific instantiation of this lifecycle for bugs that cut across two or more domains. Its Phases 1–4 map onto lifecycle Phases 2 (contract change), 4 (domain implementations), 5–6 (integration + bug fixing), and 7 (compliance review). The design-review gate (lifecycle Phase 3) still applies when the bug requires user-visible behaviour change.

## Engineering principles — apply across all agents

### Configuration vs. data — declarative over imperative

Binds every agent. Signal it belongs in a declarative file = "hard to change without editing imperative code".

**Configuration** (URLs, ports, env vars, feature flags, retention windows, defaults) → declarative files per tier:

| Tier | File |
|---|---|
| .NET | `appsettings.json` / env vars |
| Angular | `environment.ts`, `proxy.conf.json` |
| Compose | `docker-compose.*.yml` |
| Terraform | `*.tfvars` |
| PowerShell tooling | `*.json` config files |

Never as literals inside controllers, components, PowerShell scripts, or test specs.

**Data** (fixtures, seed sets, snapshot baselines, expected JSON, scenarios) → dedicated declarative files (`testing/fixtures/*.json`, `testing/e2e/scenarios/*.md`, etc.). Never as inline literals inside test code.

**Imperative code stays thin** — scripts, runners, entry-point wrappers read from declarative files and call the underlying tool. A 200-line wrapper baking in URLs, tokens, and fixture payloads is a refactor target.

Exceptions require a doc update before they land.

### Test oracles can be wrong

A test that passes against broken software is a defect in the oracle, not a green light. When test results contradict observed behaviour, trust the observed behaviour and route to the test owner to tighten the assertion. Examples:

- A geometric harness anchored against the wrapper instead of the inner element passes on connectors that visibly don't touch.
- A test that POSTs and asserts 201 without asserting the response body shape passes even if the API returns garbage.
- A test that opens a UI element without exercising its action passes on a broken action.

The oracle is part of the contract. Tightening it is `qa-engineer`'s job; respecting that signal is everyone's.

## Documentation style — structure over prose

Applies to **all** written artefacts: `CLAUDE.md`, agent definitions (`.claude/agents/`), future skills, the SAD, the mockup, ADRs, per-component READMEs.

- **Default to structure.** Bullets, numbered lists, tables, headings — not prose paragraphs.
- **Steps / actions / instructions → bullet list.** Never a multi-sentence paragraph.
- **Pairs, mappings, choices → table.** "Before / after", "old / new", "concern → owner", "endpoint → status code".
- **One idea per bullet.** Short, declarative, parseable. A bullet wanting three sentences → promote to sub-list or table.
- **Headings carry weight.** `##` / `###` to chunk; don't bury rules inside walls of prose.
- **Code shapes go in fenced code blocks.** Wire formats, env vars, file paths, commands.
- **Cross-reference, don't duplicate.** Cite the section ("per SAD §7"); don't restate.
- **Drop filler.** No "It is important to note that…", "Please ensure…", "In general…". Lead with the verb or the noun.
- **Prose is for narrative exposition only** — explaining *why* something is the way it is. Keep tight.

When editing a doc, watch for prose paragraphs that should be a list, table, or table-of-rules — convert them.

## Coordination protocol

- Every PR description cites the FR/NFR/section of the SAD — or the mockup section — implemented or validated.
- Wire-contract breaking changes (API shape, SSE event format, env var names) → flag in the PR title; backend, frontend, and devops all confirm before merge.
- Cost-relevant changes (new resource, larger SKU) → fresh estimate vs. the project cost cap in the PR description; `devops-engineer` owns this.

### Strict-domain rule — no agent works outside its domain

Clear boundaries between agents are non-negotiable. A bug in domain X is fixed by the engineer who owns X — never by an adjacent agent "while they're in the area". Cross-domain bugs require collaboration, not single-agent heroics.

Project-specific forbidden role-crossings table lives in the project's `CLAUDE.md` under "Project role boundaries". Each row is a hard stop — propose a hand-off in the final report instead.

**Cross-reference:** NFR-09 (UX-RESPONSIVENESS) is the canonical example of the collaboration pattern this rule enforces — an invariant defined by `solution-architect` in the SAD, encoded as a harness assertion by `qa-engineer`, and satisfied by `frontend-engineer` in mockup CSS/JS. Each domain stays in its lane; end-to-end correctness comes through composition, not boundary-crossing.

### Cross-domain bugs — integration + compliance cycle

When a bug spans two or more domains, the work follows a four-phase model. The orchestrator dispatches each phase deliberately — parallel where work is independent, sequential only where a real dependency exists.

**Phase 1 — contract change (sequential).** If the bug requires a contract change (SAD invariant, FR/NFR addition, wire shape, env var), `solution-architect` lands the doc change first. Engineers cannot start their parts until the contract wording exists.

**Phase 2 — domain implementations (parallel by default).** Each engineering domain implements its own part independently. The orchestrator MUST dispatch all independent domain parts in a single message. Domain parts are independent when:
- Domain A's deliverable is not required to compile, run, or pass tests in domain B's source tree.
- Both domains can reference the Phase 1 contract wording without needing each other's code.

Sequential is correct only when one domain's output is a literal input to the next (e.g. a generated TypeScript type the next agent imports).

**Phase 3 — integration verification (sequential, at the join point).** The agent closest to the user-facing surface (`frontend-engineer` for UI bugs, `backend-engineer` for API bugs, `devops-engineer` for deploy bugs) runs the shared oracle end-to-end and confirms all Phase 2 deliverables compose correctly.

**Automated tests are necessary but not sufficient.** For any change that adds or modifies user-facing behaviour, Phase 3 also requires a **manual browser smoke** by the integrator **against the running SPA** (`dev_env/start.ps1` or `ng serve dashboard`) — NOT against the mockup HTML, which is a design artefact:

1. Wipe and re-seed the local stack to a clean state before opening the browser.
2. Exercise every NEW user-facing flow in a real browser — clicks, dropdowns, toggles, switchers, picker UIs. Not "the page renders"; "the feature does the thing".
3. Compare the SPA's behaviour against the mockup or the SAD's described behaviour (mockup is the oracle; SPA is the subject under test). If a feature looks wrong but tests say "PASS", route to `qa-engineer` to tighten assertions — NOT call it green.
4. Record manual smoke results in the Phase 3 report (one line per new feature: e.g. "PATCH picker works; correlation attribute round-trips").

If the integrator cannot run a browser (e.g. headless), state so explicitly. Do not claim manual smoke as PASS without doing it. If integration fails (automated OR manual), return to the specific Phase 2 domain that broke — not a full rerun.

**Phase 4 — compliance review (sequential, final).** `solution-architect` reviews against SAD invariants and the mockup contract. Sign-off, no edits. If invariants are violated, returns to Phase 2. SA's review must verify the integrator's manual-smoke report was actually written (empty section = REJECT, return to Phase 3).

**Sign-off in PR description.** Each domain notes which part it owned; the integrator notes the verification command/output; `solution-architect` notes which FR/NFR/§ the result satisfies.

**Canonical worked example — Glance env-tag-inside-pill cycle (NFR-09 exception).** A view-specific exception to the NFR-09 invariant: in the Glance view, the env tag renders inside the pill rather than as a separate label.

| Phase | Dispatch | Agent(s) | Work |
|---|---|---|---|
| 1 | sequential | `solution-architect` | Amend SAD NFR-09 with the Glance exception sentence. |
| 2 | **parallel — one message** | `qa-engineer` **and** `frontend-engineer` | qa: add `viewExceptions.glance` flag to `testing/mockup-visual/harness.config.json` + branch the spec. frontend: implement inside-pill render in the Glance template + mirror NFR-09 into the mockup head comment in `docs/deployment-dashboard.html`. |
| 3 | sequential | `frontend-engineer` | Run the harness; expect 12/12. |
| 4 | sequential | `solution-architect` | Compliance review against amended NFR-09; sign-off without edits. |

**Anti-pattern:** dispatching `qa-engineer` and `frontend-engineer` serially in Phase 2. Their deliverables touch different source trees (`testing/mockup-visual/` vs `docs/deployment-dashboard.html`) and both reference only the Phase 1 SAD wording — no input/output dependency. Serializing doubles wall-clock time for no benefit.

**Prior worked example — QAHOTFIX-overlap (UX-RESPONSIVENESS / NFR-09):** the bug was CSS comment-nesting + grid template + Alpine.js wiring — a frontend bug.

| Phase | Agent | Work |
|---|---|---|
| 1 | `solution-architect` | Write NFR-09 invariant in SAD. |
| 2 | `qa-engineer` **and** `frontend-engineer` (parallel) | qa: encode invariant as harness assertion. frontend: fix CSS / Alpine / SVG in the mockup. |
| 3 | `frontend-engineer` | Run `testing/mockup-visual/run-tests.ps1`; all-green is the definition of done. |
| 4 | `solution-architect` | Review for SAD coherence and invariant compliance; sign off without editing mockup code. |

The anti-pattern this replaces: `solution-architect` editing mockup HTML/CSS/JS directly across three failed rounds. That was a strict-domain violation regardless of intent — mockup edits are frontend craft.

### Cross-agent handoff — diagnose ≠ fix

When an agent discovers a root cause **outside** their domain while working on their own task:

1. **Diagnose fully; do NOT fix.** Cross-domain patches cause silent contract drift. Write up: failing command, verbatim error, file + line, chain of reasoning.
2. **Hand off** to the owning agent (project routing table in `CLAUDE.md`). Hand-off package includes: symptom, verified root cause with evidence, what the discoverer tried and ruled out, any local workaround in place + whether to remove it once the proper fix lands.
3. **Both agents stay engaged.** Owner fixes; discoverer reviews and removes any workaround. Not throw-over-the-wall.
4. **Workarounds are temporary, labelled as such.** Example: devops adds a defensive `.dockerignore` to mask a host-side leak. Stays only until the owning agent lands the proper fix; both agents acknowledge in reports.
5. **Out-of-competence fixes are disallowed** — see the project's "Project role boundaries" table in `CLAUDE.md` for the complete forbidden list. Examples:
   - Frontend "just tweaks" SQL in a Read API endpoint → no.
   - Devops "just edits" a `.csproj` to dodge a NuGet issue → no.
   - Backend "just rewrites" a Playwright spec → no.
   - Solution-architect "just patches" mockup CSS to satisfy an invariant → no; hand off to `frontend-engineer`.

Main thread orchestrates the hand-off — when an agent flags a root cause outside their domain in their final report, dispatch the owning agent next with the prior diagnosis verbatim.

**Doc updates always route through the doc's owner.**
- SAD / `CLAUDE.md` / `docs/ci-cd-integration.md` / ADRs → `solution-architect`.
- Mockup (`docs/deployment-dashboard.html`) → `frontend-engineer` for HTML/CSS/JS/SVG edits; `solution-architect` for governance review only.

When any engineer flags a needed change, the next dispatch is the owning agent with the flagged change. Engineers outside the owning domain never edit these files directly.

## TODO-driven workflow

`TODO` at the repo root tracks the user's intended next steps. User-curated — never auto-generated, never auto-extended. Glyphs: `☐` = open, `☒` = completed.

**After every completed user request** (work delivered or question answered), in this order:

1. **Read `TODO`** at the repo root.
2. **Find the first `☐` item** (top-down). If none, say so and stop — never invent an item.
3. **Ask the user via `AskUserQuestion`** — three fixed options, include the verbatim TODO line in the prompt:
   | Option | Effect |
   |---|---|
   | **Elaborate** | User explains the item before any work begins. Wait, then proceed. |
   | **Start implementing** | Proceed immediately using the routing rules above. |
   | **Something else** | Wait for the user's next message; handle as a new request. |
4. **When the chosen item is implemented**, ask via `AskUserQuestion`:
   | Option | Effect |
   |---|---|
   | **Yes — mark complete** | Edit `TODO` to change that line's `☐` → `☒`. No reorder, no delete, no commit unless asked. |
   | **No — needs more work** | Keep as `☐`; ask what's missing; iterate. |

Rules:
- TODO check happens **between** user requests — not in the middle of one.
- TODO items are user-grained, larger than in-conversation tasks (`TaskCreate` / `TaskUpdate`). Mark both when same work completes.
- Never auto-add to TODO. Mention follow-up work → *offer* to add it; do not act unilaterally.
- User says "skip TODO" for this turn → honour it; resume next turn.
