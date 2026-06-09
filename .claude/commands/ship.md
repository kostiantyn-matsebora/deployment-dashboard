---
description: Ship activity of .claude/team-process/process.md. Commit in logical groups, push to a branch, open/update the PR, watch CI to green. Never push to the default branch. Autonomous end-state = PR open + CI green + awaiting acceptance.
argument-hint: <the integrated, green branch to ship>
---

# /ship

The **Ship** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

## Steps

1. **Commit in logical groups.** One coherent change per commit; the message states the *why*.
   Match repo EOL / format — the CI platform's result wins.
2. **Push to a branch.** Never the default branch. Default when the user says "push" = the
   current branch.
3. **Open / update the PR.** Fill the template; link the issue; summarize scope + verification
   (actual test counts), not raw logs.
4. **Watch CI to green.** Red → route each failure to its owning role; never leave CI red.

## Gate (binding)

- **Never push to the default branch** — branch → PR, regardless of size. Only exceptions: an
  explicit user instruction to push to the default branch, or a user-ordered revert.
- **Autonomous end-state = PR open + CI green + awaiting user acceptance.** Autonomy never merges
  to the default branch and never disbands at PR-open.
- **Done** = user-accepted AND merged AND default branch green — never advanced on its own.

**Output:** an open PR with CI green, awaiting user acceptance.
