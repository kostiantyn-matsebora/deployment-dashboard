# View switcher selects the active layout view and persists it across reloads

**Intent:** the four-view segmented control in the header lets the user
pick Detailed / Compact / Glance / Focus; the chosen view is persisted
to `localStorage` under `dashboard.view` and survives a full page
reload.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-12 ("the dashboard
  shall expose four named layout views ... view selection and per-view
  attribute selection persist client-side in `localStorage`").
- `docs/deployment-dashboard-architecture.md` §7 "Layout views (FR-12)"
  — table of the four views and the default-first-visit rule
  (Detailed).
- `docs/deployment-dashboard-architecture.md` §7 "Client-side
  persistence (`localStorage`)" — key `dashboard.view`, value one of
  `'detailed' / 'compact' / 'glance' / 'focus'`.
- `docs/ui-compact-options.md` — switcher behaviour + localStorage key
  shapes.

## Preconditions

- Stack up, fixtures seeded with the canonical 6-state corpus via
  `testing/scripts/seed.ps1`.
- `localStorage` cleared at the start of every test (via
  `page.evaluate(() => localStorage.clear())` in `beforeEach`), so the
  page loads as a "first-time visitor".

## Steps

1. **Given** the SPA is loaded for the first time (cleared
   `localStorage`),
2. **Then** the view switcher (`[data-testid="view-switcher"]`) is
   visible,
3. **And** the active view is `detailed` — i.e. `view-option-detailed`
   carries the active marker (`data-active="true"`) and the body /
   matrix root carries `data-view="detailed"`,
4. **And** `localStorage.getItem('dashboard.view')` is either absent
   (defaults apply) or equals `"detailed"`.
5. **When** the test clicks `[data-testid="view-option-compact"]`,
6. **Then** `data-active="true"` moves to `view-option-compact`,
7. **And** `[data-testid="pipeline-matrix"]` (or its root) now carries
   `data-view="compact"`,
8. **And** `localStorage.getItem('dashboard.view')` equals `"compact"`.
9. **When** the test reloads the page,
10. **Then** `view-option-compact` is still the active option,
11. **And** `data-view="compact"` is still applied.
12. **Repeat** steps 5-11 for `view-option-glance` (verifying
    `data-view="glance"` and persisted value `"glance"`).
13. **Repeat** steps 5-11 for `view-option-focus` (verifying
    `data-view="focus"` and persisted value `"focus"`).

## Expected results

- A first-time visitor lands on the **Detailed** view by default
  (matches the SAD's stated default).
- Clicking any other view option swaps the `data-active` marker and
  the matrix `data-view` attribute in lock-step.
- The selection is written to `localStorage["dashboard.view"]`
  immediately on click (no debouncing assumption — the test does NOT
  sleep before reading the key).
- A full `page.reload()` restores the persisted view without
  flashing back to the default.

## Out of scope

- The per-view attribute picker (covered by
  `attribute-picker-cap-enforcement.md` and
  `attribute-picker-persistence.md`).
- Drawer survival across view switches (covered by
  `view-switch-keeps-drawer-open.md`).
- The visual differences between views — e.g. row height, pill versus
  box rendering — those are visual contract details left to the
  frontend's component-level tests; the E2E suite asserts only the
  `data-view` marker and the persistence.

## Coverage

- FR-12: four named layout views with `localStorage` persistence of
  the active view.
- SAD §7 "Layout views (FR-12)" — the table of named views and the
  Detailed-as-default-first-visit rule.
- SAD §7 "Client-side persistence (`localStorage`)" — `dashboard.view`
  key with the documented value set.
