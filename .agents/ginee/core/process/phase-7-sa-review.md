---
audience: all-cardinals
load: on-demand
triggers: [phase-7, sa-review, pr-review]
cap-bytes: 4096
reads-before-applying: []
---

# Phase 7 — SA review

**Load triggers** — SA (sign-off, no bypass) + TL (TL4 lead-elision per `core/protocols/heavy-role-bypass.md`: single-cardinal PR collapses to SA → user; TL re-entry on multi-cardinal PR · SA REJECT · cross-domain bug surfaced · Phase 8 finalize in auto mode).

- **Goal.** `solution-architect` confirms compliance with architecture invariants, requirements, mockup behavioural contracts.
- **Lighter under the classical-architect model.** Governance already ran continuously across Phase 4 / 5 / 6 (per `core/roles/solution-architect.md § Governance`); Phase 7 is the **final coherence check**, not a first-pass review. Most concerns should already be resolved.
- **Checks.**
  - Architecture invariants honoured (cross-check against ASR utility tree).
  - Mockup behavioural contract honoured.
  - Phase 5 manual-smoke section was actually written (empty = REJECT, return to Phase 5).
  - ASR coverage — every ASR touched by the change is addressed by ≥ 1 ADR or architecture-doc section.
- **Constraint.** Sign-off only; no code edits.
- **Iteration.** Runs under `core/protocols/iteration-protocol.md` when follow-up architecture-doc edits exceed 15 min.
- **Acceptance.**
  - APPROVE (with or without pending additive architecture-doc edits), OR
  - RETURN-TO-engineer with specific findings.
