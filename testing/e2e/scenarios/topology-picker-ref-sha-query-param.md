# Topology correlation picker exposes `ref` and `sha`; selection lands on the next matrix read as `?correlationAttribute=`

**Intent:** the Topology correlation picker (FR-13) exposes a radio
option for every value in the allowed set
`{version, ref, sha, actor, run, ago}`. Selecting `ref` or `sha`
writes the value to `localStorage["dashboard.correlationAttribute"]`
AND appends it as `?correlationAttribute=ref` (or `=sha`) on the next
`GET /api/deployments` request. No `PATCH /api/config/topology`
request is ever issued by the SPA (per SAD §10 Decision #7). No
`X-Api-Key` header travels with any picker action (per NFR-04).

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-13 (Topology
  correlation picker — admits `ref` and `sha` as per-request hints).
- `docs/deployment-dashboard-architecture.md` §7 "GET
  /api/deployments — query parameters" — `correlationAttribute`
  allowed values include `ref` and `sha`.
- `docs/deployment-dashboard-architecture.md` §5 NFR-04 (SPA is
  read-only against the API; no auth secrets in the browser).
- `docs/deployment-dashboard-architecture.md` §10 Decision #7
  (per-user picker = `localStorage`-only; no PATCH from the SPA).
- The companion scenario
  `correlation-picker-localstorage-and-no-api-key.md` already
  exercises `actor` and `sha` on the same picker. This scenario adds
  the explicit `ref` path AND pins the end-to-end consequence:
  changing the correlation attribute to `ref` causes the topology
  edges for fixture services correlated by `ref` to surface
  (functional-suite oracle: `TopologyCorrelationByRefShaTests.cs`).

## Preconditions

- Stack up, fixtures seeded — the canonical 6-state corpus AND the
  topology corpus AND the two new fixture services
  `topo-ref-correlated` / `topo-sha-correlated` from
  `testing/fixtures/seed-data.json`.
- `localStorage` cleared at the start of the test.
- `page.on('request', …)` capture installed before any navigation,
  so the bootstrap matrix GET is observable.

## Steps

### Part 1 — Picker exposes `ref` and `sha` options

1. **Given** the SPA at `/`,
2. **When** the test opens the topology picker via
   `[data-testid="topology-picker-button"]`,
3. **Then** the popover renders six options:
   - `[data-testid="topology-option-version"]`
   - `[data-testid="topology-option-ref"]`
   - `[data-testid="topology-option-sha"]`
   - `[data-testid="topology-option-actor"]`
   - `[data-testid="topology-option-run"]`
   - `[data-testid="topology-option-ago"]`
4. **And** all six are present and the option corresponding to the
   server-side default (or persisted) value is `checked`.

### Part 2 — Selecting `ref` writes to localStorage and lands on the next matrix GET

5. **When** the test clicks the label associated with
   `[data-testid="topology-option-ref"]`,
6. **Then**
   `localStorage.getItem("dashboard.correlationAttribute")` returns
   `"ref"`,
7. **And** the next `GET` to `/api/deployments` carries
   `?correlationAttribute=ref` in its query string (observed via the
   `page.on('request', …)` collector),
8. **And** the request has NO `X-Api-Key` header,
9. **And** NO `PATCH` request was issued in the scenario.

### Part 3 — Selecting `sha` updates both localStorage and the next matrix GET

10. **When** the test clicks the label for
    `[data-testid="topology-option-sha"]`,
11. **Then**
    `localStorage.getItem("dashboard.correlationAttribute")` returns
    `"sha"`,
12. **And** the next `GET /api/deployments` carries
    `?correlationAttribute=sha`.

### Part 4 — Reload reads the persisted value

13. **When** the test reloads the page,
14. **Then** the first `GET /api/deployments` issued by the SPA's
    bootstrap carries `?correlationAttribute=sha` (the persisted
    selection — no manual interaction needed after reload).

## Expected results

- `topology-option-ref` and `topology-option-sha` are first-class
  options in the picker UI (data-testid present, clickable).
- Selecting either writes the attribute key (`"ref"` or `"sha"`) to
  `localStorage["dashboard.correlationAttribute"]`.
- Selecting either causes a fresh `GET /api/deployments` with the
  attribute as a query parameter to be observed by the page-level
  request collector.
- No `PATCH` requests are issued by the SPA at any point in the
  scenario.
- No request carries an `X-Api-Key` header.
- Reload restores the persisted attribute as the value of the
  bootstrap GET's query string.

## Out of scope

- The actual matrix-content diff between `?correlationAttribute=ref`
  and `=sha` — that's the functional-suite oracle
  (`TopologyCorrelationByRefShaTests.cs`).
- The 400-rejection path for invalid `correlationAttribute` values —
  also functional (`MatrixCorrelationQueryParamTests.cs`).
- Per-service overrides (`PATCH /api/config/topology`) — admin-only,
  never invoked by the SPA.

## Coverage

- FR-13 (Topology correlation picker exposes `ref` and `sha`).
- SAD §7 "GET /api/deployments — query parameters" allowed set
  including `ref` and `sha`.
- SAD §5 NFR-04 (no `X-Api-Key` from the SPA).
- SAD §10 Decision #7 (picker is `localStorage`-only; no PATCH from
  the SPA).
