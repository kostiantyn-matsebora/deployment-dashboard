# Phase 6 — Bug fixing

**Load triggers** — any cardinal whose `phase-participation:` includes `6`. Per-role roster: `team-lead` · `solution-architect` (review on architectural fix) · `qa-engineer` (parallel exercises) · owning engineering cardinal.

- **Goal.** Resolve defects from Phase 5 (or manual smoke) until all change-scoped oracles are green.
- **Rules.**
  - Owning engineer fixes the failing surface.
  - QA exercises other scenarios in parallel — a fix never freezes the test run.
  - Routes back to the specific Phase 4 surface, not a full Phase 4 rerun.
  - Runs under `core/protocols/iteration-protocol.md`.
- **`solution-architect` review on architectural fixes.** If a proposed fix involves an architectural change (vs. local bug fix), SA reviews per `§ Review`. APPROVE → engineer implements; REJECT / REQUEST-CHANGES → iterate. Local bug fixes route directly engineer → engineer, no SA dispatch.
- **Acceptance.**
  - Change-scoped oracles green.
  - No regression in touched surfaces.
  - Manual smoke re-run if a user-visible surface was touched.
  - Opt-in full regression is part of that opt-in pass — not a Phase 6 gate.
