# Layout switcher selects the active SPA layout and persists across reload

**Intent:** the three-layout segmented control in the header lets the
user pick Matrix / Swim-lane / Workflow-rows; the chosen layout is
persisted to `localStorage` under `dashboard.layout` and survives a
full page reload. Layout selection is orthogonal to view (FR-12).

## Citations

- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` FR-13 ("the SPA
  shall offer three layouts ... selectable from a top-bar segmented
  control. Layout selection is orthogonal to view (FR-12): all 4 x 3
  = 12 (view, layout) combinations are supported. Layout selection
  persists client-side in `localStorage` under key `dashboard.layout`.
  Default: `Matrix` (preserves canonical first paint).").
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Layout axis
  (FR-13)" — table of the three layouts and the
  Matrix-as-default-first-visit rule.
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Client-side
  persistence (`localStorage`)" — key `dashboard.layout`, value one of
  `'matrix' / 'swim-lane' / 'workflow-rows'`.

## Preconditions

- Stack up, fixtures seeded with the canonical 6-state corpus +
  Phase 2 topology corpus via `testing/scripts/seed.ps1`.
- `localStorage` cleared at the start of every test (via
  `page.evaluate(() => localStorage.clear())` in `beforeEach`), so the
  page loads as a "first-time visitor".

## Steps

1. **Given** the SPA is loaded for the first time (cleared
   `localStorage`),
2. **Then** the layout switcher (`[data-testid="layout-switcher"]`)
   is visible,
3. **And** the active layout is `matrix` — i.e.
   `layout-option-matrix` carries `data-active="true"` and the
   matrix root carries `data-layout="matrix"`,
4. **And** `localStorage.getItem('dashboard.layout')` is either
   absent or equals `"matrix"`.
5. **When** the test clicks
   `[data-testid="layout-option-swim-lane"]`,
6. **Then** `data-active="true"` moves to
   `layout-option-swim-lane`,
7. **And** `[data-testid="pipeline-matrix"]` (the matrix root) now
   carries `data-layout="swim-lane"`,
8. **And** `localStorage.getItem('dashboard.layout')` equals
   `"swim-lane"`.
9. **When** the test reloads the page,
10. **Then** `layout-option-swim-lane` is still the active option,
11. **And** `data-layout="swim-lane"` is still applied.
12. **Repeat** steps 5–11 for `layout-option-workflow-rows`
    (verifying `data-layout="workflow-rows"` and persisted value
    `"workflow-rows"`).
13. **Repeat** steps 5–11 returning to `layout-option-matrix`
    (verifying `data-layout="matrix"` and persisted value
    `"matrix"`).

## Expected results

- A first-time visitor lands on the **Matrix** layout by default
  (matches the SAD's stated default).
- Clicking any other layout option swaps the `data-active` marker
  and the matrix `data-layout` attribute in lock-step.
- The selection is written to `localStorage["dashboard.layout"]`
  immediately on click (no debouncing assumption — the test does
  NOT sleep before reading the key).
- A full `page.reload()` restores the persisted layout without
  flashing back to the default.
- View selection is unaffected: the `data-view` attribute and
  `dashboard.view` localStorage key are not touched by layout
  switching.

## Out of scope

- The view switcher (covered by `view-switcher-persists.md`).
- Visual / geometric correctness of each layout (covered by
  `spa-visual-invariants.md` which ports the six mockup-harness
  invariants to the SPA).
- Connector rendering in Swim-lane / Workflow-rows (covered by
  the layout-specific scenarios).

## Coverage

- FR-13: three named layouts with `localStorage` persistence of the
  active layout.
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Layout axis
  (FR-13)" — the table of named layouts and the
  Matrix-as-default-first-visit rule.
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Client-side
  persistence (`localStorage`)" — `dashboard.layout` key with the
  documented value set.
