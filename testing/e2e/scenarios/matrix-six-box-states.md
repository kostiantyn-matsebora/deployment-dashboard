# Matrix renders every one of the six box states

**Intent:** the pipeline matrix renders one stage box per service x environment,
and each box exposes the correct `data-state` token and class set for the box
state the seeded fixture forces it into. This is the executable contract for
the visual catalogue in the mockup.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-01 (matrix renders),
  FR-02 (slot shows version + status + actor + time + run link),
  FR-03 (current + last-successful split when running or failed).
- `docs/deployment-dashboard-architecture.md` §7 "Web Dashboard (MVP) -
  Visual layout" - the six-state table.
- `docs/ui/deployment-dashboard.html` - the inline `SERVICES` const block which
  is the canonical visual catalogue these states are drawn from.
- `testing/fixtures/seed-data.json` - the same six states encoded as POSTable
  events; this scenario consumes them via `testing/scripts/seed.ps1`.

## Preconditions

- The local docker-compose stack from `dev_env/start.ps1` is up. Read API
  reachable at `http://localhost:8080`, Write API at `http://localhost:8081`.
- `testing/scripts/seed.ps1` has been run successfully (the runner script
  `testing/e2e/run-tests.ps1` invokes it for local targets).
- The matrix therefore contains, at minimum, these six slots:

| Slot | Fixture state | Expected `data-state` |
|---|---|---|
| `service-b` x `dev`  | success                                       | `success` |
| `service-a` x `dev`  | running-with-last-success                     | `running-with-last` |
| `service-c` x `dev`  | running-with-prev-failed-and-last-success     | `running-prev-failed-with-last` |
| `service-b` x `qa`   | failed-with-last-success                      | `failed-with-last` |
| `service-d` x `uat`  | running (no history)                          | `running` |
| `service-d` x `dev`  | running-with-prev-failed (no success history) | `running-prev-failed` |

## Steps

1. **Given** the seeded six-state corpus has been ingested through
   `POST /api/deployments` and is therefore reflected in
   `GET /api/deployments`,
2. **And** a Playwright Chromium browser navigates to `${baseURL}/` (the
   Angular SPA served by the Read API),
3. **When** the `[data-testid="pipeline-matrix"]` element is visible,
4. **Then** for each of the six slots in the table above the corresponding
   `[data-testid="stage-box-<service>-<env>"]` element exists,
5. **And** that element's `data-state` attribute equals the expected token
   from the table,
6. **And** the element carries the colour class expected by the mockup's
   `getBoxClass` (green for `success`, red for `failure`, orange + the
   `in-progress-box` keyframe for `in-progress`),
7. **And** for every slot where the fixture lists a previous `success`
   distinct from the current event, the
   `[data-testid="last-successful-section"]` child exists inside that
   stage-box,
8. **And** for every slot where the fixture marks `previousFailed = true`,
   the `[data-testid="prev-failed-badge"]` child exists,
9. **And** the inner `[data-testid="current-version-<service>-<env>"]` text
   matches the fixture's latest event version verbatim.

## Expected results

- All six stage-boxes are present (no `null` queries).
- `data-state` values match the canonical mapping in the table above.
- `last-successful-section` is rendered for exactly:
  `service-a/dev`, `service-c/dev`, `service-b/qa`.
- `prev-failed-badge` is rendered for exactly:
  `service-c/dev`, `service-d/dev`.
- No box is in the wrong colour bucket (no green box reports
  `failure`, etc.).

## Out of scope

- Hover-driven amber-ring highlight - covered by
  `matrix-version-hover-highlight.md`.
- Drawer / history interaction - covered by `drawer-history.md`.
- Search / failures-only filtering - covered by
  `filter-search-and-failures-only.md`.
- Real-time SSE updates - covered by `realtime-sse-update.md`.

## Coverage

- FR-01: matrix renders.
- FR-02: slot exposes version + status + actor + time + run link.
- FR-03: current + last-successful split rendered when applicable.
- Mockup: "Web Dashboard (MVP) - Visual layout" six-state table.
