---
title: Env-Axis Alignment Options
parent: "UI Options"
nav_order: 6
---

# Env-axis alignment across layouts — design note (issue #23)

The canonical mockup `./deployment-dashboard.html` is the single source of truth for the dashboard's visual + interactive contract. Issue [#23](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/23) flags that the two MVP layouts (Swim-lane and Workflow-rows) treat the env-axis inconsistently:

- **Swim-lane** lays each service's envs into `depthBuckets()` columns derived from `topology.edges`. Columns are *local to the service-row*; two services with different topologies end up with deployment cells under unrelated x-positions even when env names overlap.
- **Workflow-rows** lays each root-to-leaf path as its own row inside the service block. Cells across workflow rows of the *same* service are positioned by *path index*, not by env identity; cells across *different* services are positioned by their own paths. Same env name renders at a different x-offset on every row.

Net effect on PostHog-like data: same env name (`dev`, `preview-pr-45696`, `prod-us`) shows up at unrelated x-positions across rows and across layouts. The user reads "which env is this" by looking at the env-tag on each cell, never from column geography. The matrix layout had stable env columns and was deferred to Phase 2.0 — that deferral is what surfaced the problem.

## Acceptance criteria (from issue #23)

| # | Criterion |
|---|---|
| AC-1 | Same env name → same x-position in **both** Swim-lane and Workflow-rows |
| AC-2 | Empty cells render as visible placeholders (not omitted) when a row has no deployment for a column another row populates |
| AC-3 | `testing/mockup-visual/` covers the new column invariant |
| AC-4 | Visual regression pinned to a PostHog-like multi-workflow + multi-env fixture |

**Out of scope per issue body** (do not regress on these in any option):

- Env reordering by some semantic (alphabetical, deploy-flow-topological, etc.) — separate UX call.
- Ephemeral-env filtering (issue #17).
- Changing the row-grouping semantic of either layout (Swim-lane = one row per service, Workflow-rows = one row per workflow path).

## Three orthogonal axes (recap)

| Axis | Control | Effect | Touched by this proposal? |
|---|---|---|---|
| **View** | header segmented control | per-box density + which attributes appear | no |
| **Layout** | header segmented control | overall arrangement of services + envs | column-derivation rules change |
| **Theme** | header gear icon → popover | colour palette only — no semantic change | no |

The column-axis change is **structural** (where in the DOM the deployment cells land), not visual (no new palette, no new view, no new layout). The chevron / pin / Focus overlay remains untouched.

## The three options

| Option | Column source | Empty-cell rendering | Per-layout footprint |
|---|---|---|---|
| **A — Global env axis** | union of every populated env across every filtered service, ordered by API-supplied env order, then any topology-only envs appended | every row renders one cell per column; missing = `pill-empty` placeholder | shared `--env-axis` token written once on the layout root; both `swim-lane-layout` and `workflow-rows-layout` consume it |
| **B — Per-service env axis** | union of every env in *this service's* matrix slice and *this service's* topology edges, in API order then topology-only | every row in the same service block renders one cell per service-local column; missing = `pill-empty` | per-service grid (each `.svc-block` / `.lane-row` carries its own column count); no cross-service alignment |
| **C — Global axis + topology overlay** | Option A's global axis owns the columns; SVG / CSS connectors continue to anchor on box rects per workflow row, preserving the existing edge geometry | identical to A | as A, plus connector-recompute pass adapts to fixed-column geometry |

## Option comparison

### What's the same across all three

- Empty cells render as `pill-empty` placeholders (AC-2 satisfied identically).
- Env labels never reorder by anything semantic — API order is preserved, then any topology-only envs appended in iteration order.
- Row grouping is untouched — Swim-lane stays one row per service, Workflow-rows stays one row per path.
- `LayoutLeafComponent` is the only renderer for cell content; option choice does not change leaf DOM.
- The matrix layout (deferred) is unaffected. When re-enabled in Phase 2.0 it consumes the same column source.

### What differs

| Concern | A (global) | B (per-service) | C (global + overlay) |
|---|---|---|---|
| AC-1 cross-layout same-env-same-column | yes, fully | partially — cells line up within a service block only | yes, fully |
| AC-1 cross-service same-env-same-column | yes (within a layout) | no — each service has its own column set | yes (within a layout) |
| Cross-layout invariant (swim-lane row for service X aligns its `dev` column with workflow-rows row for service X) | yes (same global axis source) | no | yes |
| Visual density on services with few envs | wider rows (one cell per global env, mostly empty) | tight (no synthetic placeholders) | wider — same as A |
| Topology connector geometry (workflow-rows arrows, swim-lane SVG edges) | flat across columns — arrows draw between adjacent populated cells, may skip placeholders | unchanged — anchors per service-local column | global columns + overlay — connectors continue to anchor on populated cells; placeholders are visually neutral so arrow paths thread through them |
| Implementation footprint | new `globalEnvAxis()` computed signal on `DeploymentMatrixStore`; both layouts read it; depthBuckets-by-service unused for column placement (still used for connector grouping in C) | small — change `collectEnvIds` / `depthBuckets` to project onto a union-of-current-rows | medium-large — A plus a separate per-service connector-anchor recompute that survives the global-axis flattening |
| NFR-09 reflow risk | low — grid template is one CSS variable shared by all rows; `ResizeObserver` already covers reflow | low — current per-service grid is preserved | medium — needs new path-vs-column reconciliation in `recomputeConnectorTops` |
| User mental model | "envs are columns; rows tell me workflow vs service" — matches matrix-style mental model | "each service is its own little grid" — fragmented; no cross-row reading | "envs are columns AND workflows are arrows" — preserves both signals |
| Risk of placeholder confusion | medium — many empty cells if env axis is wide; user must learn `—` = no deployment for that env in this service | low — empty cells only when a workflow path skips an env this service deploys to | medium — same as A |
| PostHog fixture row width | wide (union of 20+ envs across all services) | narrow per service | wide |

## Tradeoff summary

| Question | Answer A | Answer B | Answer C |
|---|---|---|---|
| Solves AC-1 (issue invariant)? | yes | no (regression — same-env-different-x persists across services) | yes |
| Preserves existing connector behaviour? | partial — arrows skip placeholders | yes | yes |
| Cheapest to implement? | yes | yes | no |
| Best for wide-fan-out projects (PostHog)? | so-so — many placeholders per row | yes (rows stay tight) | so-so — many placeholders, but connectors still meaningful |
| Best mental model match for the issue's stated expected behaviour? | yes ("same env name → same column position regardless of which mode is active") | no | yes |

## Recommendation

The issue states the invariant explicitly: *"same environment name → same column position, regardless of which mode is active and regardless of which workflow row the deployment came from"*. That language only resolves under **Option A or Option C**. Option B is what we have today (per-service columns) and would not satisfy AC-1 as written.

Between A and C:

- **A** is cheaper and cleaner; arrows simply skip over `pill-empty` columns and the cell-axis is the only column source.
- **C** preserves the existing topology-aware connector geometry exactly but adds a recompute pass to reconcile fixed columns with per-workflow paths.

For an MVP-stage internal tool with low-complexity arrow geometry, **A is the simpler win**. The connector "skip empty columns" rule is unambiguous (anchor on next populated cell to the right, same row) and `recomputeConnectorTops` already operates on measured box rects rather than column indices, so the change there is small.

## Implementation footprint per option

### Option A — minimal surface area

| Surface | Change |
|---|---|
| `frontend/shared/src/lib/deployment-matrix.store.ts` | New computed signal `globalEnvAxis(): readonly string[]` — union of `envs()` order plus any service.topology env-id not already in `envs()`, deduplicated, API order preserved. |
| `frontend/dashboard/src/app/topology-utils.ts` | New helper `projectOntoAxis(axis, populatedEnvIds)`: returns `{ envId, populated: boolean }[]` for one row. |
| `frontend/dashboard/src/app/swim-lane-layout.component.ts` | `bucketsFor(service)` → `axisCellsFor(service)`. Drop `depthBuckets` usage for column placement; keep for connector grouping. Iterate over `globalEnvAxis()` and emit a `.leaf-pair` for each (cell or placeholder). |
| `frontend/dashboard/src/app/workflow-rows-layout.component.ts` | `path` (per-workflow env-id array) is projected onto `globalEnvAxis()`; populated cells render `<dd-layout-leaf>`, unpopulated render `<div class="leaf-pair leaf-empty"><span class="env-tag">…</span><div class="pill-empty">—</div></div>`. Path arrows still anchor on populated boxes (no change to `recomputeConnectorTops`). |
| `frontend/matrix/src/lib/layout-leaf.component.ts` | No change — placeholders render via the existing `slot == null` branch in the Compact + Glance leaves. |
| `docs/ui/deployment-dashboard.html` | Swim-lane `<template x-if>` and workflow-rows `<template x-if>` blocks reflow to iterate over `globalEnvAxis` rather than `depthBuckets()` / `path`. Head-comment NFR-09 block grows a new sibling invariant #8 — Env-axis is shared across layouts. |
| `testing/mockup-visual/mockup-invariants.spec.ts` | New invariant I12 — `env-header / cell column-x are equal across swim-lane and workflow-rows for same env name`. Posthog-style fixture added under `testing/mockup-visual/fixtures/` (AC-4). |
| `testing/e2e/tests/` | New spec `column-alignment-across-layouts.spec.ts` — load demo with PostHog fixture, toggle Swim-lane ↔ Workflow-rows, assert same-env x-position is stable to ± 1 px (AC-1, AC-3). |

### Option B — preserve per-service axis

Only `collectEnvIds` widens to include every env in the topology even if no slot is populated. AC-1 is **not** satisfied across services — recommended only if the user explicitly wants per-service density wins to trump the cross-service column invariant.

### Option C — global axis + connector overlay

Option A's changeset plus:

| Surface | Change |
|---|---|
| `frontend/dashboard/src/app/workflow-rows-layout.component.ts` `recomputeConnectorTops` | Source / target lookup walks the path's populated-cell sequence (skipping placeholder columns). Anchors come from box rects — already measured per cell — but the new `data-arrow-source` / `data-arrow-target` lookup needs to skip over placeholder `.leaf-pair` wrappers. |
| `frontend/dashboard/src/app/swim-lane-layout.component.ts` `recomputeAllEdges` | Same skipping rule for SVG edge anchors. |
| `testing/mockup-visual/mockup-invariants.spec.ts` | Strengthened I0 — connector anchors land on **populated** boxes regardless of intervening placeholders. |

## Persistence

None of the three options introduces new persistence keys. Column selection is derived from API data on every render; placeholders are emergent, not stored.

## NFR-09 preservation

All three options preserve NFR-09 by construction:

- **(a)** `.leaf-pair` grid template unchanged (`auto var(--leaf-width)`); placeholder cells use the same template, so the grid still cannot overlap.
- **(b)** Arrow geometry remains anchored to measured rects — placeholders are visually neutral and arrows continue to terminate on box rects (`recomputeConnectorTops` for workflow-rows; SVG `recomputeAllEdges` for swim-lane).
- **(c)** `ResizeObserver` + window-resize listener still cover indirect reflow; widening rows by adding placeholders triggers `ResizeObserver` on `[data-service-row]` exactly as the existing chain handles topology-mutation events.

One new sibling invariant lands with the chosen option (A or C):

- **#8 — Env-axis is shared across layouts.** Same env name → same x-position across Swim-lane row for any service AND Workflow-rows row for any service (within a single layout, same viewport, same view). Encoded in the mockup head-comment block and in `testing/mockup-visual/mockup-invariants.spec.ts` (new invariant id I12).

## FR / NFR pointers

Env-axis alignment is a layout-structural change — no new wire shape, no new data class.

- **Unchanged.** FR-03 (six box states — empty placeholder is the seventh empty/no-slot state and already supported by `LayoutLeafComponent`), FR-04 (drawer — clicks on placeholders do nothing per the `slot == null` guard), FR-07 (filters — column axis is derived from the *current filtered* service set, so filtering hides empties caused by services that no longer render), FR-08 (live updates — column axis recomputes on every API delta).
- **Slight extension.** FR-13 (layout switcher — column axis is now layout-derived rather than topology-derived).

## Open questions for the user (answer before Phase 4)

1. **Option choice.** A (recommended), B (no AC-1 across services), or C (preserves topology connector exactness)?
2. **Cross-service vs cross-layout axis scope.** Should the global axis include envs from services hidden by the current filter? Recommended **no** — recompute per filtered set so the row width tracks visible services.
3. **Empty-cell affordance.** `pill-empty` already shows `—`. Confirm we keep that visual; no separate `data-state="placeholder"` (cells with `slot == null` already mark `data-state="empty"`).
