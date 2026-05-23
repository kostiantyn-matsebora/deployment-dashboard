# GitHub integration — issues + discussions

**Load-on-demand.** Fetched when:

- `team-lead` is dispatched to **file** an issue (`@team-lead file bug` / `file feature`).
- `team-lead` is dispatched to **pick up** an issue (`@team-lead pick up #<N>`).
- `team-lead` is dispatched to **triage** ready issues (`@team-lead triage`).
- `team-lead` is dispatched to **promote** a discussion to an issue (`@team-lead promote discussion #<N>`).
- A specialist needs to post phase-transition progress on a tracking issue mid-task.

Default short tasks (TODO / direct instruction sources) do not load this file.

## Why

Two-way bridge between an adopter's GitHub repo and the framework's task model:

- Adopters file work in the platform they already use (issues, discussions).
- Framework picks issues up, runs them through the standard Phase 1–8 lifecycle, and closes the loop with issue comments + PR linkage.
- TODO files remain a valid task source — both coexist.

## Tool surface

Framework spec is tool-agnostic. Roles use whichever GitHub access is available in the current session, in this priority:

1. **`gh` CLI** — baseline; expected on most adopter dev environments.
2. **GitHub MCP server** — when connected; better tool-use ergonomics in supporting clients.
3. **Generic HTTPS + token** — fallback for environments lacking either.

Commands referenced below use `gh` syntax. Substitute equivalents as needed; never invent a third mechanism.

## Repo discovery — two repos

Framework tracks two repo handles:

| Handle | Purpose | Source |
|---|---|---|
| **primary** (`github.repo`) | Adopter's own project. Default target for issue ops. | Inferred from `git remote get-url origin`; override in `local/framework.config.yaml § github.repo`. |
| **framework** (`github.framework-repo`) | Upstream ginee framework. Lets adopters file feedback against the framework. | Set at install time by the curl/tarball script (or hand-set after copy-paste install). Leave unset to disable framework-targeted ops. |

Resolution rules:

1. **Primary repo.** `github.repo` override wins; else infer from `git remote get-url origin` (strip `.git`); multi-remote: use `origin` unless overridden; no remote / detached: PM surfaces the gap + offers to add the override key.
2. **Framework repo.** `github.framework-repo` value wins if set; absent → framework-targeted operations disabled (PM surfaces + offers to populate the key).
3. **Same-repo case.** When working IN the framework repo (rare for framework self-dev), primary == framework. Target-based template selection naturally picks framework templates. Explicit `framework-` prefix is accepted but redundant.

## Command targeting — primary vs framework

Default target is the primary repo. The `framework-` prefix routes **metadata-only** operations (file / triage / promote) to the framework repo:

| Default (primary) | Framework-targeted variant |
|---|---|
| `@team-lead file bug <title>` | `@team-lead file framework-bug <title>` |
| `@team-lead file feature <title>` | `@team-lead file framework-feature <title>` |
| `@team-lead triage` | `@team-lead triage framework` |
| `@team-lead promote discussion #<N>` | `@team-lead promote discussion framework#<N>` |

`pick up` has **no `framework-` variant.** Addressing an issue requires the source — work in the framework repo (target = origin = framework, standard `@team-lead pick up #<N>` applies). From an adopter project (no framework source), PM rejects framework-issue pickup with: *"Clone `<framework-repo>` separately, cd into it, then `@team-lead pick up #<N>`."*

If `github.framework-repo` is unset, framework-targeted commands fail fast with a one-line "framework-repo not configured" message + offer to populate the key. No silent fallback to primary.

## Template selection

Driven by **target repo**, not command shape:

| Target | Bug template | Feature template |
|---|---|---|
| primary repo | `core/templates/issues/bug-report.md` | `core/templates/issues/feature-request.md` |
| framework repo | `core/templates/issues/framework-bug-report.md` | `core/templates/issues/framework-feature-request.md` |

When working IN the framework repo (primary == framework), framework-* templates apply for every file/pick-up — no special command needed.

## Label scheme (configurable)

Defaults declared under `local/framework.config.yaml § github`:

| Config key | Default | Meaning |
|---|---|---|
| `ready-label` | `ginee:ready` | Pickup candidate (`☐` equivalent). |
| `in-progress-label` | `ginee:in-progress` | PM has dispatched; phases 1–7 in flight. |
| `blocked-label` | `ginee:blocked` | Stoppable intermediate state; waiting on user / external. |
| `value:high|medium|low` | n/a (fixed namespace) | Triage scoring — user/business impact (ATAM importance). Reporter-defined. Per `core/triage-scoring.md`. |
| `complexity:high|medium|low` | n/a (fixed namespace) | Triage scoring — implementation cost (ATAM difficulty). Reporter or `solution-architect` (auto-estimate on pickup). |

PM creates any missing label on first use via `gh label create <name>` (default color). "Done" is implicit — issue closed.

## State mapping

| GitHub state | Framework phase | TODO equivalent |
|---|---|---|
| Open, no framework labels | Unpicked-up — sits in adopter's idea/triage queue | n/a |
| Open + `ready-label` | Phase 1 pickup candidate | `☐` |
| Open + `in-progress-label` | Phase 1–7 in flight | mid-task |
| Open + `blocked-label` | Stoppable intermediate; awaiting user/external | mid-task, paused |
| Closed | Phase 8 accepted | `☒` |

## Outbound — file an issue

Trigger: `@team-lead file bug <title>` / `file feature <title>` (→ primary) or `file framework-bug <title>` / `file framework-feature <title>` (→ framework upstream).

1. PM resolves target repo (primary unless `framework-` prefix) and picks the template per § Template selection.
2. PM drafts the body — populates the template's structured sections from user input + project context.
3. **PM surfaces the draft to the user for approval.** Issue creation is externally visible — per `core/process.md § Executing actions with care`, always confirm before publishing.
4. On approval, PM runs:
   ```
   gh issue create --repo <repo> --title <T> --body <B> --label <ready-label>
   ```
   (or MCP equivalent).
5. PM reports the issue URL + number in the final response.

## Inbound — pick up an issue

Trigger: `@team-lead pick up #<N>` — always targets the primary repo (= the working tree's origin). **Never auto-picks.** **No `framework-` variant** — see § Command targeting.

**Skill-runner vs team-lead split (D28).** Steps 1–5 below are **mechanical ops** the skill-runner (`ginee-pick-up`) runs directly. After Step 5 the skill-runner dispatches `@team-lead` and team-lead owns every subsequent decision — Phase 1 analysis, plan drafting, specialist routing, comment cadence, gate enforcement, close-out. Full boundary: `core/process.md § Skill-runner — surface boundary`.

1. **Mechanical (skill-runner).** Fetch:
   ```
   gh issue view <N> --repo <primary-repo> --json title,body,labels,state,comments
   ```
2. **Mechanical (skill-runner).** Validate:
   - State must be `OPEN`.
   - Labels include `ready-label` — if absent, skill-runner offers to add it before pickup; on user approval, mechanical label-add.
3. **Mechanical (skill-runner).** Parse the structured body per the template sections. Forward `affected area` to team-lead in the hand-off payload; skill-runner never resolves routing itself.
4. **Mixed — mechanical ops + first dispatch.** Scoring labels per `core/triage-scoring.md`:
   - Missing `value:*` → skill-runner asks user (H / M / L) per the skill text; mechanical label-add + audit comment post.
   - Missing `complexity:*` → skill-runner's **one allowed first-batch dispatch** is `@solution-architect` for H / M / L estimate per the skill text; mechanical audit-comment post + label-add on SA return.
   - Mechanical sticky post — find via marker; update in place; never duplicate.
5. **Mechanical (skill-runner).** Swap labels:
   ```
   gh issue edit <N> --remove-label <ready-label> --add-label <in-progress-label>
   ```
6. **Hand to `team-lead`.** Skill-runner dispatches `@team-lead` with the parsed issue body + scoring labels + label-swap result + (Mode 1) branch handle. team-lead runs Phase 1 analysis treating the parsed issue body as the task description. Standard Phase 1–8 dispatch from here.
7. **Comment cadence** — PM posts a structured comment at each major transition:

   | Trigger | Comment shape |
   |---|---|
   | Phase 3 design review surfaced | Architecture-doc diff link + mockup link + work-breakdown + "awaiting approval" |
   | Phase 7 SA review outcome | APPROVE / RETURN-TO-engineer + findings list |
   | Phase 8 acceptance | Summary + PR/commit links + "closing on accept" |
   | Stoppable intermediate state (user paused) | Current phase + done/in-progress/not-started lists |

   Comments are structured summaries, not chatty. One per transition. **D26 binding** — every framework-authored comment passes the mandatory checks per `core/process.md § Mandatory checks before report-as-done` (tables for inventories · numbered lists for steps · parent + sub-bullets for multi-rule statements · no parenthetical comma-lists in sentences). Enforcement: `core/doc-authoring-protocol.md § Enforcement for ginee-authored GitHub artefacts`.
8. On Phase 8 acceptance, PM closes the issue:
   ```
   gh issue close <N> --repo <repo> --comment "<final summary + PR links>"
   ```

## Triage — list ready issues

Trigger: `@team-lead triage` (→ primary) or `@team-lead triage framework` (→ framework upstream).

1. Resolve target repo. List:
   ```
   gh issue list --repo <target-repo> --label <ready-label> --state open --json number,title,labels,createdAt
   ```
2. Parse `value:high|medium|low` / `complexity:high|medium|low` labels per `core/triage-scoring.md`; compute score (default `value / complexity` with `H=3, M=2, L=1`).
3. Surface as a table — number / title / `v` / `c` / score / age / labels.
4. Sort by `Score DESC, Age DESC`. Unscored items grouped at the bottom.
5. User picks one (or several). PM runs the pickup flow for each.

Triage **never picks**. It only enumerates and proposes.

## Promote — discussion → issue

Trigger: `@team-lead promote discussion #<N>` (→ primary) or `@team-lead promote discussion framework#<N>` (→ framework upstream).

1. Resolve target repo. Fetch the discussion:
   ```
   gh api repos/<target-repo>/discussions/<N>
   ```
   (or MCP Discussions API equivalent).
2. Read body + top comments — extract:
   - The proposed change.
   - Open questions raised in comments.
   - Any rough acceptance criteria mentioned.
3. Draft an issue using the appropriate template. Title links to the discussion: `Promoted from discussion #<N>: <title>`. Body includes a `## Source` section: `Discussion: https://github.com/<owner>/<repo>/discussions/<N>`.
4. Surface the draft for user approval.
5. On approval, create the issue **and** comment on the discussion linking to the new issue:
   ```
   gh issue create ...                        # → issue #M
   gh api repos/<owner>/<repo>/discussions/<N>/comments \
      --field body="Promoted to issue #<M>"
   ```

## PR linkage

When a task is issue-sourced, every resulting PR description includes a `Closes #<N>` line (or `Fixes #<N>` for bug-report issues). GitHub auto-closes the issue on merge. PM verifies this line is present before approving Phase 8.

Template carries this: `core/templates/pr-description.md § Issue linkage`.

**Post-PR CI watch (D20).** In automatic mode with `automatic-mode.ci-watch: enabled` (default), the orchestrator does not exit at `gh pr create`. It enters the watch loop per `core/ci-watch.md`, posting at most three PR comments per fix cycle (`"CI watch started"` / `"CI fix pushed (cycle N of M)"` / `"CI complete — all green"`), routing attributable failures back through Phase 6, and gating delivery on all-required-green. Interactive mode + `ci-watch: disabled` preserve pre-D20 behaviour (exit at "PR opened").

## Review-comment ingestion

Address external code-review feedback on an open PR. Sits between Phase 7 (internal SA review) and Phase 8 (user acceptance) for PRs exposed to peer maintainers / OSS contributors / the user wearing a reviewer hat. Explicit invocation only — no extension of D20 CI-watch.

| Path | Form |
|---|---|
| Skill (AgentSkills clients) | `/ginee-address-review #<N>` |
| Command (every adapter) | `@team-lead address-review #<N>` |

Both run the same procedure under the same governance — **skill / command parity is mandatory** (D24). Target = primary repo. No `framework-` variant; checked-out branch must be the PR's head ref.

### Procedure

1. **Resolve `<PR>`** per § Repo discovery. Abort if checked-out branch ≠ PR head (*"check out the PR branch first"*). Fetch:
   ```
   gh api repos/{o}/{r}/pulls/{N}/comments      # line-anchored
   gh api repos/{o}/{r}/pulls/{N}/reviews       # approved / changes_requested / commented
   ```
2. **Deduplicate + filter** by `thread-id`:
   - Skip threads marked `resolved`.
   - Skip threads whose last reply is `<!-- ginee:review-reply r=<thread-id> -->` AND no newer reviewer comment after it (idempotency).
3. **Build routing records** `{thread-id, file, line, body, hunk, role}`. Route per `local/bindings.md § Source-of-truth ownership`; fallback `team-lead`. Ambiguous match → pick the surface-closest role (visual ↔ frontend; data ↔ backend; IaC ↔ devops); record rationale on the row.
4. **Surface consolidated plan table** for approval (forced-interactive gate — see below).
5. **On approval** dispatch specialists in parallel. Each returns one of:
   - **fix-track:** Phase-6-shaped patch (diff + test impact + verification note per `core/process.md § Phase 6`). May bundle ≥ 1 remark per patch when same file/area.
   - **reply-track:** structured reply text + `<!-- ginee:review-reply r=<thread-id> -->` marker. Specialist owns the wording (rationale, declined-with-cite, deferred-to-#N); team-lead never paraphrases.
6. **Reconcile + post.** Team-lead: squash fix-track patches into one cycle commit on the PR branch + push; post reply-track texts via `gh api .../comments/{thread-id}/replies` (or PR-review-comment-reply equivalent); verify lossless coverage before step 7.
7. **Post sticky cycle summary** per `core/templates/pr-comment-cadence.md` — one per cycle. Marker `<!-- ginee:review-cycle n=<N> -->`. Full dispatch contract: `core/roles/team-lead.details.md § Review-comment dispatch`.

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

Every unresolved plan-table remark MUST end the cycle as **fix** (patch in cycle commit) OR **reply** (text + marker on thread). No silent drops. Same principle as `core/index-protocol.md § Lossless rule for index § Coverage rule`. Team-lead verifies post-reconciliation: count of plan-table threads = count of `ginee:review-reply` markers + fix-touched-thread mappings; gap → re-dispatch, never silently close.

### Idempotency — re-invocation

1. Re-fetch comments + reviews.
2. Filter out threads with current `<!-- ginee:review-reply r=<id> -->` marker UNLESS newer reviewer comment exists after it.
3. Plan table covers net-new + revisited threads only.
4. Cycle ordinal increments; prior stickies preserved (immutable cycle log).

### User-confirmation gate

No fix committed, no reply posted, no commit pushed without plan-table approval — per `core/process.md § Executing actions with care` (PR is externally visible). In `auto:` mode (D12) the gate is a **forced-interactive trigger** per `core/automatic-mode.md § Forced-interactive triggers` (push + reply on external PR = "destructive / external" set) — auto pauses, surfaces the table, resumes only on explicit approval. **No exception for "trivial" remarks** (slope; explicit out-of-scope).

### Comment cadence

| Surface | Cap |
|---|---|
| Per-thread reply | 1 per addressed thread per cycle |
| Sticky cycle summary | 1 per cycle (format per `core/templates/pr-comment-cadence.md`) |
| Mid-cycle progress comments | 0 — sticky IS the signal |

**D26 binding** — every framework-authored reply + cycle-summary passes the mandatory checks per `core/process.md § Mandatory checks before report-as-done`. Specialist authoring a reply-track text runs the self-lint before returning to team-lead. Enforcement: `core/doc-authoring-protocol.md § Enforcement for ginee-authored GitHub artefacts`.

### Example — worked cycle

PR #42 has 3 unresolved remarks. Approved plan:

| # | thread | file:line | role | proposed action | action-type |
|---|---|---|---|---|---|
| 1 | T#abc | backend/api/users.cs:42 | backend-engineer | "Switch to async overload" | fix |
| 2 | T#def | docs/architecture.md:88 | solution-architect | "Decline — cite ADR-0006" | reply |
| 3 | T#ghi | frontend/src/login.tsx:17 | frontend-engineer | "Add loading state per mockup Y" | fix |

Parallel dispatch → cycle commit `abc1234` (squashes #1 + #3) pushed; replies posted on #1/#2/#3 with `ginee:review-reply` markers; sticky `Review cycle 1: 3 remarks addressed (2 code, 1 reply). HEAD: abc1234.` + `<!-- ginee:review-cycle n=1 -->`.

Re-invocation later (new reviewer comment on `T#abc` + new `T#jkl`):

- `T#abc` re-enters (newer comment after marker).
- `T#def` + `T#ghi` skipped (markers; no newer comment).
- `T#jkl` enters (net-new).
- Cycle ordinal → 2; new sticky; prior preserved.

### Out of scope

- Drafting reviews on other people's PRs (reviewer role, not author).
- Auto-resolving threads — reviewer / PR author owns.
- Cross-repo coordinated reviews.
- Auto-detecting new review comments — explicit invocation only; D20 CI-watch loop unaffected.
- Sentiment / tone analysis.
- Bypassing the user-confirmation gate for "trivial" remarks.
- Skill-only or command-only delivery — parity mandatory.

## Forbidden actions

- **Never silently create / close / re-open an issue.** Each requires explicit user approval per `core/process.md § Executing actions with care` — issues are externally visible.
- **Never bulk-close stale issues.** Stale-issue cleanup is an adopter-owned policy, not framework work.
- **Never assign issues to GitHub users.** Specialists aren't GitHub users; assignment stays manual.
- **Never edit another author's issue body.** PM may add comments and labels; the body is reporter-owned.
- **Never auto-pick up issues on session start.** Pickup is always explicit (`pick up #<N>` or `triage` → user selects).
- **Never federate across repos.** One repo per `github.repo` config; cross-repo coordination is out of scope.

## Out of scope

- Pull requests as a task source (PRs are work output, not work input).
- Webhook / event-driven pickup. Pickup is explicit on user invocation.
- Issue auto-labelling on body keywords. Adopters use GitHub's own automation for that.
- Auto-creating custom-coloured labels. Framework creates labels with default color when absent; recolouring is an adopter task.
- Cross-repo issue federation.
- Issue assignment to specialists (specialists aren't GitHub users).
- Discussions as a direct task source. They must be promoted to an issue first.
