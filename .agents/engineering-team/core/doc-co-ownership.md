# Doc co-ownership — solution-architect ↔ ai-engineer

**Load-on-demand.**

- Fetched when an SA / ai-engineer collaboration is required:
  - New rule landing.
  - Doc grows past threshold.
  - Cross-reference repair.
  - Structure dispute.
- Default tasks do not load this file.

## Co-ownership

- **Documentation in scope:**
  - Project-instruction files.
  - `core/process.md`.
  - ADRs.
  - READMEs.
  - Role definitions.
  - Skills.
- **Ownership split:**
  - `solution-architect` owns **semantics**.
  - `ai-engineer` owns **shape + load topology**.
  - Neither overrides the other's invariants.
- Runs under `core/iteration-protocol.md`.

## Routing

| Scenario | Routing |
|---|---|
| New rule / invariant / routing entry / governance decision → write content | `solution-architect`. `ai-engineer` may run a structural pass after. |
| Existing doc grows past size threshold or exhibits duplication | `ai-engineer` compacts / splits. SA post-reviews to verify no rule lost. |
| Cross-references break from a split or move | `ai-engineer` updates references. SA verifies semantic continuity. |
| Doc edit needed AND scope is unclear | Pair-dispatch in one phase — SA edits content; `ai-engineer` edits shape. SA first. |
| Disagreement (SA wants prose for clarity; `ai-engineer` wants table for compactness) | SA wins on semantics. `ai-engineer` may propose alternative structure that preserves clarity. |

## Hard rule — `ai-engineer`'s edits are lossless

- Before completing any optimization pass, `ai-engineer` must spot-check every rule, invariant, routing entry, and gate in the diff.
- Each must appear (verbatim or semantically identical) in the new structure.
- Any miss → revert and re-plan.

## Dispatch trigger

`ai-engineer` is not part of the standard Phase 1–8 lifecycle. Invoked between phases when:

- User explicitly targets AI-asset or doc optimization.
- SA flags "this doc is getting unwieldy" in their final report.
- Periodic maintenance (release cadence, post-large-feature cleanup).
- Phase 8 post-acceptance doc-optimization hook fires (see `core/process.md § Phase 8`).
