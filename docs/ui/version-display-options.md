# Version display options — design note

Phase 2 mockup exploring how to give the `version` attribute the room it needs without breaking the canonical's geometric or behavioural contracts.

## Problem

> **TODO Item 1 — Version-width UX.** The `version` attribute truncates in Detailed, Compact, and Focus-collapsed leaves; meanwhile horizontal whitespace sits unused at typical (≤ 10-env) layouts.

Today every leaf renders `version` inside a fixed `--leaf-width` slot sized for the worst case (15-env Compact at 1440 px). At more typical fixtures the leaf has 40–80 px of slack that the version string could legitimately consume; instead the string is ellipsised mid-SHA. The full string survives in the drawer and the tooltip, but the at-a-glance signal is lost — and the user's first instinct ("just make the box wider") is correct.

## Option C — hybrid (selected, merged into canonical)

**Option C — hybrid (fluid clamp + version stacking).** Combines a fluid `clamp(min, viewport-derived ideal, max)` on `--leaf-width` (threshold 10, cap 200 px) with a stacking fallback that moves `version` to its own line inside the leaf body. The leaf first grows horizontally up to the cap; if the version still overflows, it wraps to a second line. Win condition — version is always fully readable AND wasted horizontal space is reclaimed. Per-box height grows on demand (precedent: in-progress + prev-failed leaves are already taller). Diff: +162 lines. **Merged into the canonical mockup ([`deployment-dashboard.html`](./deployment-dashboard.html)) in Phase 4a; the standalone `deployment-dashboard-version-C-hybrid.html` fork has been deleted.**

Two earlier alternatives — Option A (fluid clamp only) and Option B (stacking only) — were considered and deleted from the design corpus after the user picked Option C. The hybrid is the strictly-dominant option on the "version is always fully readable" axis while reclaiming horizontal slack on small catalogues.

## Pros / cons (Option C)

| Aspect | Detail |
|---|---|
| Cost (lines) | +162 |
| Reach | Detailed + Compact + Focus-collapsed; Swim-lane + Workflow-rows |
| Visual disturbance | Medium — clamp-driven growth + stacking fallback when the cap is exceeded |
| Vertical growth | Per-box (only when version exceeds clamped width) |
| Harness re-author | Medium — width assertions parameterised on viewport + height assertions for long-version rows |
| NFR-09 impact | None — both width-fluid and height-natural footprints are zero |

## Cross-cutting considerations

- **Glance view** — untouched. Glance renders one status pill per env with at most one attribute; `version` is not a Glance attribute by default, and the pill geometry is unrelated to `--leaf-width`.
- **Focus-expanded** — the Focus-expanded leaf renderer already uses `--leaf-width-expanded` (200 px), which is also Option C's clamp ceiling. When a Focus row expands, the Detailed renderer takes over and the long-version stacking case becomes a non-issue (200 px easily fits the full string on one line).
- **6 box-state contract** — preserved verbatim. Status colour, `⚠ prev. failed` badge, last-successful split section, dashed divider, in-progress pulse — all rendered by the same templates; the state machine and its visual treatment are untouched.
- **Tooltip-on-truncate fallback** — `title="<full version>"` at all 7 version sites (Detailed-current, Detailed-last-successful, Compact-current, Compact-last-successful, Focus-collapsed-current, Focus-collapsed-last-successful, drawer-history) as defence-in-depth when the version still wraps awkwardly.

## NFR-09 footprint

No new invariant. The shared `--leaf-width` CSS variable already carries every leaf's width budget; changing its expression from a literal to a `clamp()` is a value swap, not a structural change. Per-box natural height is already permitted by the canonical (precedent: in-progress + prev-failed leaves render taller than success leaves in the same row; the row's grid auto-sizes). No grid-template change; no connector-anchor change. Connector reflow (`recomputeEdges` / `recomputeConnectorTops`) continues to read MEASURED rects — unaffected by construction. Both deltas compose cleanly because they touch orthogonal axes (width vs. height).

## Demo-ability caveat

The clamp floors at the shipped 9-env / 1440px viewport — at that combination the clamp's lower bound is binding and the leaves render at the same width as today's canonical. To see horizontal growth, open the mockup at ≥ 1800 px viewport OR substitute a smaller fixture (≤ 7 envs). The stacking fallback is viewport-independent and visible at the shipped fixture whenever a version exceeds the clamped width. Worth flagging so the reviewer knows where to look when opening the file.

## Status

- Phase 2 design proposal — Option C selected, Options A and B deleted from the corpus.
- **Matrix layout removed from MVP; deferred to Phase 2.0.** Option C scope reduced to Swim-lane + Workflow-rows (the two MVP layouts). The canonical mockup no longer contains any `layout === 'matrix'` template blocks, matrix-only CSS (`.matrix-center`, `.arrow-col`, `.arrow-w-*`, `.arrow-line.arrow-line-dashed`), or the Matrix entry in the layout switcher / LAYOUTS const. The localStorage default flips from `'matrix'` to `'swim-lane'`.
- **Phase 4a (canonical merge) complete.** Option C surface — pill / .node / .wf-stage `min-width` + `max-content` + `max-width: 480px`; `.lane-grid` depth columns sized `max-content` with `clamp()` column-gap; `.leaf-pair` column 2 sized `max-content`; new `.version-block` + `.status-row-b` block-level version row in Detailed + Compact + Focus-collapsed; drawer CURRENT DEPLOYMENT + Last successful rows restructured (badge/run row 1, full-width version row 2 with `overflow-wrap: anywhere`); drawer history `entry.version` flipped to `break-all`; `payments-edge` stress-row added to the fixture; dark-mode overlays for `.version-block` and `.drawer-version-row`. The standalone fork has been deleted.
