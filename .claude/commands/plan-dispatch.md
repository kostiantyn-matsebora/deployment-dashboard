---
description: Plan & dispatch activity of .claude/team-process/process.md. Map work to roles; declare each lane (exact files) in a BRIEF; surface the plan; get explicit confirmation before N parallel members. Parallelize only disjoint lanes.
argument-hint: <the scoped change to map onto roles>
---

# /plan-dispatch

The **Plan & dispatch** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

1. **Map work to roles** (routing table in `process.md`); enlist only the roles the change needs.
2. **Declare each lane in a `BRIEF`** — the exact files each member may touch. Lanes MUST be
   disjoint; coupled / shared-file work is **serialized or worktree-isolated** (avoid index
   contention).
3. **Surface the plan before launch** — scope + roster + lane map.
4. **Confirm before N parallel members.** Get explicit approval to fan out. Autonomy waives the
   *wait*, not the *surface* — the plan is still emitted to the transcript to interject against.

**Output:** a confirmed lane map + per-lane `BRIEF`s.
