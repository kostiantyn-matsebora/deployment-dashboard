---
audience: team-lead-only
load: always
triggers: []
cap-bytes: 18432
reads-before-applying: []
---

# Orchestration — dispatch, skill-runner, automatic mode, task model

**Load triggers** — `team-lead` (always; orchestration is its surface) · skill-runner main thread on entry to any `ginee-*` skill body. Other cardinals do NOT load this file.

## Skill-runner — surface boundary

**Skill-runner.** Thin mechanical surface running a `ginee-*` skill body (Claude main thread · Cursor main loop · Copilot CLI main loop · AGENTS.md-driven shell). Not a role; not an orchestrator.

| Op | Surface |
|---|---|
| Parse prompt + identify task source · label / sticky / audit-comment ops · branch ops per resolved mode · **one** named first-batch dispatch · report mechanical result · **warm-reuse plumbing on adapters where team-lead lacks the resume tool** — registry holding · team-lead bootstrap (background-spawn + agent-id round-trip) · verbatim execution of team-lead's `mode: warm-resume \| fresh-spawn` plan lines | skill-runner (mechanical only) |
| Plan drafting · synthesis of parallel returns · Phase 3/7/8 gate text · re-dispatch · routing reconciliation · default selection · `local/bindings.md` lookup to settle routing · **tracking-mode posture** (4-tier per `core/protocols/github-integration.md § Sub-issue dispatch`) · **warm-vs-fresh decision** (`mode:` field on every plan line; skill-runner reads field, never writes) | **dispatch `@team-lead`** (forbidden in skill-runner) |

**Hand-back rule.** Every `ginee-*` skill dispatches `@team-lead` after its first mechanical batch. From the 2nd decision onward, every orchestration decision flows through team-lead. Mid-flight routing / governance question from user → skill-runner dispatches `@team-lead`, never reads project files to answer.

**Self-check.** Before main-thread reasoning during a skill run: *"Mechanical op in the allowed row, or orchestration?"* Orchestration → dispatch `@team-lead`. No "fast" / "trivial" exception.

**Schema-bound returns.** Skill-runner forwards non-compliant returns as-is + advisory per `core/templates/phase-report.md § Orchestrator behaviour`. Never restructure / clean up — synthesis crosses the surface boundary.

**Sub-issue tracking-mode posture.** Skill-runner never writes `tracking: in-context | sub-issues`, never recommends a posture, never reasons from runtime conditions (deferred commits · worktree mode · no-PR linkage · `gh` degradation) to a posture. Pass the parsed task to team-lead with no tracking line; team-lead re-derives the closed 4-tier chain (`notrack:` prefix → `ginee:track:off` label → config → framework default) on every parent dispatch + discards any upstream posture. Runtime conditions are **orthogonal**; only adapter degradation (no `gh` / no GH MCP) demotes tier 4 to `in-context` — and that demotion happens in team-lead's resolution, not the hand-off payload. Worked counter-example: `team-lead.details.md § Common failure modes`.

**Claude Code carve-out.** Subagents do not inherit `Agent` / `Task` — team-lead-as-subagent cannot fan out. Skill-runner additionally executes team-lead's user-approved dispatch contract verbatim (mechanical-only — no synthesis, routing, or defaults) + re-invokes team-lead with returns. Decision authority unchanged. Other adapters honour the original hand-back. Full: `adapters/claude/install.md § Subagent dispatch limitation`.

## Dispatch & parallelism rules

**Dispatch prompt shape.** Every team-lead-authored dispatch payload follows `core/protocols/dispatch-prompt-schema.md` — cardinality + section templates + forbidden patterns + self-lint marker. The rules below govern *who* + *how many*; the schema governs *what each payload looks like*.

| Rule | Action |
|---|---|
| Independent work (no shared contract change) | Parallel dispatch in ONE message. |
| N independent specialists in one phase | ONE message with N calls; never serialize across messages. |
| Cross-phase overlap | ONE message with all overlapping specialists; each prompt names shared contract surface (`architecture-doc §X` · `mockup behaviour Y` · `wire shape Z`). |
| Cross-domain Phase 2 | Parallel by default; justify any sequential in the dispatch prompt (one sentence). Habitual serialization is the failure mode. |
| Doc-only changes | `solution-architect` (architecture-family) OR mockup-owning role (UI-only edit, no architecture implication). |
| Infra changes affecting app config (env var · secret · endpoint URL) | Coordinate `devops-engineer` + service owner — service owner first confirms app reads new value, devops second. |
| Surface owns the dispatch decision | Routing by touched surface per `local/bindings.md` — never by estimated task size. "Looks fast" is not grounds for self-execute / non-owning role. |
| Index-first read discipline in dispatch payload | When `local/index/` covers the task surface, dispatch payload MUST instruct: *"consult index first; raw source reads require one-line justification per `core/templates/phase-report.md § Source reads (this dispatch)`"* per `core/protocols/index-protocol.md § Read order`. Free-text variants ("skim affected paths" · "read relevant files" · "explore the codebase") forbidden. |
| Warm specialist reuse | 2nd+ dispatch of role `R` in task `T` AND new phase ∈ `R.phase-participation` → resume via adapter's native mechanism instead of fresh-spawn. **Registry ownership is adapter-specific** — team-lead-side when team-lead has the resume tool · skill-runner-side when team-lead is a subagent without it (Claude — main-thread holds registry; team-lead reads it as dispatch input + writes `mode: warm-resume \| fresh-spawn` into its plan; skill-runner executes verbatim). Decision authority unchanged either way. Forced-fresh: stale state · worktree mismatch · `local/*` drift · `fresh:` prefix · resume-failure. No-resume adapter → fresh-spawn. Claude carve-out: `adapters/claude/install.md § Warm specialist reuse`. |
| Host capability-tool affinity injection | Before drafting specialist dispatch, team-lead reads active adapter's `install.md § Specialist-tool affinity` table (once per task; cached). Matches → append one-line hint per tool: `Available capability tool: <tool-id> — <invocation-hint>. Use if it fits; never required.` No match / no affinity section → silent skip. Opt-out: `local/framework.config.yaml § capability-tools.disabled`. Protocol is *prefer if available*, not *must use*. |
| Blueprint-diff gate routing | Before Phase 4 dispatch, team-lead checks if dispatch touches `local/framework.config.yaml § visual-source-of-truth.path` (defaults derive from `mockup:`). Match → inject precondition: `First step: run core/protocols/blueprint-diff-protocol.md against <blueprint-ref> for <path>; classify Expected / Unexpected / Pre-existing; surface before any edit. Unexpected → forced-interactive (auto-mode does NOT elide).` Opt-out: `visual-source-of-truth.enabled: false`. Full: `core/protocols/blueprint-diff-protocol.md`. |
| Sub-issue dispatch tracking | Issue-sourced tasks: one GH sub-issue per cardinal dispatch under parent — labelled `ginee:role:<cardinal>` + `ginee:phase:<N>` + inherited `value:*`/`complexity:*`; body per `core/templates/sub-issue-dispatch.md`. Cardinal posts progress comments (`time:` + `cumulative:` minutes); phase-report return doubles as closing comment with `## Time spent`. Closes on `Status: Done`; stays open + progress comment on `In-progress`. Parent `<!-- ginee:dispatch-map -->` sticky aggregates time rollup. Non-empty human assignee overrules role label — cardinal suspended until cleared. Resolution chain: `notrack:` → `ginee:track:off` parent → `dispatch.tracking` config → default (`sub-issues` when `github.repo` set). TODO / freeform / no-`gh` adapters fall back to in-context. Full: `core/protocols/github-integration.md § Sub-issue dispatch`. |

**Per-task model tier.** Adapters translate vendor-neutral `<tier>` (`reasoning` / `standard` / `fast`) → model IDs. Resolution (stop at first match): per-task `model:<tier>` prefix > Phase-3 user answer > `local/framework.config.yaml § model-tier.per-role.<role>` > `core/roles/<role>.md` frontmatter `default-tier:`.

**Overlap patterns** — next phase starts when its contract surface is fixed, not when prior phase's code lands:

- **Test authoring overlaps implementation** — Phase 2 fixes wire shape / mockup behaviour → `qa-engineer` authors specs + fixtures in parallel; both reference the contract, never each other's source.
- **Bug fix overlaps continued testing** — QA reports defect → owning engineer fixes immediately; QA continues other scenarios in parallel.
- **Doc update overlaps implementation** — SA hands engineers contract context · engineers proceed · SA updates architecture doc / project-instruction / ADRs in parallel; doc commit is paper trail, not a gate.

## Automatic mode

Task prefixed `auto:` OR team-lead-proposed + user-accepted. Lifecycle runs end-to-end without per-phase user gates; single final delivery handoff. **Default is interactive.** Phase 8 user-approval invariant preserved as the one delivery handoff. Full spec: `core/protocols/automatic-mode.md`.

## Task model

Phase 1–8 applies to any task. Four sources:

| Source | Scope | State mechanic |
|---|---|---|
| Repo-root `TODO` (name per `framework.config.yaml § todo`) | Project-wide | `☐` / `☒` glyphs; orchestrator updates on completion |
| Nested `TODO` (`client/TODO` · `service/api/TODO`) | Component-scoped | Same glyph mechanic, scoped to component file |
| Direct user instruction | Ad hoc | No file; no glyph |
| GitHub issue (per `framework.config.yaml § github.repo`) | Project-wide; routed via `## Affected area` in body | Native `open` / `closed` + configurable labels (`ginee:ready` / `:in-progress` / `:blocked`); PM swaps labels per phase; closes on Phase 8. Full: `core/protocols/github-integration.md`. |

**TODO file rules.** User-curated at any location — never auto-generated, never auto-extended. Glyphs: `☐` open · `☒` completed. Optional priority marker `[v:H c:L]` between glyph and description (H / M / L, case-insensitive); ranked by `ginee-triage` per `core/protocols/triage-scoring.md`.

**GitHub issue rules.** Reporter-authored; never auto-created without explicit approval. Pickup always explicit (`pick up #<N>` / `triage`); never auto-picked on session start. Body is reporter-owned; PM adds comments + swaps framework labels only, never edits body. Issue-sourced PRs include `Closes #<N>` for auto-close on merge. Priority signals via `value:high|medium|low` + `complexity:high|medium|low` (ATAM convention); ranked per `triage-scoring.md`.

### Per-task prefix grammar

All prefixes combine freely in any order (e.g. `auto: branch: nocr: model:fast`).

| Prefix | Family | Effect |
|---|---|---|
| `auto:` | mode | Lifecycle runs end-to-end without per-phase user gates; single delivery handoff. Full spec: `core/protocols/automatic-mode.md`. |
| `branch:` · `wt:` · `commit:` | delivery | Mode 1 (branch + PR) · Mode 2 (working-tree only) · Mode 3 (commit-no-push). Full spec: `core/protocols/delivery-modes.md`. |
| `cr:` · `nocr:` | governance | Force / skip CR authorship; overrides `change-governance.cr.*` config. Skip logs `skip-reason: prefix-override`. Gate: `core/roles/team-lead.md § CR-gate`. |
| `adr:` · `noadr:` | governance | Force / skip ADR authorship; overrides `change-governance.adr.*` config. Gate: `core/roles/solution-architect.md § ADR-gate`. |
| `lite:` · `direct:` | lifecycle | Skip Phase 1–3; direct dispatch from pickup to one named cardinal in Phase 4; Phases 5–8 run normally. Governance gates (CR/ADR/Phase 7/Phase 8) NOT elided. |
| `notrack:` | tracking | Disable sub-issue dispatch tracking for the parent task; falls back to in-context. Resolution chain: `core/protocols/github-integration.md § Sub-issue dispatch`. |
| `fresh:` | warm-reuse | Force fresh-spawn even when warm registry would resume. |
| `model:<tier>` | model | Override per-role default for one dispatch. `tier` ∈ `reasoning` · `standard` · `fast`. |

**Precedence within a family:** explicit-force > explicit-skip > config > default.

**Lite-mode resolution (stop at first match):**

1. `lite:` / `direct:` on the dispatch line.
2. Issue-sourced AND `complexity:low` AND exactly one `ginee:role:<cardinal>` (when `local/framework.config.yaml § lifecycle.lite-mode.label-trigger: true`).
3. `local/framework.config.yaml § lifecycle.lite-mode.default: true` (off by default).
4. Framework default — interactive Phase 1–8.

**Lite-mode applicability:**

| Scope | Lite? |
|---|---|
| Typo / single-label / single-doc-bullet | yes |
| Touches 2+ files · new concept / contract / mockup section · 2+ cardinals | no |

## Team-lead-only load-on-demand specs

Kernel summaries below are orchestration-only. Specialists never load this file. Cross-references from specialist outputs resolve directly to the full-spec paths.

| Spec | Kernel summary | Full file | Load triggers |
|---|---|---|---|
| **GitHub integration** | team-lead files / picks up / triages / closes issues as task source alongside TODO + direct instructions; promotes discussions; threads phase progress as comments; links PRs via `Closes #N`. | `core/protocols/github-integration.md` | `file bug` / `file feature` · `pick up #<N>` / `triage` · `promote discussion #<N>` · specialist posts phase-transition on tracking issue. |
| **Triage scoring** | `ginee-triage` ranks by `score = value / complexity` (WSJF default · `H=3 · M=2 · L=1`). Two label namespaces (`value:*` · `complexity:*` ATAM convention); TODO equivalent `☐ [v:H c:L] …`. On pickup: ask user for missing `value`; dispatch SA for missing `complexity`. | `core/protocols/triage-scoring.md` | `triage` · pickup needs scoring labels · `ginee-triage` / `ginee-pick-up` sort or auto-estimate. |
| **Post-task check-in** | After every completed request, orchestrator picks next pending TODO · asks user fixed options · marks `☐` → `☒` on Yes. | `core/protocols/post-task-check-in.md` | Completed request · Phase 8 about to fire (interactive) · delivery handoff Accept (auto). Mid-task turns do not load. |

## Relation to the cross-domain bugs cycle

- Source: `core/protocols/cross-domain-bugs.md` — specific instantiation of the lifecycle for bugs cutting across 2+ domains.
- **Phase mapping:**

  | Cross-domain phase | Lifecycle phase |
  |---|---|
  | 1 — contract change | 2 (design) |
  | 2 — domain implementations | 4 (implementation) |
  | 3 — integration + bug fixing | 5–6 (test + fix) |
  | 4 — compliance review | 7 (SA review) |

- Lifecycle Phase 3 (design review) still applies when the bug requires user-visible behaviour change.
