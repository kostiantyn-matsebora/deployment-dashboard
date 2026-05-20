---
title: Env-Tag Column Alignment Options
parent: "UI Options"
nav_order: 6
---

# Env-tag column alignment in workflow-rows — design note

The canonical mockup `./deployment-dashboard.html` is the single source
of truth for the dashboard's visual + interactive contract. Issue #23
identified a positional-alignment bug in the **workflow-rows** layout
that this note proposes two variants for. The chosen variant will be
merged into the canonical mockup and into the SPA together at Phase 4.

## The bug

In workflow-rows mode, each env cell in a workflow path is wrapped in
its own `.leaf-pair` CSS Grid:

> `frontend/dashboard/src/app/workflow-rows-layout.component.ts:236-251`
> wraps each env cell in a `.leaf-pair`;
> `frontend/dashboard/src/styles.css:182-187` styles `.leaf-pair` as an
> independent grid with `grid-template-columns: auto var(--leaf-width)`.

Because each `.leaf-pair` is an **independent** CSS Grid, column 1
(the env-tag) sizes only to its own cell's content. Adjacent rows in
the same service block with different env-label widths end up with
different X positions for "the nth cell of the row". The canonical
mockup `docs/ui/deployment-dashboard.html:1908-1927` carries the same
bug.

Swim-lane mode looks correct only because it has one row per service
AND it groups leaf-pairs by **topological depth-slot** — every
leaf-pair at depth N shares the same CSS Grid via `.depth-slot`. The
fix below extends that grouping idea to workflow-rows.

## The invariant

**Within each service's workflow-row group, the nth deployment cell in
adjacent rows must share the same X grid, regardless of how long any
env label happens to be.**

Scope is **per-service only** — no cross-service alignment (services
keep their own service-name column, by the existing
`--svc-name-col-width` directive).

## Variants

| Variant | Column-1 width | Plumbing | Horizontal density |
|---|---|---|---|
| [**A — per-position width**](./env-tag-column-alignment-variant-a.html) | One width per path-position index, equal to the widest env-tag at that exact position across the block. | One CSS variable per position (`--env-tag-col-{idx}-width`); template / directive walks the path indices. | Minimum that satisfies the invariant. |
| [**B — shared-max width**](./env-tag-column-alignment-variant-b.html) | A single width per service block, equal to the widest env-tag anywhere in the block. | One CSS variable per block (`--env-tag-col-width`); no position-index plumbing. | Wider — every position pays the cost of the longest env-tag anywhere in the block. |

Open either HTML file in a browser to compare BEFORE (today's bug) and
AFTER (variant's fix) on the same `posthog` fixture used in the
issue's bug-report screenshots.

## Recommendation — Variant A

Variant A is the cleanest match to the invariant: column-1 widths are
the **minimum** that the invariant allows. The position-index plumbing
is one directive (a `ResizeObserver` per `.svc-block` that walks each
position's set of env-tag widths and writes one custom property per
position) — a single, well-scoped piece of code that the existing
`SvcNameColumnWidthDirective` provides a close template for.

Variant B is simpler (one number per block, no position bookkeeping)
but every position pays the cost of the longest env-tag anywhere in
the block. For services like `posthog` (`PYPI-HOGQL-PARSER-RS` at
position 0 alongside a `PROD-EU` at position 1), Variant B inflates
column-1 at position 1 from ~50 px to ~132 px on every row that
reaches position 1 — a visible loss of horizontal density that
recurs whenever a service has a long label early in the path and
short labels later.

Defer the final pick to the user; both variants satisfy the
invariant and either is acceptable for SPA implementation.

## NFR-09 preservation (both variants)

- **(a)** `.leaf-pair` cells remain in CSS Grid; column-1 and column-2
  cannot overlap by construction. The only change is **how** column-1's
  width is computed (per-position-max or per-block-max instead of
  per-cell-auto).
- **(b)** Arrow anchors continue to attach to MEASURED stage-box rects
  via `recomputeConnectorTops`. Wider column-1 reflows the rect; the
  recompute already keys off measured positions, so the arrow geometry
  reflows automatically.
- **(c)** The new per-service `ResizeObserver` is mounted on
  `.svc-block` (re-attached on layout / search / filter / expanded
  change, mirroring the existing service-name-column directive). The
  custom-property write is idempotent and ResizeObserver-debounced.

NFR-09 reflow invariant is preserved at every viewport the
mockup-visual suite covers (both variants reflow without overlap by
construction — column-1 widens, column-2 keeps its `--leaf-width`,
the row's flex container shrinks the rightmost gap as needed).

## Status

Design note. The two variant HTMLs are mockup artefacts for the
Phase 2 design-review cycle, not the SPA fix. After the user picks a
variant, Phase 4 merges that variant into the canonical mockup
`docs/ui/deployment-dashboard.html` AND into the SPA
(`frontend/dashboard/src/app/workflow-rows-layout.component.ts` +
`frontend/dashboard/src/styles.css` + a new
`EnvTagColumnWidthDirective`). The other variant's HTML may be
deleted at that point or kept as a reference; this design note is
preserved as audit trail.
