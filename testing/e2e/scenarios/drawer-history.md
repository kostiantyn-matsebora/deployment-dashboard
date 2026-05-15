# Clicking a stage box opens the history drawer with the slot's events

**Intent:** clicking a populated stage box opens the history drawer, which
renders three things (in order): the "Current deployment" panel, the
"Last successful" panel when the current state is not itself a success,
and the descending-by-time deployment-history list lazy-fetched from
`GET /api/deployments/{service}/{environment}/history`.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-04 ("full deployment
  history per slot...history drawer").
- `docs/deployment-dashboard-architecture.md` §7 "API Contract" -
  `GET /api/deployments/{service}/{environment}/history` returns last N
  events, `?limit=50` default.
- `docs/deployment-dashboard-architecture.md` §7 "Matrix response shape per
  slot" - `current` and `lastSuccessful` shape.
- `docs/deployment-dashboard.html` - the right-hand drawer with current /
  last-successful / history list panels.
- `frontend/drawer/src/lib/history-drawer.component.ts` - the
  `data-testid="history-drawer"`, `drawer-current`,
  `drawer-last-successful`, `drawer-history-list` test IDs used here.

## Preconditions

- Stack up, fixtures seeded.
- Target slot: `service-c/dev` (state
  `running-with-prev-failed-and-last-success`). This slot is chosen
  because it exercises every drawer feature simultaneously:
  current is `in-progress` (so the "Last successful" panel must appear),
  there's a non-empty history (in-progress + failure + success rows),
  and `previousFailed = true`.

## Steps

1. **Given** the matrix is visible and the seeded slot
   `[data-testid="stage-box-service-c-dev"]` is present,
2. **When** the user clicks that stage box,
3. **Then** `[data-testid="history-drawer"]` appears in the DOM,
4. **And** `[data-testid="drawer-service-name"]` reads `Service C`,
5. **And** `[data-testid="drawer-env-label"]` reads `DEV`,
6. **And** `[data-testid="drawer-current"]` is present and contains the
   current version (`v3.1.2`) and the text `running`,
7. **And** `[data-testid="drawer-last-successful"]` is present (current is
   in-progress AND a prior success exists) and references version
   `v3.1.0`,
8. **And** `[data-testid="drawer-history-list"]` is rendered (history was
   lazy-fetched and returned a non-empty list),
9. **And** the history list contains at least three rows,
10. **And** the first row's version is `v3.1.2` (latest event first per
    SAD §7 history endpoint), confirming descending chronological order.
11. **When** the user clicks `[data-testid="drawer-close"]`,
12. **Then** `[data-testid="history-drawer"]` is removed from the DOM.

## Expected results

- Drawer opens on click, closes on the close button.
- All four panels (current, last-successful, history list, header) are
  populated from real API responses, not stub data.
- History order is descending by `deployed_at`.
- Drawer captures every FR-04 requirement.

## Out of scope

- Drawer for a slot in `success` state - implicitly covered by FR-03's
  absence-of-last-successful split; not the focus of this scenario.
- Drawer empty-state when a slot has no history - cannot occur for a
  populated slot in the seeded corpus.

## Coverage

- FR-04: history drawer.
- SAD §7 API Contract: history endpoint shape, descending order.
- Mockup: drawer header + current + last-successful + history list.
