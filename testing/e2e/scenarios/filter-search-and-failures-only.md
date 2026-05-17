# Search filter and "Failures only" toggle narrow the matrix and trigger empty state

**Intent:** both header controls filter the rendered services in real time,
and when their combination matches nothing the empty-state panel is shown.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-07 ("filtering by service
  name and by failure state only").
- `docs/ui/deployment-dashboard.html` - the mockup's `filteredServices` getter
  defines the precise semantics: case-insensitive `.includes()` on
  `service.name`, AND with at least one env in `failure` state when
  "Failures only" is on.
- `frontend/dashboard/src/app/dashboard-header.component.ts` - exposes
  `data-testid="search-input"` and `data-testid="failures-only-toggle"`.
- `frontend/matrix/src/lib/pipeline-matrix.component.ts` - exposes
  `data-testid="empty-state"` when `filteredServices.length === 0`.

## Preconditions

- Stack up, fixtures seeded.
- Seeded services that the assertions rely on:
  `service-a`, `service-b`, `service-c`, `service-d`.
- Of those, only `service-b` has a slot with
  `current.status === 'failure'` (`service-b/qa`). `service-a`,
  `service-c`, and `service-d` do not. Note that
  `service-d` and `service-c` have in-progress slots with
  `previousFailed === true`; per the mockup's `filteredServices()`
  getter in `docs/ui/deployment-dashboard.html` (line 501,
  `e?.current?.status === 'failure'`), `previousFailed` does NOT
  contribute to the "Failures only" filter - only the *current*
  terminal `failure` state does.

## Steps

### Part 1 - search filter

1. **Given** the matrix renders four services,
2. **When** the user types `service a` (lowercase) into
   `[data-testid="search-input"]`,
3. **Then** only `[data-testid="service-row-service-a"]` remains visible.
4. **When** the user clears the search and types `SERVICE B` (uppercase),
5. **Then** only `[data-testid="service-row-service-b"]` remains visible
   (case-insensitive match).
6. **When** the user clears the search,
7. **Then** all four service rows are visible again.

### Part 2 - failures-only toggle

8. **When** the user checks `[data-testid="failures-only-toggle"]`,
9. **Then** the visible services are exactly those with at least one
    slot in `current.status === 'failure'`. In the seeded corpus that
    is `service-b` only - `service-a`, `service-c`, and
    `service-d` are hidden (even though `service-d`
    has an in-progress slot with `previousFailed: true`, the mockup's
    filter ignores `previousFailed`).
10. **When** the toggle is unchecked,
11. **Then** all four services are visible again.

### Part 3 - empty state

12. **When** the user types a string that matches no service (e.g.
    `zzz-no-such-service`),
13. **Then** zero `[data-testid^="service-row-"]` elements are rendered,
14. **And** `[data-testid="empty-state"]` is visible.

## Expected results

- Search filter operates case-insensitively on the service display name
  (not the id - the mockup matches on `s.name`).
- Failures-only toggle filters to services where any env has
  `current.status === 'failure'`. `previousFailed === true` does NOT
  count - the mockup's `filteredServices()` getter
  (`docs/ui/deployment-dashboard.html`, the `filter(s => ...)` body)
  inspects only `e?.current?.status`.
- Empty state is shown when the filtered services count is zero.
- All filter changes are immediate (no debounce-driven delay > 250 ms).

## Out of scope

- Stats-bar counter assertions when filters are applied - the matrix
  scenario already touches stats values; this scenario is about the
  filter behaviour itself.
- Keyboard shortcuts for the search input.

## Coverage

- FR-07: filtering by service name and by failure state only.
- Mockup: `filteredServices` getter + empty-state panel.
