---
audience: team-lead-only
load: on-demand
triggers: [delivery, delivery-mode, branch, worktree]
cap-bytes: 12000
reads-before-applying: []
---

# Delivery modes

Loaded when team-lead resolves / proposes delivery mode · specialist enters Phase 4 + needs commit cadence · Phase 8 finalize · auto-mode handoff Accept. Resolved mode carried through session in task working state.

## The three modes

| Mode | Phase 4 commits | Phase 8 finalize | When to default |
|---|---|---|---|
| **1. Branch + PR** | `gh issue develop <N> --name <slug> --checkout` (issue-sourced) / `git checkout -b <slug>` (TODO/freeform) at task start; standard commits on branch | `git push -u origin <branch>` → `gh pr create` body from `core/templates/pr-description.md` + `Closes #<N>` (issue-sourced) | Multi-developer · framework upstream · issue/TODO-sourced |
| **2. Working-tree** | No `git add` / `commit` ever | Surface `git diff` + `git status`; user picks keep / discard / escalate | Exploratory · "show me what would change" · freeform · auto-mode default |
| **3. Commit-no-push** | Standard commits on current branch (no switch) | Surface `git log --oneline -<N>`; user pushes manually | Solo private repos · rapid iteration · user controls all pushes |

## Mode resolution (stop at first match)

1. **Per-task prefix** `branch:` / `wt:` / `commit:`.
2. **Phase-3 user answer** (see § Phase 3 prompt).
3. **Adopter default** — `local/framework.config.yaml § delivery.default-mode` (`branch` / `wt` / `commit`).
4. **Framework default** — `branch` for issue/TODO-sourced; `wt` for freeform.

PM always reports resolved mode at Phase 3 + offers one-line override.

## Prefix syntax

Drop at start of task description: `branch:` (Mode 1) · `wt:` (Mode 2) · `commit:` (Mode 3). Combinable with `auto:` in either order:

```
auto: branch: fix the deployment-failure log spam
branch: auto: fix the deployment-failure log spam   # equivalent
```

## Phase 3 — mode prompt

**Unresolved** (no prefix, no config) — PM surfaces design + three modes + recommended default; user picks:

```
Phase 2 design ready (see above). Pick delivery mode:
  1. Branch + PR — branch `issue-42-fix-deploy`; PR at Phase 8. (Recommended — issue-sourced)
  2. Working-tree only — no commits; you commit / discard at Phase 8.
  3. Commit-no-push — commits on current branch; push at Phase 8.
```

**Resolved** — PM reports + offers one-line override:

```
Phase 2 design ready. Delivery mode: branch+PR (per delivery.default-mode). Override? Reply branch: / wt: / commit:.
```

## Per-mode procedure

### Mode 1 — branch + PR

**Phase 4 start.** Compute slug: issue-sourced → `issue-<N>-<short-slug-from-title>` · TODO-sourced → `todo-<short-slug>` · freeform → `task-<short-slug>`. Create branch:

| Source | Command | Why |
|---|---|---|
| GitHub issue | `gh issue develop <N> --name <slug> --checkout` (or GraphQL `createLinkedBranch`) | Creates branch on origin + establishes GitHub `linkedBranch` relationship visible in issue's Development sidebar. Plain `git checkout -b` skips the linkage. |
| TODO / freeform | `git checkout -b <slug>` (or `git switch -c <slug>`) | No issue to link; local branch sufficient. |

Confirm to user: *"Working on branch `<slug>` (linked to issue #<N>)"* / *"Working on branch `<slug>` (local)"*.

**Phase 4 per batch.** Standard commits on branch; commit messages per adopter convention (or framework default: conventional commit if declared).

**Phase 8 finalize.** `git push -u origin <branch>` → `gh pr create` (or MCP / HTTPS) body from `core/templates/pr-description.md` + `Closes #<N>` / `Fixes #<N>` for issue-sourced → report PR URL. **Auto-mode + `ci-watch: enabled`** → enter CI-watch per `core/protocols/ci-watch.md`; interactive / `ci-watch: disabled` → exit here.

**Forbidden:** push to branch user didn't approve at Phase 3 · force-push · open PR without Phase 8 acceptance · plain `git checkout -b` for issue-sourced (always `gh issue develop` for linkage).

### Mode 2 — working-tree

**Phase 4 start.** No branch switch · no `git add`.

**Phase 4 per batch.** All edits stay in working tree. PM may surface progress via `git status` / `git diff` at iteration boundaries per `core/protocols/iteration-protocol.md § Stoppable intermediate states`.

**Phase 8 finalize.** Run `git status` + `git diff --stat` → surface diff with: *"Working-tree changes ready. Pick: keep + commit manually / discard (`git checkout -- .`) / escalate to Mode 1 or 3."* PM does not commit / stash / push.

**Forbidden:** `git add` / `git commit` / `git stash` / `git push` in this mode.

### Mode 3 — commit-no-push

**Phase 4 start.** No branch switch — current branch.

**Phase 4 per batch.** Standard commits on current branch (matches framework's previously de-facto behaviour); same commit-message conventions as Mode 1.

**Phase 8 finalize.** `git log --oneline -<N>` → surface commit list: *"Commits land on `<branch>`. You push manually when ready."* PM does not push.

**Forbidden:** push · auto-pick this mode on `main` / `master` / `trunk` of multi-developer repo (recommend Mode 1; PM flags at Phase 3).

## Auto-mode integration

Resolved mode determines delivery-handoff Accept:

| Mode | Accept action |
|---|---|
| 1 | Push branch + open PR per `core/templates/pr-description.md`; **enter CI-watch per `core/protocols/ci-watch.md`** when `ci-watch: enabled`. |
| 2 | No-op — changes in working tree; user commits + pushes. |
| 3 | No-op — commits on branch; user pushes. |

Auto-mode framework default = **Mode 2** (working-tree, not committed). Adopter override via config or prefix.

## Forbidden (all modes)

- Commit / push outside resolved mode.
- Silently switch modes mid-task — stop · ask · re-resolve or escalate.
- Auto-pick `commit` for first-time users — default `branch` (safer; reviewable); adopters opt into `commit` explicitly.
- Delete / force-update existing branch named same as computed slug — PM asks before reusing.
