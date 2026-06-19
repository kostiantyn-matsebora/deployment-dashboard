---
description: Intake & docs-first activity of .claude/team-process/process.md. Read the owning spec before any code; restate its acceptance criteria (spec = contract + regression gate). Need a code area's state to scope? Delegate the assessment to the owning role — never read code to scope it.
argument-hint: <issue number | task description>
---

# /intake

The **Intake & docs-first** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

1. **Docs-first.** Read the owning spec before any code; navigate the project's docs index to the
   relevant specification. For API features, the contract artifact is the source of truth.
   - Record a one-line `summary` in the session record (the issue title or the feature's essence) —
     it shows in the statusline + resume reminder so a glance answers "what is this run".
2. **Restate acceptance criteria** from the spec — it is the **contract *and* the regression gate**.
   Store them in the session record's `acceptance` so they survive compaction and publish to the issue.
3. **Scope by delegation, not by reading.** Need the *state* of a code area to plan (refactor,
   audit, "is X clean / what's needed", feasibility)? **Delegate the assessment to the owning role**;
   it returns a `REVIEW`. Do **not** open the area's code to scope it yourself — that applies a
   generic / line-count proxy and pollutes the lead's context with raw investigation.

3. **Capture intake decisions.** Any design choice settled at intake (with the user, or resolving a
   `FINDING`) → append a `decisions[]` entry to the session record, `supersedes` set when it overrides
   the issue text. See [`.claude/team-process/process.md`](../team-process/process.md) → *Decision record*.

**Output:** restated acceptance criteria (in `acceptance`) + any `decisions[]` captured + (if scoping
was needed) the owning role's `REVIEW`.
