# correlation-picker-localstorage-and-no-api-key

The correlation-attribute picker writes a user preference to
`localStorage` ONLY and appends it as a query parameter on the next
matrix read. The SPA NEVER sends an `X-Api-Key` header — the picker is
not a write surface.

## Citations

- SAD §5 NFR-04 "The SPA itself is read-only against the API and does
  not handle authentication secrets. Write endpoints
  (`POST /api/deployments`, `PATCH /api/config/topology`) are reserved
  for CI/CD and ops tooling. The dev-environment fake API key is never
  embedded in the SPA bundle."
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "API Contract" —
  "PATCH /api/config/topology": "Admin / CI / ops tooling only — not
  invoked by the SPA. The SPA expresses per-user picker preferences
  via the `correlationAttribute` query parameter on read endpoints,
  not by writing to this endpoint."
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` Decision #7 — SPA
  stays read-only; per-user picker is `localStorage`-only.
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` Decision #8 — SSE
  wire shape never carries topology; the SPA refreshes via
  `GET /api/deployments?correlationAttribute=…` after each event.
- `docs/WBS.md` MVP §3.2.5 / §3.2.6 — picker-attribute round-trip e2e cases.
- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` "Dashboard Frontend
  (MVP)" — "correlation-attribute picker (per-user override; written to
  `localStorage` only; appended as `correlationAttribute` query
  parameter on read endpoints)".

## Preconditions

- Canonical 6-state corpus seeded (the SPA renders boxes either way;
  the picker is what we exercise here).
- `localStorage` cleared before the test (Playwright fresh context).

## Steps

1. **Given** the SPA at `/`, with no `dashboard.correlationAttribute`
   key in `localStorage`.
2. **When** I observe outgoing requests from the page (via
   `page.on('request', …)`).
3. **Then** every request to `/api/*` from the SPA carries NO
   `X-Api-Key` header. This holds for the initial matrix fetch, the
   SSE `/api/stream` connection, and any subsequent refresh.
4. **When** I select a non-default correlation attribute via the
   picker (e.g. `actor`).
5. **Then**:
   - `localStorage.getItem('dashboard.correlationAttribute')` returns
     `'actor'`.
   - The next `GET /api/deployments` carries
     `?correlationAttribute=actor` in its query string.
   - The request still has NO `X-Api-Key` header.
   - No `PATCH /api/config/topology` request is issued (the picker is
     `localStorage`-only — it never mutates server state).
6. **When** I select another attribute (e.g. `sha`).
7. **Then** `localStorage` updates to `'sha'` and the next matrix GET
   carries `?correlationAttribute=sha`.
8. **When** I reload the page.
9. **Then** the persisted `'sha'` is reflected — the initial matrix
   fetch on the new page carries `?correlationAttribute=sha`.

## Expected results (observable)

- `localStorage.getItem('dashboard.correlationAttribute')` is exactly
  one of `'version' | 'ref' | 'sha' | 'actor' | 'run' | 'ago'` or
  absent. No other values land in `localStorage`.
- For every request seen by `page.on('request', …)`:
  - URL starts with the SPA's gateway origin (`http://localhost:8080`).
  - `headers['x-api-key']` is undefined (Playwright lowercases header
    keys).
- Exactly zero `PATCH` requests are issued by the SPA across the whole
  scenario.

## Out of scope

- The picker UI's visual treatment (active state, popover label,
  system-default label) — those belong in their own scenarios.
- The matrix-content diff between attributes — covered by
  `MatrixCorrelationQueryParamTests.cs` on the functional side.
- The 400-rejection path for unknown attributes — covered by the
  functional suite; the picker only emits values from the allowed set.

## Coverage

Validates: SAD §5 NFR-04,
`docs/cr/CR-0003-tree-topology-and-layout-axis.md` Decisions #7 and #8,
`docs/cr/CR-0003-tree-topology-and-layout-axis.md` "PATCH
/api/config/topology" (admin-only), `docs/WBS.md` MVP §3.2.5 / §3.2.6.
