# Migration — D39: Sub-issue dispatch — team-lead tracks cardinal assignments as GitHub sub-issues for cross-session traceability + time-tracking

**Target release:** next minor after 2026-05-24.
**Affected adopters:** every adopter with `github.repo` configured — opt-out default; pre-existing in-flight tasks unchanged.
**Closes:** [#106](https://github.com/kostiantyn-matsebora/ginee/issues/106).

## What changed

Pre-D39, every team-lead → cardinal dispatch lived only in the chat transcript. End the session → lose the state; next-day pickup had to reconstruct progress from PR diffs + scattered commit messages. D14-github-integration already used GH issues as a **task source**; D39 extends the same primitive to **dispatch tracking** — each `team-lead` → cardinal assignment lands as a GitHub **sub-issue** under the parent, labelled by role + phase, threading progress comments + cumulative time, closed by the cardinal's phase-report return.

Resume protocol: new session reads parent + open sub-issues → each open sub-issue is an active in-flight dispatch with full state + time-spent-so-far. No transcript replay.

## Why

| Failure mode (pre-D39) | After |
|---|---|
| Cross-session resume — replay transcript + grep commits | Read parent + open sub-issues |
| Mid-dispatch hand-off — one-shot hand-off note | Live sub-issue thread |
| Parallel-cardinal traceability — buried in synthesis turn | One sub-issue per role, queryable |
| Audit "who did what" — `git blame` + PR comments | Sub-issue close timeline |
| Effort attribution — surfaced nowhere | Per-progress `time:` field + per-cardinal + per-issue rollup |

## Form — opt-out default; three-tier resolution

Resolution order, stop at first match:

1. **Per-task prefix** — `notrack:` on the parent dispatch disables sub-issue tracking for that task. Combinable with `auto:` / `branch:` / `wt:` / `commit:` / `model:` / `fresh:`.
2. **Per-issue label** — `ginee:track:off` on the parent issue disables for that issue's lifetime.
3. **Config** — `local/framework.config.yaml § dispatch.tracking: sub-issues | in-context` (default `sub-issues`).
4. **Framework default** — `sub-issues` when `github.repo` is configured; `in-context` otherwise (TODO / freeform-only adopters silently skip the surface).

## Scope — issue-sourced tasks only

D39 sub-issue tracking activates when the parent task **is an issue** (D14-github-integration pickup path). Other task sources:

| Task source | Behaviour |
|---|---|
| GitHub issue (D14) | Sub-issue mode active by default; opt-out per § Form |
| Repo-root / nested TODO | In-context dispatch (sub-issue mode silently inactive — no parent to anchor) |
| Direct user instruction | In-context dispatch |
| Discussion (post-promote) | Sub-issue mode active on the promoted issue |

No umbrella issue is auto-filed for TODO/freeform tasks. Adopters wanting tracking on those file an issue first (`@team-lead file feature …`) then pick it up.

## Labels — role + phase + parent inheritance

| Label namespace | Values | Source |
|---|---|---|
| `ginee:role:<cardinal>` | `team-lead` · `solution-architect` · `ai-engineer` · `backend-engineer` · `frontend-engineer` · `devops-engineer` · `qa-engineer` | Author-set by team-lead at sub-issue create |
| `ginee:phase:<N>` | `1` … `8` | Set at sub-issue create; team-lead updates on phase transition |
| `ginee:track:off` | (presence only) | Set on **parent** to opt-out for that issue's lifetime |
| `value:high|medium|low` + `complexity:high|medium|low` | per `core/triage-scoring.md` | Inherited verbatim from parent at create |

Missing labels → team-lead creates them on first use via `gh label create <name>` (default color), same as D14 + D23.

## Assignee — overrules role label

Per issue #106 owner comment (2026-05-24): **the assignee overrules the `ginee:role:<cardinal>` tag**.

| Sub-issue assignee state | Effect |
|---|---|
| **Empty** (default) | Role label drives execution — team-lead dispatches the labelled cardinal per the standard Phase 4–7 flow. |
| **Human user** (any non-empty assignee) | Human takes ownership — cardinal does **not** auto-execute the contract. Sub-issue waits for the human to either deliver the work manually or clear the assignee back to empty. team-lead surfaces `"Sub-issue #<M> has human assignee <@user>; cardinal dispatch suspended. Reassign to clear."` once per session. |

Rationale: the assignee column on GitHub means a human is responsible. Cardinals are not GitHub users; the label carries cardinal identity. When both exist, the human (visible accountability) wins.

## Lifecycle — per-cardinal dispatch

1. **Plan.** team-lead drafts the dispatch contract — scope · acceptance · spec-link list · phase · estimate.
2. **Create.** Sub-issue under the parent:
   ```
   gh api repos/<owner>/<repo>/issues/<parent>/sub_issues \
     --method POST \
     -F sub_issue_id=<created-issue-id>
   ```
   Two-step on GH today — first `gh issue create --label <labels>` (or MCP), then attach via the sub-issues endpoint. Title `[<phase>:<cardinal>] <task>`. Body = dispatch contract verbatim per `core/templates/sub-issue-dispatch.md`.
3. **Label.** `ginee:role:<cardinal>` + `ginee:phase:<N>` + inherited `value:*` / `complexity:*` from parent.
4. **Assignee.** Left empty (cardinal auto-executes via label). Human-assigned → § Assignee precedence kicks in.
5. **Execute.** Cardinal runs the dispatch. Progress comments per `core/templates/pr-comment-cadence.md` shape land on the sub-issue (not the PR — PR comments are review-cycle territory per D24):
   - Phase 4 commit links.
   - Phase 5 test results.
   - Blockers / hand-off requests.
   - **`time:` line — elapsed since last comment** (e.g. `time: 18m`). Cumulative since dispatch start carried in each comment as `cumulative: <N>m`.
6. **Close on phase-report return.** Cardinal's D29 phase-report return doubles as the closing comment — mandatory `## Time spent` section (cardinal-reported single rolled-up duration) per `core/templates/phase-report.md § Time spent`. team-lead posts the return as the closing comment then:
   ```
   gh issue close <M> --reason completed
   ```
7. **Parent sync.** team-lead updates the sticky `<!-- ginee:dispatch-map -->` comment on the parent — table of all dispatches + per-cardinal time rollup. One sticky per parent; edit in place; immutable audit comments captured per major transition (sub-issue create · close · forced-fresh re-spawn).

## Time-tracking — format + accounting

- **Granularity** — minutes, rounded; format `time: <N>m` (under 60m) or `time: <H>h <M>m` (60m+).
- **Two readings per progress comment:**
  - `time:` — elapsed since the previous progress comment on this sub-issue. Atomic increment.
  - `cumulative:` — sum since sub-issue create. Self-redundant + survives missing intermediate comments.
- **Cardinal-reported, not wall-clock.** Agent reports its own perceived effort, not session elapsed. Wall-clock is unreliable across pauses + cross-day resumes; perceived effort is what the adopter actually budgets against.
- **Closing rollup.** D29 phase-report `## Time spent` carries the cardinal's total for the dispatch. Cardinal's single source of truth — team-lead never re-derives.
- **Parent rollup.** Parent's `ginee:dispatch-map` sticky aggregates per cardinal across all sub-issues on the parent (`@backend-engineer: 1h 38m across 2 dispatches`).
- **No external bridge.** Jira / Linear / Toggl integration explicitly out of scope.

## Resume protocol — new session

1. Pick up parent issue per existing D14 machinery (`@team-lead pick up #<N>` — already labelled `ginee:in-progress`, recognised as resume).
2. team-lead lists parent + open sub-issues:
   ```
   gh api repos/<owner>/<repo>/issues/<parent>/sub_issues
   ```
3. Each open sub-issue = an active in-flight cardinal dispatch. team-lead reads body + comment history + cumulative time per sub-issue.
4. Read parent's `ginee:dispatch-map` sticky — full task state snapshot.
5. For each open sub-issue:
   - Sub-issue's labelled cardinal (D36-warm-specialist-reuse forced-fresh on cross-session resume — registry is in-conversation only, doesn't persist).
   - team-lead re-dispatches the cardinal with sub-issue body + comment history as context.
   - Cardinal resumes from the In-progress state recorded in the latest progress comment.
6. Closed sub-issues = completed dispatches; phase-report return is in their closing comment.

## Stop-state interaction (D29)

A cardinal returning `Status: In-progress` (iteration-protocol stop) still posts the return on the sub-issue as a progress comment (NOT a closing comment). Sub-issue stays open. The `## Stop-state` section carries the resume instructions verbatim — next pickup re-dispatches from there.

Sub-issue close only fires on `Status: Done | Blocked | Hand-off`. `Blocked` close carries label `ginee:blocked` on the sub-issue + corresponding label on the parent.

## Phase-report shape extension

`core/templates/phase-report.md` gains a new section, conditional on sub-issue mode active:

| Section | Cardinality | Default shape |
|---|---|---|
| `## Time spent` | **required when sub-issue mode is active**; absent otherwise | One-liner — `<H>h <M>m perceived effort; <N> progress comments on sub-issue #<M>.` |

`## Time spent` joins the D29 mandatory-checks self-lint surface — its absence in sub-issue mode counts as a schema violation; orchestrator surfaces the standard one-line advisory per `core/templates/phase-report.md § Orchestrator behaviour on non-compliant returns`.

## D26 / D29 / D33 interaction

Sub-issue bodies + progress comments + closing comments are all **framework-authored GitHub artefacts** per D26 — same 5 mandatory checks per `core/process.md § Mandatory checks before report-as-done`. Closing comments (which double as the D29 phase-report return) also carry the `<!-- D29 self-lint: pass -->` marker per D33. Self-lint runs in the cardinal authoring the progress / closing comment; team-lead never paraphrases.

## D28 / D32 interaction

Sub-issue create is **mechanical** (label + body composition + API call). Per D28-skill-runner-boundary the planning lives with team-lead (scope · acceptance · cardinal selection · phase). On the Claude adapter (D32-claude-adapter-subagent-dispatch) team-lead drafts the create-sub-issue contract; the main thread / skill-runner executes the mechanical `gh issue create` + `sub_issues` POST per contract verbatim. Body content is team-lead's authorship.

## D36 interaction

Sub-issue mode does not bypass D36-warm-specialist-reuse. When team-lead opens a 2nd dispatch to a role within the same Phase 1–8 task:

- The new dispatch still creates a fresh sub-issue (each dispatch = one sub-issue; sub-issues are append-only audit trail, not warm-resume vehicles).
- The cardinal's in-conversation warm registry resume mechanism (Claude `SendMessage`) is unchanged — the cardinal resumes its working context per D36; the sub-issue is the GH-side artefact, not the conversation-side state.

Cross-session resume forces fresh-spawn per D36 (registry is in-conversation only) — but the sub-issue body + comment history feed the fresh cardinal the full state, so D39 + D36 compose: D36 saves intra-session token reload, D39 saves cross-session state-replay.

## D17 interaction

Mode 1 (branch+PR) is the default for issue-sourced tasks per D17-delivery-modes. Sub-issue mode mirrors that — sub-issues are created per dispatch under the parent issue; the resulting PR closes the parent via `Closes #<parent>` (PR linkage unchanged by D39). Sub-issues themselves are closed by phase-report return, NOT by PR merge (the PR is the work output; sub-issues are the work-tracking surface).

Mode 2 (working-tree) + Mode 3 (commit-no-push) on issue-sourced tasks: sub-issue mode still active; sub-issues open + close per cardinal as in Mode 1. Only the final delivery surface differs.

## Adopter opt-out / scope-out

`local/framework.config.yaml § dispatch`:

```yaml
dispatch:
  tracking: sub-issues          # sub-issues | in-context — default sub-issues on github.repo
  time-tracking: true           # set false to disable time-tracking surface entirely
  closing-label: ginee:done     # optional sub-issue close marker (auto-removed on close); omit to skip
```

Default: tracking `sub-issues`; time-tracking `true`; closing-label absent. Adopters wanting the legacy pre-D39 behaviour set `tracking: in-context` once.

## Decisions affected

- **D14-github-integration.** Extended — sub-issue surface gains *dispatch-create*, not just *task-source-pickup*. `Closes #N` PR linkage unchanged.
- **D23-triage-scoring.** Unchanged — sub-issues inherit `value:*` + `complexity:*` from parent at create; no per-sub-issue triage.
- **D24-review-comment-ingestion.** Compatible — sticky-comment pattern reused; review cycle (`ginee:review-cycle`) and dispatch map (`ginee:dispatch-map`) are independent stickies on different surfaces (PR vs parent issue).
- **D25-classical-architect.** Unchanged — doc ownership map unaffected; sub-issues are tracking artefacts, not docs.
- **D26-doc-protocol-scope-extension.** Extended — sub-issue bodies + progress comments + closing comments are framework-authored GH artefacts; the 5 mandatory checks apply.
- **D28-skill-runner-boundary.** Touches — sub-issue create is team-lead's authorship; main-thread / skill-runner executes contract verbatim.
- **D29-strict-subagent-return-schema.** Extended — new `## Time spent` section, conditional on sub-issue mode active; doubles as closing comment.
- **D32-claude-adapter-subagent-dispatch.** Compatible — team-lead still owns plan / synthesis; sub-issue create is one more mechanical step on the contract.
- **D33-d29-enforcement-hardening.** Touches — self-lint marker required on the closing comment, same rule.
- **D34-identifier-short-name-pairing.** Touches — sub-issue title format `[<phase>:<cardinal>] <task>` cites D-decisions slug-glued where present.
- **D35-process-md-load-topology.** Touches — new sub-issue lifecycle prose lands in `core/process/dispatch.md` (load-on-demand, team-lead-only), not the always-loaded slim `process.md`.
- **D36-warm-specialist-reuse.** Compatible — each dispatch creates its own sub-issue (audit trail is append-only); warm-resume is the conversation-side mechanism; D39 is the GH-side mechanism.

## Adapter implications

| Adapter | Status | Notes |
|---|---|---|
| `claude` | Reference implementation — main-thread executes the mechanical `gh issue create` + sub-issues attach + label + close per team-lead's contract. | `adapters/claude/install.md § Sub-issue dispatch` references this migration. |
| `copilot-cli` | Same as claude — gh CLI is the lowest-common-denominator surface; works wherever `gh` does. | No adapter-specific deltas. |
| `agents-md` | Same — generic AGENTS.md render. | No adapter-specific deltas. |
| `generic` | Graceful degradation — if `gh` unavailable + no MCP, dispatches fall back to in-context (silent skip). | team-lead surfaces a one-line advisory once per session: `"gh / GH MCP unavailable; sub-issue dispatch falling back to in-context."` |

## Out of scope

- Per-PR review-comment ingestion (covered by D24-review-comment-ingestion).
- Cross-repo sub-issue federation — single-repo only.
- Auto-merging on sub-issue close — sub-issue closes the dispatch contract, NOT the PR.
- Sub-issue ↔ Jira / Linear / Toggl bridging — adopters bring their own bridge.
- Wall-clock time-tracking — agent-reported perceived effort only; no session timers.
- Replacing in-context dispatch entirely — the opt-out path is first-class.
- Sub-task budgeting beyond what D23-triage-scoring covers.
- Auto-filing umbrella issues for TODO / freeform tasks — adopters file explicitly.
- Sub-issue per phase (vs per dispatch) — one sub-issue per dispatch is the chosen grain; phase moves are label updates on the existing sub-issue.

## Backward compatibility

- **Breaks existing `local/*` files: no** — new optional `dispatch.tracking:` key in `framework.config.yaml`; absent ⇒ default `sub-issues` on `github.repo`-configured adopters.
- Pre-existing parent issues already in flight when D39 lands: sub-issue mode activates only on the **next dispatch** under that parent; in-flight in-context dispatches finish as today.
- Adopters wanting the legacy behaviour set `dispatch.tracking: in-context` once.
- D21-context-economy-gates watched-paths: new core/templates/sub-issue-dispatch.md tracked under "other" tier (50-line / 2 KB).

## Forward-only

Purely additive. No breaking `local/` schema change. No installer change. No core/roles forced rewrite (each cardinal kernel gains a one-line addendum; no semantic shift). No tests change beyond the existing context-economy-check coverage. Adopter action on upgrade: none required — sub-issue mode activates automatically on the next issue pickup; opt-out is a single config line.
