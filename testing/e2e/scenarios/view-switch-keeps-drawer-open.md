# Switching views keeps the history drawer open on the same slot

**Intent:** the drawer is a full-fidelity detail surface and is
independent of the matrix layout. Switching views must NOT close the
drawer nor change which `(service, environment)` slot it is showing,
because every view renders every fixture slot — the slot is always
present under the new layout.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-04 ("clicking a
  slot shall open a side panel showing ... deployment history").
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` FR-12
  (four views, view switching).
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  "Full-attribute disclosure rule" — "the side-panel history drawer
  ... always display every deployment attribute available to the
  user, regardless of the matrix attribute picker".
- `docs/ui/compact-options.md` "Drawer behaviour on view change" —
  "The drawer **stays open** when the user switches views, provided
  the previously-clicked `(service, env)` still exists in the new
  layout (which it always does)".

## Preconditions

- Stack up, fixtures seeded with the 6-state corpus (so `service-b /
  qa` is present per `testing/fixtures/seed-data.json`).
- `localStorage` cleared at the start of the test, so the page loads
  on the Detailed view.

## Steps

1. **Given** the SPA is loaded on the Detailed view,
2. **When** the test clicks `[data-testid="stage-box-service-b-qa"]`,
3. **Then** the drawer is open
   (`[data-testid="history-drawer"]` is visible),
4. **And** the drawer carries `data-drawer-slot="service-b/qa"` (or
   equivalent textual / `aria-label` evidence that the open drawer is
   for that slot).
5. **When** the test switches to Compact via
   `[data-testid="view-option-compact"]`,
6. **Then** the drawer remains visible,
7. **And** the drawer slot identifier is still `service-b/qa`.
8. **When** the test switches to Glance via
   `[data-testid="view-option-glance"]`,
9. **Then** the drawer remains visible and is still scoped to
   `service-b/qa`.
10. **When** the test switches to Focus via
    `[data-testid="view-option-focus"]`,
11. **Then** the drawer remains visible and is still scoped to
    `service-b/qa`.
12. **When** the test closes the drawer
    (`[data-testid="drawer-close"]`),
13. **Then** the drawer is no longer visible,
14. **And** no JavaScript errors were logged to the browser console
    during the entire test (the Playwright `pageerror` listener
    recorded zero entries).

## Expected results

- The drawer's open/closed state and its `(service, environment)`
  binding are independent of the active layout view.
- No errors fire when the matrix re-renders under each view while the
  drawer is open — confirming the drawer reads from the per-slot
  store, not from the matrix DOM.
- After explicit close, the drawer is gone — the view-switch did not
  leave a stale node mounted.

## Out of scope

- Drawer content correctness (covered by the existing
  `drawer-history.md` scenario).
- Lazy-fetch of history rows (also covered by `drawer-history.md`).
- Drawer behaviour when a new event arrives over SSE while the drawer
  is open (covered by `realtime-sse-update.md`).

## Coverage

- FR-04: history drawer rendering on slot click.
- FR-12: four-view switching does not disrupt other open UI state.
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  "Full-attribute disclosure rule" — drawer is independent of the
  matrix layout.
- `docs/ui/compact-options.md` "Drawer behaviour on view change".
