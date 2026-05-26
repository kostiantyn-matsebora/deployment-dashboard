---
audience: all-cardinals
load: on-demand
triggers: [phase-5, testing]
cap-bytes: 4096
reads-before-applying: []
---

# Phase 5 — Testing

**Load triggers** — cardinals with `phase-participation:` including `5`. Heavy-role-bypass per `core/protocols/heavy-role-bypass.md` — SA2 NFR-oracle dip · TL2 single-cardinal verification (TL re-entry only on cross-domain bug · non-empty `## Open issues` · `## Hand-off` set · `Status: In-progress`).

- **Goal.** Verify implementation against contracts: executable suites + manual smoke against the running solution.
- **Scope — change-scoped by default.** Run only:

  | Layer | What runs |
  |---|---|
  | New / modified scenarios | functional / API / e2e / harness / script for touched code paths |
  | Per-project unit specs | in modified files |
  | Pre-existing scenarios | only if their covered contract was edited in Phase 2 or 4 |

- **Full regression — opt-in only.**
  - User must explicitly request it.
  - `team-lead` MAY remind it's available (wide-reach refactor / infra change / risky touch).
  - `team-lead` MUST warn of significant wall-clock + token cost.
  - Runs separately AFTER change-scoped pass is green.
  - Reports: pass/fail per suite + wall-clock + approximate token cost.
- **Discipline.**
  - Tests reference contracts, not implementation internals.
  - Oracles TIGHT per `core/process.md § Test oracles can be wrong`.
  - Manual smoke against the running solution (project's local-dev startup command), NOT design artefacts.
  - Iteration protocol when scope > 15 min — `core/protocols/iteration-protocol.md`.
- **SA governance dip.** Per `core/protocols/heavy-role-bypass.md § SA2`. Trigger: NFR-oracle fails OR test surfaces architectural concern. SA reviews per `§ Governance`; never edits test code; routes finding back through Phase 6 or as new ADR.
- **`qa-engineer` pixel-check (optional, off by default).** Fires when `local/framework.config.yaml § qa.pixel-check.enabled: true` AND the change diff touches the visual surface AND seed-script + mockup-snapshot + app-render are configured. Inserts between change-scoped e2e and manual smoke; routes per drift source (front-end engineer · mockup-owning role · seed-script owner · team-lead for tolerance). Full spec: `core/protocols/pixel-check-protocol.md`.
- **Acceptance.**
  - Change-scoped suite green.
  - Oracles reflect correctness for touched surfaces.
  - Manual-smoke report recorded (caveat if not run, e.g. headless).
  - Failures → Phase 6.
  - Opt-in full regression is its own pass — not a precondition.
