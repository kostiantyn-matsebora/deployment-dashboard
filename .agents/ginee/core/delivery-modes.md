# Delivery modes

**Load-on-demand.** Fetched when:

- `team-lead` is about to dispatch a task and needs to resolve or propose the delivery mode.
- A specialist enters Phase 4 (implementation) and needs to know which mode applies to its commit cadence.
- `team-lead` is at Phase 8 finalize and runs the per-mode finalize procedure.
- `team-lead` is in auto-mode delivery-handoff and runs the Accept action.

Default short tasks load this file on first use; the resolved mode is then carried through the session in the task's working state.

## Why

`core/process.md § Phase 8` says "commit only when the user explicitly asks." That leaves three concrete answers to *what happens to the work* — committed where, pushed when, surfaced how. The framework formalizes them as three named **delivery modes** with explicit Phase 4 + Phase 8 behaviour.

## The three modes

| Mode | Phase 4 commits | Phase 8 finalize | When to default |
|---|---|---|---|
| **1. Feature branch + PR** | `git checkout -b <slug>` once at task start; commits per batch on the branch | `git push -u origin <branch>`; `gh pr create` per `core/templates/pr-description.md`; PR description includes `Closes #<N>` for issue-sourced tasks | Multi-developer projects; framework upstream; issue-sourced or TODO-sourced tasks |
| **2. Working-tree only** | No `git add` / `git commit` ever | PM surfaces `git diff` + `git status`; user picks: keep / discard / escalate to Mode 1 or 3 | Exploratory tasks; "show me what would change"; freeform without a clear scope; auto-mode default |
| **3. Commit-no-push** | Commits per batch on the current branch (no branch switch) | PM surfaces `git log --oneline -<N>`; user pushes manually | Solo-dev private repos; rapid iteration where the user controls all pushes |

## Mode resolution (Approach C — precedence order)

PM resolves the mode in this order, stopping at the first match:

1. **Per-task prefix** in the task description: `branch:` / `wt:` / `commit:`. Wins outright.
2. **Per-task Phase-3 answer** when PM asks (see § Phase 3 mode prompt below).
3. **Adopter default** from `local/framework.config.yaml § delivery.default-mode`. Values: `branch` / `wt` / `commit`.
4. **Framework default** — `branch` for issue-sourced or TODO-sourced tasks; `wt` for freeform / direct-instruction tasks.

PM always reports the resolved mode at Phase 3 design review and offers the user a one-line override.

## Prefix syntax

Drop the prefix at the start of the task description:

| Prefix | Mode |
|---|---|
| `branch:` | 1 |
| `wt:` | 2 |
| `commit:` | 3 |

Combinable with the `auto:` precedent in either order:

```
auto: branch: fix the deployment-failure log spam
branch: auto: fix the deployment-failure log spam   # equivalent
```

## Phase 3 — mode prompt

If the mode is unresolved (no prefix, no config) when PM completes the Phase 2 design and enters Phase 3 review, PM surfaces the design + the three modes + a recommended default and asks the user to pick.

Example PM prompt at Phase 3:

```
Phase 2 design ready (see above). Pick delivery mode:
  1. Feature branch + PR — branch `issue-42-fix-deploy`; commits land there; PR opens at Phase 8. (Recommended — task is issue-sourced)
  2. Working-tree only — no commits; you commit / discard at Phase 8.
  3. Commit-no-push — commits on current branch; push at Phase 8.
```

If the mode IS resolved (prefix or config), PM reports it in the Phase 3 summary and offers a one-line override:

```
Phase 2 design ready. Delivery mode: branch+PR (per `delivery.default-mode` in framework.config.yaml). Override? Reply `branch: ` / `wt: ` / `commit: ` to change.
```

## Per-mode procedure

### Mode 1 — feature branch + PR

**Phase 4 start:**

1. Compute branch slug:
   - Issue-sourced → `issue-<N>-<short-slug-from-title>`.
   - TODO-sourced → `todo-<short-slug>`.
   - Freeform → `task-<short-slug>`.
2. Create the branch — tool priority depends on task source:

   | Source | Command | Why |
   |---|---|---|
   | GitHub issue | `gh issue develop <N> --name <slug> --checkout` (or GraphQL `createLinkedBranch` mutation) | Creates the branch on origin AND establishes the GitHub *linkedBranch* relationship visible in the issue's Development sidebar. Pure `git checkout -b` skips the linkage. |
   | TODO / freeform | `git checkout -b <slug>` (or `git switch -c <slug>`) | No issue to link; local branch is sufficient. |

3. Confirm to user: "Working on branch `<slug>` (linked to issue #<N>)" / "Working on branch `<slug>` (local)."

**Phase 4 per batch:**

- Standard commits on the branch.
- Commit messages follow adopter convention (or framework default: conventional commit style if adopter declares).

**Phase 8 finalize:**

1. `git push -u origin <branch>`.
2. `gh pr create` (or GitHub MCP / HTTPS) with body from `core/templates/pr-description.md`.
3. For issue-sourced tasks, PR description includes `Closes #<N>` (or `Fixes #<N>` for bugs).
4. Report PR URL.
5. **Automatic mode + `ci-watch: enabled`**: enter the CI-watch state per `core/ci-watch.md`. Interactive mode and `ci-watch: disabled` exit here.

**Forbidden:**

- Never push to a branch the user didn't approve at Phase 3.
- Never force-push.
- Never open a PR without the user's Phase 8 acceptance.
- For issue-sourced tasks, never use plain `git checkout -b` — always go through `gh issue develop` (or the GraphQL `createLinkedBranch` mutation) so the branch is linked to the issue in GitHub's Development panel.

### Mode 2 — working-tree only

**Phase 4 start:**

- No branch switch. No `git add`.

**Phase 4 per batch:**

- All edits stay in the working tree.
- PM may surface progress with `git status` / `git diff` at iteration boundaries (per `core/protocols/iteration-protocol.md § Stoppable intermediate states`).

**Phase 8 finalize:**

1. Run `git status` + `git diff --stat`.
2. Surface the diff to the user with: "Working-tree changes ready. Pick: keep + commit manually / discard (`git checkout -- .`) / escalate to Mode 1 or Mode 3."
3. PM does not commit, stash, or push.

**Forbidden:**

- Never `git add` / `git commit` / `git stash` / `git push` in this mode.

### Mode 3 — commit-no-push

**Phase 4 start:**

- No branch switch (use current branch).

**Phase 4 per batch:**

- Standard commits on the current branch (matches the framework's previously de-facto behaviour).
- Same commit-message conventions as Mode 1.

**Phase 8 finalize:**

1. Run `git log --oneline -<N>` where `N` = commits this task.
2. Surface the commit list to the user with: "Commits land on `<branch>`. You push manually when ready."
3. PM does not push.

**Forbidden:**

- Never push.
- Never auto-pick this mode when target branch is `main` / `master` / `trunk` on a multi-developer repo — recommend Mode 1 instead (PM should flag at Phase 3).

## Auto-mode integration

When auto mode is active, the resolved delivery mode determines what the delivery-handoff Accept does:

| Mode | Delivery-handoff Accept action |
|---|---|
| 1 (branch + PR) | Push branch; open PR per `core/templates/pr-description.md`; **enter CI-watch per `core/ci-watch.md`** when `automatic-mode.ci-watch: enabled`. |
| 2 (wt) | No-op — changes already in working tree; user commits + pushes. |
| 3 (commit-no-push) | No-op — commits already on current branch; user pushes. |

Auto-mode framework default = **Mode 2 (wt)** — working-tree changes prepared but not committed. Adopter can override via config or per-task prefix.

## Forbidden actions (all modes)

- Never commit or push outside the resolved mode.
- Never silently switch modes mid-task. If the user changes their mind, PM stops, asks, and either re-resolves or escalates per the user's choice.
- Never auto-pick `commit` mode for first-time users. Default to `branch` (safer; reviewable). Adopters opt into `commit` explicitly.
- Never delete or force-update an existing branch named the same as the computed slug — PM asks before reusing.

## Out of scope

- Multi-branch / stacked-PR workflows. One feature branch per task.
- Auto-rebasing / squash-merge policy. Adopter-owned via PR-merge settings on the git host.
- Branch cleanup post-merge. Git host / adopter handles.
- Cross-repo PRs. Mode 1 always targets the same repo the task came from.
- Custom branch-naming conventions beyond the three patterns. Adopters can wrap PM's slug with a prefix via future config; not in scope here.
