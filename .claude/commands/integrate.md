---
description: Integrate activity of .claude/team-process/process.md. The single orchestrator merges member lanes into the branch, then verifies repo state (out-of-lane edits, stray commits, mixed EOL).
argument-hint: <the handed-back lanes to merge>
---

# /integrate

The **Integrate** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

- **Single integrator.** The orchestrator merges member lanes / worktrees into the branch — it is
  the **sole integration/commit gate** (members never commit).
- **Verify state.** Re-check repo / worktree state — a member may have done more than asked
  (committed, pushed, out-of-lane edits, mixed EOL). Catch it before it compounds.
- **Reconcile** EOL / format to the repo convention (the CI platform's result wins).

**Output:** a single integrated branch with all lanes merged.
