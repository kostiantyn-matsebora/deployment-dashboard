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
the block. The two variant HTMLs use the same five-row, three-deep
`posthog` fixture (`DEV`/`STAGING`/`PROD-CA`,
`PREVIEW-PR-45696`/`PREVIEW-VERIFY-LATEST`/`PREVIEW-FINAL`,
`PROD-US`/`PROD-EU`/`PROD-APAC-SINGAPORE`,
`PYPI-HOGQL-PARSER`/`PYPI-CDN`/`PYPI-MIRROR-WORLDWIDE`,
`PYPI-HOGQL-PARSER-RS`/`PYPI-CDN-RS`/`PYPI-MIRROR-RS`) with
deliberately varied lengths at each path position. In that fixture:

- Variant A reserves 131 / 132 / 145 px at positions 0 / 1 / 2 —
  each column hugs its own widest label's text width.
- Variant B reserves a uniform 145 px at every position — the
  widest label anywhere in the block.

The position-2 column is where the trade-off is most obvious:
Variant A's 132 px at position 1 is tight to `PREVIEW-VERIFY-LATEST`
while Variant B inflates positions 0 and 1 to 145 px (the block-
widest's width), paying ~14 extra px per row at those positions for
no in-position gain. The pattern recurs whenever a service has a
short widest label at one position and a longer widest label at
another.

Defer the final pick to the user; both variants satisfy the
invariant and either is acceptable for SPA implementation.

## Parent-box -> widest-env-tag distance (uniform-arrow-channel)

A secondary invariant followed by both variants: at any position
N >= 1, the distance from the parent-box right edge (row R's
deployment box at position N-1) to the WIDEST env-tag's text-left
edge at position N should equal the arrow channel (the
`.arrow-gap` width, ~25 px after the flex container's edge math),
**uniformly across all positions in the variant where the variant's
contract allows it**.

This is achieved by sizing each column reservation to hug its own
widest text exactly (ceil + 1 px for subpixel safety), so the
slack between text-left and column-left on the widest row at each
position is ~1 px. With `text-align: right` preserved (env-tag
snug to its own box, canonical reading), the arrow channel becomes
the only horizontal whitespace between parent-box and
widest-next-env-text.

**Variant A** satisfies this for every position in the block
(per-position reservation hugs per-position widest text).
**Variant B** can only satisfy this for the position whose widest
text happens to equal the block-widest text; every OTHER position
pays asymmetric slack equal to `(block-widest minus
this-position's-widest)`, landing on the LEFT side of the
right-aligned label. Measurements at 1600 × 1200:

| Variant | Position | Widest row | parent-box-right -> widest-env-text-left |
|---|---|---|---|
| A | 1 | PREVIEW-VERIFY-LATEST | ~26 px (= arrow channel) |
| A | 2 | PYPI-MIRROR-WORLDWIDE | ~26 px (= arrow channel) |
| B | 1 | PREVIEW-VERIFY-LATEST | ~39 px (= arrow channel + 14 px Variant-B slack) |
| B | 2 | PYPI-MIRROR-WORLDWIDE | ~26 px (= arrow channel, position is block-widest) |

(Non-widest rows at each position pay the same right-aligned
column slack as before — that's intrinsic to the
positional-reservation pattern and accepted as the cost of the
"env-tag labels its box" reading.)

The canonical mockup `docs/ui/deployment-dashboard.html` does NOT
yet apply this normalization (its workflow-rows still uses the
per-row `auto` grid that issue #23 fixes); the chosen variant's
column-reservation rule should land in the canonical at Phase 4
together with the SPA fix.

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
