# Cross-domain bugs — integration + compliance cycle

**Load-on-demand.**

- Fetched when a bug or task is detected to span 2+ domains.
- Default single-domain tasks do not load this file.

**Model.** Four-phase:

- Parallel where independent.
- Sequential only where a real dependency exists.

## Phase 1 — Contract change (sequential)

- **Required only if** the bug needs a contract change. Examples:
  - Architecture invariant.
  - Requirement addition.
  - Wire shape.
  - Env var.
- `solution-architect` lands the doc change first.
- Engineers cannot start their parts until the contract wording exists.

## Phase 2 — Domain implementations (parallel by default)

- Each engineering domain implements its own part independently.
- Orchestrator MUST dispatch all independent domain parts in a single message.
- **Independence test** — both must hold:
  - Domain A's deliverable is NOT required to compile/run/test in domain B's source tree.
  - Both domains can reference the Phase 1 contract wording without needing each other's code.
- **Sequential is correct only** when one domain's output is a literal input to the next (e.g. a generated type the next specialist imports).

## Phase 3 — Integration verification (sequential, at the join point)

- Integrator = specialist closest to the user-facing surface:

  | Bug class | Integrator |
  |---|---|
  | UI | mockup-owning role |
  | API | service-owning role |
  | Deploy | `devops-engineer` |

- **Integrator's job.**
  - Run the shared oracle end-to-end.
  - Confirm all Phase 2 deliverables compose correctly.
- **Automated tests are necessary but not sufficient.** For any change adding or modifying user-facing behaviour, Phase 3 also requires a **manual smoke** by the integrator:
  - Against the running solution (project's local-dev startup command).
  - NOT against the mockup or other design artefact.

  Procedure:
  1. Wipe and re-seed the local stack before opening the user-facing surface.
  2. Exercise every NEW user-facing flow in real conditions — not "the page renders", but "the feature does the thing".
  3. Compare running system vs. mockup or architecture doc:
     - Mockup = oracle.
     - Running system = SUT.
     - Feature looks wrong but tests PASS → route to `qa-engineer` to tighten assertions; do NOT call it green.
  4. Record manual smoke results in the Phase 3 report (one line per new feature).
- **If integrator cannot run the user-facing surface** (e.g. headless):
  - State so explicitly.
  - Do not claim manual smoke PASS without doing it.
- **Integration fails** (automated OR manual):
  - Return to the specific Phase 2 domain that broke.
  - NOT a full rerun.

## Phase 4 — Compliance review (sequential, final)

- `solution-architect` reviews against architecture invariants + mockup contract.
- Sign-off only; no edits.
- Invariants violated → return to Phase 2.
- SA's review must verify the integrator's manual-smoke report was actually written (empty section = REJECT, return to Phase 3).

## Sign-off in PR description

- Each domain notes which part it owned.
- Integrator notes verification command/output.
- `solution-architect` notes which requirement / section the result satisfies.
