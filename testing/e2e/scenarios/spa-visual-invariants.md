# SPA enforces the six geometric invariants under every (view, layout) combination

**Intent:** the live Angular SPA must satisfy the same six geometric
invariants the mockup harness already validates against the static
mockup (`testing/mockup-visual/mockup-invariants.spec.ts`). The
invariants are the executable form of NFR-09's "UX-RESPONSIVENESS
INVARIANT". The Glance view applies the documented exception for
env-tag-inside-pill containment.

## Citations

- `docs/deployment-dashboard-architecture.md` §5 NFR-09 — the full
  invariant text and the Glance-only exception.
- `docs/deployment-dashboard-architecture.md` §7 "Mockup ↔ Angular
  SPA bridge" ("an equivalent Playwright suite under `testing/e2e/`
  validates the SPA against the same six invariants. Drift between
  the mockup and the SPA is a defect.").
- `testing/mockup-visual/mockup-invariants.spec.ts` — the original
  in-browser evaluator.
- `testing/mockup-visual/harness.config.json` — the declarative
  config the mockup harness reads; mirrored at
  `testing/e2e/spa-invariants.config.json`.

## Invariants (per NFR-09)

| ID | Label |
|---|---|
| I1 | No overlap: env-tag vs deployment box (Glance exception: paired env-tag inside its OWN paired box is allowed) |
| I2 | Env-tag text is not clipped |
| I3 | Connector reaches its target box (±2 px) |
| I4 | Connector emerges from source box edge (±2 px) |
| I5 | Connector does not cross any env-tag rect |
| I6 | Box content stays within parent box |

## Preconditions

- Stack up, fixtures seeded (6-box-state corpus + Phase 2 topology
  corpus). The corpus is what populates the matrix the invariants
  measure.
- `localStorage` cleared each test.

## Steps

For every `view` in `['detailed', 'compact', 'glance', 'focus']`
and every `layout` in `['matrix', 'swim-lane', 'workflow-rows']`:

1. **Given** the SPA is loaded with cleared `localStorage`,
2. **When** the test selects the given view and the given layout,
3. **And** waits for the matrix to settle (at least one stage box
   visible, two paint frames),
4. **Then** running the six in-browser invariant checks (identical
   to the mockup harness's `evaluateInvariantsScript`) produces
   zero violations,
5. **And** any violation found is reported as
   `[I<n>] <message>` with element identifier and pixel-delta
   detail so a frontend-engineer can triage without re-running
   locally.

## Expected results

- 12 subtests run; every one passes against a SPA that matches the
  mockup contract.
- Subtest failures isolate the violating invariant ID, the offending
  element's `data-testid`, and the pixel delta — direct mapping to
  the mockup harness's report format.
- Glance view's paired env-tag-in-pill exception is honoured via
  the same `viewExceptions` block.

## Out of scope

- Pixel-perfect screenshot diffing (Playwright trace + screenshots
  capture on failure for triage but aren't asserted against a
  baseline).
- Mockup ↔ SPA visual parity beyond the six invariants — that's a
  manual review point on PRs that touch CSS, not an automated test.

## Coverage

- NFR-09: UX-RESPONSIVENESS INVARIANT across all (view, layout)
  combinations.
- SAD §7 "Mockup ↔ Angular SPA bridge" — SPA matches mockup contract.
- FR-12, FR-13: all 12 combinations supported.
