---
description: Implement activity of .claude/team-process/process.md. Members edit in-lane — parallel only on disjoint lanes, coupled/shared work serialized or worktree-isolated. Each self-verifies (build + own-change unit tests + lint) and returns a RESULT with actual counts. Members never commit.
argument-hint: <the dispatched lanes + their BRIEFs>
---

# /implement

The **Implement** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

- **Parallel only on disjoint lanes.** Coupled / shared-file edits are serialized or
  worktree-isolated — never two writers on one worktree.
- **Each member self-verifies** before handing back: build + **unit tests for its own change** +
  lint. No change is handed back unit-untested.
- **Returns a `RESULT`** with **actual counts** — never "builds locally". Unverified hand-backs cost
  a red-CI round-trip. The dispatch primes the `RESULT` shape as a **few-shot example** (canonical
  example + normalizer recipe) — emit conforming JSON first-try; don't write a prose summary (the guard
  blocks it). See [`protocol.md`](../team-process/protocol.md) → *Prime the hand-back*.
- **Members never commit** — the orchestrator is the sole integration gate.

**Output:** per-lane `RESULT`s with actual build / test / lint counts.
