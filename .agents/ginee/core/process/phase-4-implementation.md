# Phase 4 — Implementation

**Load triggers** — any cardinal whose `phase-participation:` includes `4`. Per-role roster: `team-lead` · `solution-architect` (review / governance dips) · all engineering cardinals.

- **Goal.** Working code mirroring approved Phase 2 contracts.
- **Rules.**
  - Each engineering role implements its part in its owned paths (`local/bindings.md`).
  - Parallel where independent.
  - Phase 5 overlaps once Phase 3 passes.
  - Runs under `core/protocols/iteration-protocol.md`.
- **Blueprint-diff entry precondition.** Every dispatch touching the configured `visual-source-of-truth.path` runs `core/protocols/blueprint-diff-protocol.md` as first step — diff vs `blueprint-ref` · classify Expected / Unexpected / Pre-existing · surface to team-lead before any edit. Unexpected delta → forced-interactive gate (auto-mode does NOT elide). Inapplicable when dispatch carries no edit on the configured path — cite `"visual-SoT untouched — protocol n/a"` and skip.
- **`solution-architect` governance dip.** Triggered only when the in-flight PR touches an SA-owned file per `local/bindings.md § Source-of-truth ownership` (NOT every Phase 4 PR). Spot-checks engineer deltas against architecture invariants + ASRs. Drift → PR comment + dispatch back to owning engineer. Per `core/roles/solution-architect.md § Governance`.
- **`solution-architect` review on in-flight proposals.** If an engineer proposes an architectural change mid-Phase 4 (new contract / topology / stack / NFR-affecting decision), SA reviews per `§ Review` — APPROVE / REJECT / REQUEST-CHANGES. SA never edits the engineer's code.
- **Acceptance.**
  - Compiles / builds clean.
  - Per-project unit tests pass.
  - No new lint or type errors.
