# Phase 3 — Design review

**Load triggers** — any cardinal whose `phase-participation:` includes `3`. Per-role roster: `team-lead` only (gate surface).

- **Goal.** Synchronous gate — explicit user approval of Phase 2 before implementation.
- **Action.** Orchestrator MUST present: architecture-doc diff + mockup link + API contract + work-breakdown.
- **Outcomes.**
  - Approval → Phase 4 dispatches.
  - Remarks → loop back to Phase 2.
- **Distinct from.** Phase 8 (closes TODO); TODO-workflow checkpoint (sits before Phase 1).
- **Acceptance.** Explicit user approval. Without it, Phase 4 does not start.
- **In automatic mode.** Elided when Phase 2 produces no user-visible behaviour change. Forced back to interactive per `core/automatic-mode.md § Forced-interactive triggers`.

## Implementation gate

- Phase 4 starts only when:
  - Phase 2 contract surface is fixed, AND
  - Phase 3 design-review gate has passed.
- No engineer codes against an unapproved design.
