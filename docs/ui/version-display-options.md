# Version display options — design note

Three Phase 2 mockups exploring how to give the `version` attribute the room it needs without breaking the canonical's geometric or behavioural contracts.

## Problem

> **TODO Item 1 — Version-width UX.** The `version` attribute truncates in Detailed, Compact, and Focus-collapsed leaves; meanwhile horizontal whitespace sits unused at typical (≤ 10-env) layouts.

Today every leaf renders `version` inside a fixed `--leaf-width` slot sized for the worst case (15-env Compact at 1440 px). At more typical fixtures the leaf has 40–80 px of slack that the version string could legitimately consume; instead the string is ellipsised mid-SHA. The full string survives in the drawer and the tooltip, but the at-a-glance signal is lost — and the user's first instinct ("just make the box wider") is correct.

## Three options

**Option A — fluid clamp.** Widen `--leaf-width` via `clamp(min, viewport-derived ideal, max)` so leaves grow when the env-count is small (threshold 10, cap 240 px). Pure CSS, zero per-box height impact, zero JS, zero new invariants. Win condition — small/medium catalogues see the full version string at no cost; large catalogues fall back to today's behaviour unchanged. See [`deployment-dashboard-version-A-fluid.html`](./deployment-dashboard-version-A-fluid.html). Diff: +117 lines.

**Option B — version stacking.** Move `version` to its own line inside the leaf body, so the string wraps vertically instead of horizontally. Per-box height grows on demand (precedent: in-progress + prev-failed leaves are already taller). Win condition — version is always fully readable regardless of viewport or env-count, at the cost of an extra row per leaf when the version is long. See [`deployment-dashboard-version-B-stacking.html`](./deployment-dashboard-version-B-stacking.html). Diff: +68 lines.

**Option C — hybrid (A + B).** Apply A's clamp (threshold 10, cap 200 px) AND B's stacking fallback. The leaf first grows horizontally up to the cap; if the version still overflows, it wraps to a second line. Win condition — version is always fully readable AND wasted horizontal space is reclaimed. Diff is the union of A + B. See [`deployment-dashboard-version-C-hybrid.html`](./deployment-dashboard-version-C-hybrid.html). Diff: +162 lines.

## Pros / cons

| Option | Cost (lines) | Reach | Visual disturbance | Vertical growth | Harness re-author | NFR-09 impact |
|---|---|---|---|---|---|---|
| **A — fluid clamp** | +117 | Detailed + Compact + Focus-collapsed; all 3 layouts | Low — boxes grow uniformly on small catalogues | None | Low — width assertions parameterised on viewport (1–2 spec lines) | None — pure CSS within existing `--leaf-width` plumbing |
| **B — stacking** | +68 | Detailed + Compact + Focus-collapsed; all 3 layouts | Medium — leaves grow taller when version is long | Per-box (existing precedent) | Medium — height assertions need a "natural-height" variant for long-version rows | None — per-box natural height already canonical |
| **C — hybrid** | +162 | Same as A + B | Medium — A's growth + B's fallback when A's cap is exceeded | Per-box (only when version exceeds clamped width) | Medium — A's width + B's height assertions both apply | None — both A's and B's footprints are zero |

## Cross-cutting considerations

- **Glance view** — untouched in all 3 options. Glance renders one status pill per env with at most one attribute; `version` is not a Glance attribute by default, and the pill geometry is unrelated to `--leaf-width`.
- **Focus-expanded** — verified at 200 px in A (the Focus-expanded leaf renderer already uses `--leaf-width-expanded`, which A treats as the clamp ceiling). B and C inherit this — when a Focus row expands, the Detailed renderer takes over and the long-version stacking case becomes a non-issue (200 px easily fits the full string on one line).
- **6 box-state contract** — preserved verbatim in all 3 options. Status colour, `⚠ prev. failed` badge, last-successful split section, dashed divider, in-progress pulse — all rendered by the same templates; none of the options touches the state machine or its visual treatment.
- **Tooltip-on-truncate fallback** — A adds `title="<full version>"` at all 7 version sites (Detailed-current, Detailed-last-successful, Compact-current, Compact-last-successful, Focus-collapsed-current, Focus-collapsed-last-successful, drawer-history) as a defence-in-depth measure for the > 240 px edge case. B keeps the same tooltip as a fallback when the version is so long it still wraps awkwardly. C inherits B's approach (and thus A's by transitivity).

## NFR-09 footprint

- **A** — no new invariant; pure width-fluid CSS within existing `--leaf-width` plumbing. The shared `--leaf-width` CSS variable already carries every leaf's width budget; changing its expression from a literal to a `clamp()` is a value swap, not a structural change. Connector reflow (`recomputeEdges` / `recomputeConnectorTops`) continues to read MEASURED rects — unaffected by construction.
- **B** — no new invariant; per-box natural height is already permitted by the canonical (precedent: in-progress + prev-failed leaves render taller than success leaves in the same row; the row's grid auto-sizes). No grid-template change; no connector-anchor change.
- **C** — same as A + B combined; no new invariant. Both deltas are footprint-zero individually, and they compose cleanly because they touch orthogonal axes (width vs. height).

## Recommended default

**Option C — hybrid.** It is the strictly-dominant option on the "version is always fully readable" axis while reclaiming horizontal slack on small catalogues. Its cost (+162 lines) and harness burden (A's width + B's height assertions) are modest given that NFR-09 footprint is zero and Glance / Focus-expanded / the 6-state contract are all untouched. Option C's mockup also exposes the tradeoffs most cleanly — the three flagged observations (clamp ceiling = Focus-expanded width, stacking fallback only triggers above the cap, tooltip is defence-in-depth at all 7 sites) read directly off the rendered output, which makes Phase 3 user review faster.

## Demo-ability caveat

A's clamp floors at the shipped 9-env / 1440px viewport — at that combination the clamp's lower bound is binding and the leaves render at the same width as today's canonical. To see A's growth, open the mockup at ≥ 1800 px viewport OR substitute a smaller fixture (≤ 7 envs). C inherits this caveat. B's growth is viewport-independent and visible at the shipped fixture. Worth flagging so the reviewer knows where to look when opening each file.

## Status

Phase 2 design proposal. Phase 3 user pick pending. Phase 4 (canonical merge + SPA implementation) waits on user pick.
