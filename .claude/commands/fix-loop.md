---
description: Fix-loop activity of .claude/team-process/process.md. testing runs the wider net; failures route through the orchestrator as a FIX to the owning role; loop until green. Implementer unit-tests its own change; testing never fixes production code; never ship red.
argument-hint: <the integrated branch to verify>
---

# /fix-loop

The **Fix-loop** activity of the orchestration process
([`.claude/team-process/process.md`](../team-process/process.md)).

**Ownership split.** Testing is split by ownership; failures route through the orchestrator.

## Test ownership

- **Implementer tests its own change.** Each specialist writes + runs unit tests for its code
  (where applicable) and reports actual counts in `RESULT`. No change handed back unit-untested.
- **`testing` owns the wider net** — API / integration / e2e / regression.
  - Reports red to the orchestrator (failing `RESULT` / `FINDING`).
  - **Never fixes production code**; may fix the *tests*, never weaken them.

## Loop

- **Orchestrator diagnoses to *route*, not to fix.** From the `FINDING`
  (`expect` / `actual` / `suspect`) it picks the owning specialist and issues a `FIX` — written to that
  member's `inbox` and delivered by `{ type, ref }` pointer (see
  [`protocol.md`](../team-process/protocol.md) → *Message delivery*). It does **not** open the code itself
  (code-cognition is tool-blocked while a run is active).
- **Keep the route-diagnosis shallow.**
  - `suspect` already names the layer → route directly.
  - Layer genuinely **ambiguous across roles** → delegate an [`ANALYSIS`](../team-process/protocol.md) to pick it; do **not** deepen the dig in your own context.
- **Deep investigation is the owning agent's prerogative**, in that agent's own context.
- **Re-run after each fix; loop until green.** Re-verify against the owning spec.
  **Never ship red.**
- **Capture a non-obvious diagnosis** as a `decisions[]` entry (root cause + the fix chosen + why)
  so it is not re-derived after a restart — see
  [`process.md`](../team-process/process.md) → *Decision record*.

**Output:** a green wider-net suite (verified against the owning spec).
