# Phase 8 — User approval

**Load triggers** — any cardinal whose `phase-participation:` includes `8`. Per-role roster: `team-lead` only (gate surface + delivery finalize).

- **Goal.** User confirms delivered work satisfies the TODO line.
- **Action.** Orchestrator surfaces per the Task model. If manual smoke wasn't run (e.g. headless), asks the user to run it.
- **User choices.**
  - "Yes — mark complete" → see Acceptance below.
  - "No — needs more work" → loop back to Phase 6 with feedback.
- **Acceptance.**
  - TODO line `☐` → `☒` (TODO-sourced).
  - Issue closed + final comment (GitHub-issue-sourced; per `core/github-integration.md`).
  - Project-progress refresh (if used).
  - **Delivery finalize** per the resolved delivery mode — `core/delivery-modes.md`:
    - Mode 1 (branch + PR) → push branch + open PR per `core/templates/pr-description.md`.
    - Mode 2 (working-tree only) → surface diff; user commits / discards manually.
    - Mode 3 (commit-no-push) → surface commit list; user pushes manually.
  - Never commit / push outside the resolved mode (the framework's "commit only when the user explicitly asks" invariant is realized via mode selection at Phase 3, not silent commits).
- **In automatic mode.** Realized as the **delivery handoff** per `core/automatic-mode.md § Delivery handoff`.
  - User-approval invariant preserved: single explicit accept.
  - Accept / Feedback / Reject replace yes/no.
  - Accept's concrete action depends on resolved mode (see `core/delivery-modes.md § Auto-mode integration`).
- **Post-acceptance doc-optimization hook.** If the task touched any documentation (project-instruction files, architecture docs, role definitions, ADRs, CRs, READMEs):
  - Orchestrator MUST dispatch `ai-engineer` to run `core/protocols/iteration-protocol.md` scoped to the doc diff.
  - Polish step, not a gate.
  - First proposal batch returns "no productive proposals" → hook completes immediately.
  - No user permission required to invoke.
  - User sees the cumulative optimization diff in the final report; may accept or revert as a unit.
