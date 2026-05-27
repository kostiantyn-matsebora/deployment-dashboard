---
audience: team-lead-only
load: on-demand
triggers: [github, issues, discussions, pr, review-comments]
cap-bytes: 24000
reads-before-applying: []
---

# GitHub integration — issues + discussions

**Load-on-demand.** Fetched when:

- `team-lead` is dispatched to **file** an issue (`@team-lead file bug` / `file feature`).
- `team-lead` is dispatched to **pick up** an issue (`@team-lead pick up #<N>`).
- `team-lead` is dispatched to **triage** ready issues (`@team-lead triage`).
- `team-lead` is dispatched to **promote** a discussion to an issue (`@team-lead promote discussion #<N>`).
- A specialist needs to post phase-transition progress on a tracking issue mid-task.

Default short tasks (TODO / direct instruction sources) do not load this file.

## Tool surface

Tool-agnostic. Priority order — `gh` CLI (baseline) > GitHub MCP server (when connected) > generic HTTPS + token (fallback). Commands below use `gh` syntax; substitute equivalents. Never invent a third mechanism.

## Repo discovery — two repos

| Handle | Purpose | Source |
|---|---|---|
| **primary** (`github.repo`) | Adopter's own project. Default target. | Inferred from `git remote get-url origin`; override in `local/framework.config.yaml § github.repo`. |
| **framework** (`github.framework-repo`) | Upstream ginee. Lets adopters file framework feedback. | Set at install (curl/tarball script populates from install source). Leave unset to disable framework-targeted ops. |

**Resolution.** Primary — `github.repo` override > infer from origin (strip `.git`; `origin` for multi-remote; no remote → PM surfaces gap). Framework — value when set; absent → framework-targeted ops disabled (PM surfaces). Same-repo (working IN framework repo) → primary == framework; template selection picks framework templates naturally; `framework-` prefix redundant but accepted.

## Command targeting — primary vs framework

Default target = primary. `framework-` prefix routes metadata-only ops (file / triage / promote) to framework upstream:

| Default (primary) | Framework variant |
|---|---|
| `file bug <title>` | `file framework-bug <title>` |
| `file feature <title>` | `file framework-feature <title>` |
| `triage` | `triage framework` |
| `promote discussion #<N>` | `promote discussion framework#<N>` |

`pick up` has **no `framework-` variant** — addressing requires the source. Work in the framework repo (target = origin = framework, plain `pick up #<N>`). From an adopter project: PM rejects with *"Clone `<framework-repo>` separately, cd into it, then pick up."* Framework-targeted commands with unset `framework-repo` → fail fast + offer to populate; no silent fallback.

## Template selection

Driven by **target repo**, not command shape:

| Target | Bug | Feature |
|---|---|---|
| primary | `core/templates/issues/bug-report.md` | `core/templates/issues/feature-request.md` |
| framework | `core/templates/issues/framework-bug-report.md` | `core/templates/issues/framework-feature-request.md` |

In framework repo (primary == framework), framework-* templates apply automatically.

## Labels (configurable) + state mapping

Defaults under `local/framework.config.yaml § github`. PM creates missing labels on first use via `gh label create <name>` (default color).

| Label | Default | Meaning | State |
|---|---|---|---|
| `ready-label` | `ginee:ready` | Pickup candidate (`☐`) | Phase 1 candidate |
| `in-progress-label` | `ginee:in-progress` | PM dispatched | Phase 1–7 in flight |
| `blocked-label` | `ginee:blocked` | Stoppable intermediate | mid-task paused |
| `value:high|medium|low` | (fixed namespace) | Triage — user/business impact (ATAM importance); reporter-defined | per `core/protocols/triage-scoring.md` |
| `complexity:high|medium|low` | (fixed namespace) | Triage — implementation cost (ATAM difficulty); reporter or SA auto-estimate | per `triage-scoring.md` |

"Done" implicit — issue closed = `☒` (Phase 8 accepted). Open with no framework labels → unpicked-up in adopter's triage queue.

## Outbound — file an issue

Trigger: `file bug <title>` / `file feature <title>` (primary) · `file framework-bug` / `file framework-feature` (upstream).

1. Resolve target (primary unless `framework-` prefix); pick template per § Template selection.
2. PM drafts body from template + user input + project context.
3. **Surface draft for user approval** — issue creation is externally visible per `core/process.md § Executing actions with care`.
4. On approval: `gh issue create --repo <repo> --title <T> --body <B> --label <ready-label>` (or MCP equivalent).
5. Report issue URL + number in final response.

## Inbound — pick up an issue

Trigger: `@team-lead pick up #<N>` — always primary repo. **Never auto-picks.** **No `framework-` variant.**

Skill-runner runs Steps 1–5 mechanically; after Step 5 dispatches `@team-lead` who owns every subsequent decision. Full boundary: `core/process/dispatch.md § Skill-runner — surface boundary`.

1. **Fetch** — `gh issue view <N> --repo <primary> --json title,body,labels,state,comments`.
2. **Validate** — state `OPEN` + labels include `ready-label`. Absent → skill-runner offers to add; on approval mechanical label-add.
3. **Parse** structured body per template; forward `affected area` to team-lead in hand-off (skill-runner never resolves routing).
4. **Scoring labels** per `core/protocols/triage-scoring.md` — missing `value:*` → ask user H/M/L + label-add + audit comment; missing `complexity:*` → skill-runner's one allowed first-batch dispatch is `@solution-architect` for estimate + audit + label-add on return; mechanical sticky post via marker (never duplicate).
5. **Swap labels** — `gh issue edit <N> --remove-label <ready-label> --add-label <in-progress-label>`.
6. **Hand to team-lead** — dispatch `@team-lead` with parsed body + scoring labels + label-swap + (Mode 1) branch. team-lead runs Phase 1 analysis treating parsed body as task description.
7. **Comment cadence** — structured comment per transition, one per transition; every comment passes mandatory checks per `core/process.md § Mandatory checks` (tables · numbered lists · parent + sub-bullets · no parenthetical comma-lists):

   | Trigger | Comment shape |
   |---|---|
   | Phase 3 design review | Architecture-doc diff link + mockup link + work-breakdown + "awaiting approval" |
   | Phase 7 SA review outcome | APPROVE / RETURN-TO-engineer + findings list |
   | Phase 8 acceptance | Summary + PR/commit links + "closing on accept" |
   | Stoppable intermediate | Current phase + done/in-progress/not-started lists |

8. **Phase 8 acceptance** — `gh issue close <N> --comment "<final summary + PR links>"`.

## Triage — list ready issues

Trigger: `triage` (primary) / `triage framework` (upstream).

1. `gh issue list --repo <target> --label <ready-label> --state open --json number,title,labels,createdAt`.
2. Parse `value:*` / `complexity:*` labels per `core/protocols/triage-scoring.md`; compute score (default `value / complexity` with `H=3 · M=2 · L=1`).
3. Surface as table — number · title · `v` · `c` · score · age · labels.
4. Sort `Score DESC, Age DESC`; unscored grouped at bottom.
5. User picks; PM runs pickup flow per choice.

**Triage never picks** — only enumerates + proposes.

## Promote — discussion → issue

Trigger: `promote discussion #<N>` (primary) / `promote discussion framework#<N>` (upstream).

1. Fetch — `gh api repos/<target>/discussions/<N>` (or MCP equivalent).
2. Extract proposed change · open questions · rough acceptance criteria.
3. Draft issue per template; title `Promoted from discussion #<N>: <title>`; body includes `## Source` linking back to the discussion.
4. Surface for approval.
5. On approval: create issue + comment on discussion `Promoted to issue #<M>`.

## PR linkage

When a task is issue-sourced, every resulting PR description includes a `Closes #<N>` line (or `Fixes #<N>` for bug-report issues). GitHub auto-closes the issue on merge. PM verifies this line is present before approving Phase 8.

Template carries this: `core/templates/pr-description.md § Issue linkage`.

**Post-PR CI watch.** In automatic mode with `automatic-mode.ci-watch: enabled` (default), the orchestrator does not exit at `gh pr create`. It enters the watch loop per `core/protocols/ci-watch.md`, posting at most three PR comments per fix cycle (`"CI watch started"` / `"CI fix pushed (cycle N of M)"` / `"CI complete — all green"`), routing attributable failures back through Phase 6, and gating delivery on all-required-green. Interactive mode + `ci-watch: disabled` preserve previously behaviour (exit at "PR opened").

## Review-comment ingestion

Address external code-review feedback on an open PR. Sits between Phase 7 (SA review) + Phase 8 (user acceptance). Explicit invocation only — no CI-watch extension. Output shapes: per-thread reply + sticky cycle summary per `core/protocols/review-cycle-schema.md`.

| Path | Form |
|---|---|
| Skill (AgentSkills clients) | `/ginee-address-review #<N>` |
| Command (every adapter) | `@team-lead address-review #<N>` |

Same procedure under same governance — **skill / command parity is mandatory**. Target = primary repo. No `framework-` variant; checked-out branch MUST be PR head ref.

### Procedure

1. **Resolve `<PR>`.** Abort if checked-out branch ≠ PR head (*"check out the PR branch first"*). Fetch `gh api repos/{o}/{r}/pulls/{N}/comments` (line-anchored) + `.../pulls/{N}/reviews` (approved · changes_requested · commented).
2. **Deduplicate + filter** by `thread-id` — skip `resolved` · skip threads whose last reply is `<!-- ginee:review-reply r=<thread-id> -->` with no newer reviewer comment after (idempotency).
3. **Build routing records** `{thread-id, file, line, body, hunk, role}` per `local/bindings.md § Source-of-truth ownership`; fallback `team-lead`. Ambiguous → surface-closest (visual ↔ frontend · data ↔ backend · IaC ↔ devops); record rationale.
4. **Surface consolidated plan table** for approval (forced-interactive gate).
5. **On approval** parallel dispatch. Each returns: **fix-track** (Phase-6 patch — diff + test impact + verification per `core/process.md § Phase 6`; may bundle ≥ 1 remark in same file/area) OR **reply-track** (text + `<!-- ginee:review-reply r=<thread-id> -->`; specialist owns wording — rationale / declined-with-cite / deferred-to-#N; team-lead never paraphrases).
6. **Reconcile + post.** Team-lead squashes fix-track into one cycle commit + push · posts reply-track via `gh api .../comments/{thread-id}/replies` · verifies lossless coverage.
7. **Sticky cycle summary** per `core/templates/pr-comment-cadence.md` — one per cycle, marker `<!-- ginee:review-cycle n=<N> -->`. Full dispatch contract: `team-lead.details.md § Review-comment dispatch`.

### Plan table — surface contract

| Column | Source |
|---|---|
| `#` | 1-indexed running count |
| `thread` | `T#<short-id>` — last 6 chars of GitHub thread-id |
| `file:line` | from `path:line` in payload |
| `role` | resolved per step 3 |
| `proposed action` | one-line digest |
| `action-type` | `fix` or `reply` |

### HTML markers

| Marker | Purpose | Cardinality |
|---|---|---|
| `<!-- ginee:review-reply r=<thread-id> -->` | Per-thread addressed-this-cycle | 1 per addressed thread per cycle |
| `<!-- ginee:review-cycle n=<N> -->` | Sticky cycle summary | 1 per cycle |

`thread-id` = last 6 chars of GitHub thread-id (matches the `T#<short-id>` plan-table column). `<N>` = count of prior `ginee:review-cycle` markers + 1.

### Lossless coverage rule

Every unresolved plan-table remark MUST end the cycle as **fix** (patch in cycle commit) OR **reply** (text + marker on thread). No silent drops. Same principle as `core/protocols/index-protocol.md § Lossless rule for index § Coverage rule`. Team-lead verifies post-reconciliation: count of plan-table threads = count of `ginee:review-reply` markers + fix-touched-thread mappings; gap → re-dispatch, never silently close.

### Idempotency — re-invocation

1. Re-fetch comments + reviews.
2. Filter out threads with current `<!-- ginee:review-reply r=<id> -->` marker UNLESS newer reviewer comment exists after it.
3. Plan table covers net-new + revisited threads only.
4. Cycle ordinal increments; prior stickies preserved (immutable cycle log).

### User-confirmation gate

No fix committed, no reply posted, no commit pushed without plan-table approval — per `core/process.md § Executing actions with care` (PR is externally visible). In `auto:` mode the gate is a **forced-interactive trigger** per `core/protocols/automatic-mode.md § Forced-interactive triggers` (push + reply on external PR = "destructive / external" set) — auto pauses, surfaces the table, resumes only on explicit approval. **No exception for "trivial" remarks** (slope; explicit out-of-scope).

### Comment cadence

| Surface | Cap |
|---|---|
| Per-thread reply | 1 per addressed thread per cycle |
| Sticky cycle summary | 1 per cycle (format per `core/templates/pr-comment-cadence.md`) |
| Mid-cycle progress comments | 0 — sticky IS the signal |

Every framework-authored reply + cycle-summary passes the mandatory checks per `core/process.md § Mandatory checks before report-as-done`. Specialist authoring a reply-track text runs the self-lint before returning to team-lead. Enforcement: `core/protocols/doc-authoring-protocol.md § Enforcement for ginee-authored GitHub artefacts`.


## Sub-issue dispatch

One sub-issue per team-lead → cardinal dispatch under the parent task issue (issue-sourced only; TODO / freeform → in-context). Authoring: `team-lead.details.md § Sub-issue dispatch`. Body: `core/templates/sub-issue-dispatch.md`. Rules + self-lint across surfaces: `core/protocols/sub-issue-dispatch-schema.md`. Title + `## Summary` follow `core/protocols/doc-authoring-protocol.md § Audience check` — outcome-shaped one-liner · forbidden-identifier list scrubbed · human-summary precedes framework-internal sections.

| Step | Op |
|---|---|
| Plan | team-lead drafts contract — scope · acceptance · spec links · phase · estimate. |
| Create | `gh issue create` titled `[<phase>:<cardinal>] <task>` + body per template + labels (`ginee:role:<cardinal>` · `ginee:phase:<N>` · inherited `value:*`/`complexity:*`); attach via `gh api .../sub_issues`. |
| Execute | Cardinal posts progress comments per `core/templates/pr-comment-cadence.md` — each carries `time: <N>m` (since last) + `cumulative: <N>m` (since start); doc-authoring self-lint. |
| Close | Phase-report return = closing comment with mandatory `## Time spent`; `gh issue close <M> --reason completed`. Stop-state (`Status: In-progress`) → progress comment only; stays open. |
| Parent sync | Edit sticky `<!-- ginee:dispatch-map -->` in place — table of dispatches + per-cardinal time rollup. |

**Resolution (stop at first match):** `notrack:` prefix → `ginee:track:off` label → `dispatch.tracking` config → default (`sub-issues` on `github.repo`).

**Closed chain** — team-lead re-derives every parent dispatch. No fifth tier exists or may be inserted at runtime. Skill-runner per `core/process/dispatch.md § Skill-runner — surface boundary` never sets / recommends / carries a tracking-mode posture in hand-off payload — tracking-mode resolution is orchestration, not mechanical. Any posture asserted upstream (in skill-runner brief · prior transcript · paraphrased hand-off) is **discarded without inheritance**. Runtime conditions (deferred commits · worktree mode · no-PR linkage) are **orthogonal**; only adapter degradation (no `gh` / GH MCP) demotes tier 4 to `in-context` — and that demotion happens inside team-lead's resolution.

**Assignee precedence.** Empty → role label drives execution. Non-empty human → cardinal suspended + team-lead surfaces once-per-session advisory.

**Labels.** `ginee:role:<cardinal>` · `ginee:phase:<N>` · inherited `value:*`/`complexity:*` · `ginee:blocked` (optional) · `ginee:track:off` (parent-only, opts out for issue lifetime).

**Sticky shape** — `<!-- ginee:dispatch-map -->` headline + table `Sub-issue · Role · Phase · Status · Time` + per-cardinal totals.

**Forbidden** — edit body after create (scope change = close + new) · reuse across dispatches · federate cross-repo · auto-file umbrellas for TODO / freeform · close on PR merge (sub-issues close on phase-report return).

## Forbidden actions

- **Never silently create / close / re-open an issue** — explicit user approval each time (externally visible).
- **Never bulk-close stale issues** — adopter-owned policy.
- **Never assign issues to GitHub users** — specialists aren't GitHub users.
- **Never edit another author's issue body** — comments + labels only; body is reporter-owned.
- **Never auto-pickup on session start** — always explicit (`pick up #<N>` / `triage`).
- **Never federate across repos** — one repo per `github.repo`; cross-repo out of scope.

