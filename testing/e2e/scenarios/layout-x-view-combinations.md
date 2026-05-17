# All 12 (view, layout) combinations render without console errors

**Intent:** every combination of the four views (Detailed / Compact /
Glance / Focus) and the three layouts (Matrix / Swim-lane /
Workflow-rows) renders the matrix without throwing any browser
console errors. This is the "no regressions" oracle for FR-13's
orthogonality claim.

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
and every `layout` in `['matrix', 'swim-lane', 'workflow-rows']`:

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

- 12 individual subtests, one per (view, layout) combination.
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

## Coverage

- FR-13: all 12 (view, layout) combinations supported.
- NFR-09: layout invariant applies to every combination.
