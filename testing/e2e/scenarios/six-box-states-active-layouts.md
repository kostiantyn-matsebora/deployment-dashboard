# Six Box States — Active Layouts (swim-lane)

## Title + intent

Assert that all six canonical box states render correctly in the currently active swim-lane layout, using the seeded fixture corpus.

## Citations

- `docs/architecture.md` §4 FR-01 (deployment event ingestion), §7 "6 box states" (canonical state enumeration + semantic contract)
- `docs/features.md` § Box states (table of six states, visual descriptions)
- `docs/ui/mockups/deployment-dashboard.html` (binary visual contract; the six `data-state` tokens are the machine-readable counterpart)
- `testing/e2e/scenarios/deferred-phase-2.0/matrix-six-box-states.md` (sibling scenario covering the same corpus under the deferred Matrix layout)
- `testing/fixtures/seed-data.json` (the six fixture slots — one per canonical state)

## Preconditions

- Stack running at `DASHBOARD_READ_BASE_URL`.
- Canonical seed corpus loaded via `testing/scripts/seed.ps1` (the standard pre-suite step in `testing/e2e/run-tests.ps1`).
- The following six fixture slots exist in the database and expose the six canonical box states:

| service | environment | expected `data-state` |
|---|---|---|
| service-b | dev | `success` |
| service-a | dev | `running-with-last` |
| service-c | dev | `running-prev-failed-with-last` |
| service-b | qa | `failed-with-last` |
| service-d | uat | `running` |
| service-d | dev | `running-prev-failed` |

## Steps

1. **Given** the browser navigates to `/` with `localStorage` cleared.
2. **Given** the swim-lane layout is the default (no layout switch required).
3. **When** the matrix is visible.
4. **Then** for each of the six fixture slots, assert:
   a. The stage box is visible (`data-testid="stage-box-{service}-{env}"`).
   b. The box carries `data-state` equal to the expected token.
   c. At least one Tailwind colour-family token is present on the element matching the expected colour bucket (green / red / orange).
   d. `last-successful-section` is present when the state includes a last-successful split, absent otherwise.
   e. `prev-failed-badge` is present when the state includes a previous-failed indicator, absent otherwise.
   f. The current-version anchor (`data-testid="current-version-{service}-{env}"`) shows the expected version from the fixture.

## Expected results

| State | `data-state` | Colour bucket | last-successful-section | prev-failed-badge | version |
|---|---|---|---|---|---|
| Success | `success` | green | absent | absent | v2.3.0 |
| Running + Last Successful | `running-with-last` | orange | present | absent | v2.3.2 |
| Running + Failed + Last Successful | `running-prev-failed-with-last` | orange | present | present | v3.1.2 |
| Failed + Last Successful | `failed-with-last` | red | present | absent | v1.7.9 |
| Running | `running` | orange | absent | absent | v4.0.4 |
| Running + Failed | `running-prev-failed` | orange | absent | present | v4.0.3 |

Colour-family tokens are per `frontend/matrix/src/lib/box-styles.ts`: green = `bg-green-50` / `border-green-300`; red = `bg-red-50` / `border-red-300`; orange = `bg-orange-50` / `border-orange-400` / `in-progress-box`.

## Out of scope

- Matrix layout (deferred Phase 2.0 — see `testing/e2e/scenarios/deferred-phase-2.0/matrix-six-box-states.md`).
- Workflow-rows layout — swim-lane is sufficient to satisfy the AC; the state tokens are layout-agnostic.
- Dark-palette variant — covered by `testing/e2e/scenarios/theme-box-state-contract-under-dark.md`.
- Pixel-level visual comparison — covered by `testing/e2e/spa-visual-invariants.spec.ts`.

## Coverage footer

- FR-01: deployment event ingestion → matrix state derivation
- FR-12: view/layout combinations (swim-lane is the active default layout)
- `docs/features.md` § Box states — six canonical states, each with a spec row
- NFR-QA-01: feature-coverage completeness gate
