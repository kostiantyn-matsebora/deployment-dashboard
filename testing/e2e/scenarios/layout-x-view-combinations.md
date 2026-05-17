# All 8 (view, layout) combinations render without console errors

**Intent:** every combination of the four views (Detailed / Compact /
Glance / Focus) and the **two MVP layouts** (Swim-lane / Workflow-rows)
renders the matrix without throwing any browser console errors. This is
the "no regressions" oracle for FR-13's orthogonality claim.

> **MVP scope:** the Matrix layout has been removed from MVP and
> deferred to Phase 2.0. Active MVP layout axis = `['swim-lane',
> 'workflow-rows']`. When Matrix is re-added, restore it to the
> `layout` axis below and bump the combination count back to 12.

## Citations

- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` FR-13 ("all
  4 x 3 = 12 (view, layout) combinations are supported").
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Layout axis
  (FR-13)" — orthogonality and Glance-pill exception.
- `docs/architecture.md` §5 NFR-09 — the
  UX-RESPONSIVENESS INVARIANT applies under every (view, layout)
  combination.

## Preconditions

- Stack up, fixtures seeded (matrix has at least one service per
  service-a/b/c/d plus the three topology services).
- `localStorage` cleared at the start of every test.

## Steps

For every `view` in `['detailed', 'compact', 'glance', 'focus']`
and every `layout` in `['swim-lane', 'workflow-rows']` (Matrix
deferred to Phase 2.0):

1. **Given** the SPA is loaded with a fresh `localStorage`,
2. **And** Playwright is recording all `console.error` events on
   the page,
3. **When** the test clicks `[data-testid="view-option-${view}"]`
   followed by `[data-testid="layout-option-${layout}"]`,
4. **Then** the matrix root reports `data-view="${view}"` and
   `data-layout="${layout}"`,
5. **And** the matrix root remains visible,
6. **And** at least one `[data-testid^="stage-box-"]` element is
   rendered (so we know the matrix has populated, not just that the
   root mounted),
7. **And** zero `console.error` events were recorded between the
   navigation and the assertion.

## Expected results

- 8 individual subtests, one per (view, layout) combination (4 views
  x 2 MVP layouts). 12 returns once Matrix is re-added in Phase 2.0.
- Each subtest passes if and only if the matrix root carries the
  correct `data-*` markers AND no console errors fired during
  rendering.
- Console-error capture excludes WebKit-only EventSource warnings
  (already a known harmless quirk) — the exclusion list is
  declarative in the spec.

## Out of scope

- Visual / geometric correctness (covered by `spa-visual-invariants.md`).
- Swim-lane connector geometry (covered by `swim-lane-connectors.md`).
- Workflow-rows expansion behaviour (covered by
  `workflow-rows-expand-row.md`).
- The Matrix layout — removed from MVP, deferred to Phase 2.0
  (`deferred-phase-2.0/matrix-*.md`).

## Coverage

- FR-13: all (view, layout) combinations of the MVP layout axis
  supported. MVP scope = 4 views x 2 layouts = 8 combinations;
  Matrix is deferred to Phase 2.0.
- NFR-09: layout invariant applies to every combination.
