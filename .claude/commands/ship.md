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
5. **Publish the decision record (issue mode).** Project the session `decisions[]` / `acceptance`
   to the owning issue as a single managed comment (idempotent upsert; never touches the issue
   body). **Confirm-first** — it is outward-facing:
   - Render: `python3 scripts/team-process/update_issue_decision_record.py --id <id> --dry-run`
   - Show the user; on approval, re-run without `--dry-run` to upsert the comment.
   - See [`.claude/team-process/process.md`](../team-process/process.md) → *Decision record*.

## Gate (binding)

- **Never push to the default branch** — branch → PR, regardless of size. Only exceptions: an
  explicit user instruction to push to the default branch, or a user-ordered revert.
- **Autonomous end-state = PR open + CI green + awaiting user acceptance.** Autonomy never merges
  to the default branch and never disbands at PR-open.
- **Done** = user-accepted AND merged AND default branch green — never advanced on its own.

## Post-PR iteration (binding)

PR-open + green is a **checkpoint awaiting acceptance, not termination.** A user change request is a **new wave**, not an inline patch.

- **Re-enter the loop.** dispatch (`BRIEF`) → integrate → **cross-review (incl. `security`)** → **fix** → ship for the changed unit.
  - Review + fix gates are **never skipped** on follow-ups.
- **Proportional, never zero.** A one-line tweak gets a focused review + fix over the changed unit — but never zero.
- **Trigger depends on mode:**
  - **Autonomous** → auto-loop, surface intent.
  - **Interactive** → surface the re-entry plan + let the user pick the depth before dispatching.
- **Lead does not patch the PR itself.** See [`process.md`](../team-process/process.md) → *Post-PR iteration*.

**Output:** an open PR with CI green, awaiting user acceptance + (issue mode) the decision record
published to the issue.
