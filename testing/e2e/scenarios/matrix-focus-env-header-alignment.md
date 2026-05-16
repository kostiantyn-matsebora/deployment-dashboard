# Matrix Focus: env-header columns align with expanded + collapsed deployment columns

**Intent:** in Matrix layout with Focus view, expanding a row grows
each of its cells from `--leaf-width` to `--leaf-width-expanded`
(200 px). A user reported that, after expand, the env-header strip
above the matrix no longer aligned with the widened deployment
columns in the expanded row — the headers stayed at `--leaf-width`,
giving the impression the columns had drifted.

The frontend is fixing the issue structurally (the env-header strip
must reflow when ANY row is expanded — either by widening to the
expanded width OR by anchoring per-row local headers). This scenario
codifies the invariant so a future regression of the same shape fails
LOUDLY.

## Citations

- `docs/ui-compact-options.md` "Focus view specifics" — `--leaf-width-expanded`
  semantics.
- `docs/deployment-dashboard.html` — matrix Focus layout uses
  `:style="--leaf-width: ${leafWidthForView}; --leaf-width-expanded: 200px"`
  and binds each box's width conditionally on `expanded[service.id]`.
- `docs/deployment-dashboard-architecture.md` §4 FR-12, §7 "Visual
  layout".

## Preconditions

- Stack up, fixtures seeded via `testing/scripts/seed.ps1`.
- At least two services in the filtered view (the canonical 6-state
  corpus provides ≥ 4 — always satisfiable).
- `localStorage` cleared at the start of every test.

## Steps

1. **Given** the SPA on Layout=Matrix, View=Focus, no rows expanded,
2. **When** the test reads the env-header strip's per-env cells
   (the `.text-center` cells with inline `width: var(--leaf-width)`
   that sit above the matrix rows, NOT nested in any
   `[data-service-row]`),
3. **And** reads the deployment-cell rects in the first filtered
   service's row (still collapsed) — by index in the env order,
4. **Then** for each env, the header cell's `left` and `right` edges
   match the deployment cell's `left` and `right` edges within 1 px.
5. **When** the test expands the first filtered service (click its
   `[data-testid^="row-chevron-"]`),
6. **And** re-reads the env-header strip's per-env cells,
7. **And** reads the deployment-cell rects in the expanded row,
8. **Then** the same alignment assertion holds (headers must reflow
   to match `--leaf-width-expanded`).
9. **And** the alignment assertion ALSO still holds for a row that
   remained collapsed (the second filtered service) — so the headers
   are correctly aligned with BOTH the expanded AND the collapsed
   rows simultaneously.

## Expected results (observable)

| # | Observable |
|---|---|
| 1 | Pre-expand: env-header `left`/`right` match collapsed-row deployment `left`/`right` (within 1 px) for every env. |
| 2 | Post-expand: env-header `left`/`right` match the expanded row's deployment cells (within 1 px). |
| 3 | Post-expand: env-header `left`/`right` ALSO match the collapsed row's deployment cells (within 1 px) — both rows are aligned with the same header strip. |
| 4 | If the env-header stays at `--leaf-width` while the expanded row is at `--leaf-width-expanded`, assertion #2 fails with a message naming the env index, the header and box rects, and the dLeft/dRight deltas. |

## Out of scope

- Animation / transition timing during expand. The assertion runs
  after two paint frames so the layout has settled; animation
  duration is a frontend craft choice.
- Other (view, layout) combinations. The Matrix × Focus combination
  is the only one where `--leaf-width-expanded` exists; Swim-lane
  Focus uses a different vertical-grow model and Workflow-rows
  expansion shows additional rows rather than widening cells.
- Per-cell colour / border treatments — purely geometric oracle.

## Coverage

- `docs/ui-compact-options.md` "Focus view specifics" —
  `--leaf-width-expanded` semantics.
- Defect history: user-reported matrix Focus expand-header
  misalignment.
