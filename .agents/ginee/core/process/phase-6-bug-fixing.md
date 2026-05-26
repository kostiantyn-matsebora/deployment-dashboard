---
audience: all-cardinals
load: on-demand
triggers: [phase-6, bug-fixing]
cap-bytes: 4096
reads-before-applying: []
---

# Phase 6 — Bug fixing

**Load triggers** — cardinals with `phase-participation:` including `6`. Heavy-role-bypass per `core/protocols/heavy-role-bypass.md` — SA3 architectural-fix dip · TL3 intra-domain bug-fix (TL re-entry only on cross-domain bug per `core/protocols/cross-domain-bugs.md`).

- **Goal.** Resolve defects from Phase 5 (or manual smoke) until all change-scoped oracles are green.
- **Rules.**
  - Owning engineer fixes the failing surface.
  - QA exercises other scenarios in parallel — a fix never freezes the test run.
  - Routes back to the specific Phase 4 surface, not a full Phase 4 rerun.
  - Iteration protocol when scope > 15 min — `core/protocols/iteration-protocol.md`.
- **SA review on architectural fixes** per `core/protocols/heavy-role-bypass.md § SA3`. Fix crosses blueprint-diff threshold → SA `§ Review` (APPROVE → engineer implements; REJECT / REQUEST-CHANGES → iterate). Local fixes route engineer → engineer; no SA dispatch.
- **Acceptance.**
  - Change-scoped oracles green.
  - No regression in touched surfaces.
  - Manual smoke re-run if a user-visible surface was touched.
  - Opt-in full regression is part of that opt-in pass — not a Phase 6 gate.
