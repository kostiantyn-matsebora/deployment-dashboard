---
title: Rate-Limit Cluster Options
parent: "UI Options"
nav_order: 7
---

# Rate-limit cluster — design note

Phase 2b mockup proposal for the right-aligned rate-limit usage cluster
introduced by [CR-0011](../cr/CR-0011-fetcher-rate-limit-governance.md)
§ 3d. The canonical mockup `./deployment-dashboard.html` ships the
chosen variant per the mockup-before-implementation rule (CR-0011 § 3e);
this note records the chosen visual form, the `highlight-hint`
reconciliation strategy, collapse threshold, per-source-id rollup,
severity-band tokens, and stale-affordance.

## SA-locked constraints (verbatim from CR-0011 + ADR-0008)

| # | Constraint | Source |
|---|---|---|
| 1 | Right-aligned (`ml-auto`); sibling to the existing left-aligned Services / Failures / Last deploy / Never-reached-PROD cluster. | CR-0011 § 3d |
| 2 | Severity bands at 0–60% (green) / 60–85% (amber) / >85% (red) of `upstream_used / upstream_limit`. Ordering + thresholds locked at the CR; **colour tokens are Theme-axis output** (compose with CR-0006). | CR-0011 § 3d |
| 3 | Stale-affordance fires when `now - received_at > 2 × poll_interval`. MVP hard-codes `poll_interval = 60 s` (CR-0011 § 3d footnote). | CR-0011 § 3d |
| 4 | **NFR-09 reflow invariant — strict.** No overlap with the left cluster at any viewport / service-count combo already covered by `testing/mockup-visual/`. Cluster collapses when slack is insufficient (threshold = mockup-proposal output, locked below). | CR-0011 § 3d + SAD §5 NFR-09 |
| 5 | Reporting is per-`(adapter_id, source_id)` even when multiple rows share one PAT (shared budget visible as same `self_imposed_cap` on every row). Cap is per upstream token = per adapter (MVP). | ADR-0008 Decision 3 |
| 6 | `upstream_used` is `upstream_limit - upstream_remaining` — counts *every* consumer of the PAT, not just this fetcher. Operator-facing wording reflects "PAT used", not "fetcher used". | ADR-0008 Decision 4 |
| 7 | `highlight-hint` (the `ml-auto`-aligned "Showing all environments with <version>" line that fires on version hover) must reconcile with the cluster; three candidate strategies given, no preference locked at CR level. | CR-0011 § 3d |
| 8 | Cluster fades / shows "—" on stale; final visual is mockup-proposal output. | CR-0011 § 3d |
| 9 | The cluster is a "now gauge" only — no time-series, no history. | issue #28 + ADR-0008 Decision 2 |

## Chosen variant — at a glance

| Dimension | Choice |
|---|---|
| Visual form | **Percent primary + ratio in tooltip.** Inline text `42% used`; hover tooltip exposes `1,400 / 5,000 · resets 14:00 UTC`. |
| Per-source-id rollup | **Aggregated worst-band pill + N-source counter.** One coloured pill shows the worst band across snapshots; an adjacent `· 2 sources` counter opens a popover with per-`(adapter, source_id)` rows when clicked. |
| Collapse threshold | Collapse to a **single severity dot + percent** (no label, no counter) when (a) the strip has < 360 px horizontal slack to the right of the left cluster, OR (b) viewport < 1280 px. Full layout returns at ≥ 1280 px AND ≥ 360 px slack. |
| `highlight-hint` reconciliation | **Stack vertically — hint moves above the cluster row** (single line `mt-1` row that appears when `highlightedVersion != null`). Both keep their canonical right-aligned position. Vertical growth is ~14 px and only active during hover. |
| Stale affordance | **Dimmed (opacity 0.5) + neutral grey ring + the percent replaced with literal "—"**, label changes from `used` to italic `stale`. Tooltip exposes the last `received_at` ISO timestamp for debugging. |
| Empty (cold start / no fetcher) | Cluster hidden entirely (`x-show="usageSnapshots.length > 0"`). No empty-state pill on the strip — a missing fetcher is not a failure; it's the absence of an optional component. |

## Visual form — percent primary, ratio in tooltip

**Decision.** The strip carries `42% used` per row; hover exposes
`1,400 / 5,000 · resets 14:00 UTC` as a `title` tooltip on the pill
(matches the existing `title="<full version>"` tooltip-on-truncate
pattern across the seven version sites — version-display-options.md
§ Cross-cutting considerations).

**Trade-off table.**

| Option | Pro | Con |
|---|---|---|
| Percent only | Compact (~7 chars); fits collapsed mode; parsable at a glance per the SA gloss in CR-0011 Open trade-off (ii). | Loses absolute precision — `42% of 5000` and `42% of 100` look the same. |
| Ratio only | Carries absolute precision in-strip. | ~13 chars (`1,400 / 5,000`); breaks collapsed mode; competes with the four left-cluster figures for strip width — NFR-09 risk. |
| **Both inline** (`42% — 1,400 / 5,000`) | Both signals visible at rest. | ~22 chars × N sources is the worst case for NFR-09; pushes the cluster past the left cluster on the 1024 px viewport. Rejected. |
| **Percent + ratio-in-tooltip** (chosen) | Percent is the at-a-glance signal; ratio is one hover away for precision-seeking operators; collapsed mode renders cleanly. | Operators relying on precision must hover. Acceptable — issue #28's stated audience is "operators who need a gauge", not "auditors reconciling per-second budgets". |

## Per-source-id presentation — aggregated worst-band rollup

**Decision.** One pill per cluster shows the **worst band** across all
snapshots; an adjacent ` · N sources` counter opens a popover listing
per-`(adapter, source_id)` rows on click. Each popover row shows
`<adapter_id>/<source_id>` + its individual percent + its individual
band colour. Popover is right-anchored to the pill; closes on
outside-click + Escape (matches the theme popover pattern from
theme-options.md § Switcher affordance).

**Why aggregated, not per-row inline.**

| Option | Rejected because |
|---|---|
| Per-row inline (one pill per `(adapter, source_id)`) | Three GHA adapters × 3 source-ids = 9 inline pills; NFR-09 collision with the left cluster at any viewport ≤ 1440 px. Per-row visual is also misleading when rows share a PAT (ADR-0008 Decision 3) — same percent, same colour, three times. |
| Rotation (one pill, auto-cycle through sources) | Hides information until the cycle reaches the worst row; operator could miss a red band. Animation cost + accessibility (motion-sensitive users). |
| Vertical stack inside the cluster (one pill per row stacked) | Inflates strip height by `N × row-height` — breaks the strip's single-row contract every left-cluster invariant assumes. Defeats horizontal `ml-auto` semantics. |
| **Aggregated worst-band pill + counter + popover** (chosen) | Constant horizontal cost (one pill + one short counter, ~110 px). Honest signal at a glance (the worst band is what matters operationally). Full per-row detail one click away. Composes with collapsed mode (counter hides at < 360 px slack). |

**Worst-band aggregation rule.**

```
worstBand(snapshots) :=
  "red"    if ANY snapshot.upstream_used / snapshot.upstream_limit > 0.85
  "amber"  else if ANY snapshot ratio in [0.60, 0.85]
  "green"  else
```

The aggregated percent shown is the **maximum** of `upstream_used /
upstream_limit` across snapshots — matches the band semantics (the
band reads from the same max).

## Collapse threshold — measured slack, not viewport

**Decision.** Collapse fires on two conditions, OR-ed:

| Condition | Rationale |
|---|---|
| `stripSlackPx < 360` — measured as `stripWidth - leftClusterRect.right - 24px gutter` | The cluster's full layout (pill + counter + label) needs ~280 px; +80 px margin keeps it visually decoupled from the left cluster's right edge. |
| `viewport < 1280 px` | Hard floor — at 1024 px (NFR-09 minimum viewport) the left cluster itself can consume ~620 px before the strip starts wrapping. Collapsed mode at < 1280 px is a margin-of-safety floor. |

Collapsed mode renders just a coloured dot (`8 px` circle, severity
band) + the worst percent, no counter, no `used` label. Hover still
shows the full ratio tooltip. The popover trigger relocates to the
dot itself in collapsed mode.

**Measurement plumbing.** Reuses the existing `ResizeObserver` +
window-resize listener that already gates `recomputeEdges` (mockup
head-comment item c). One additional observer on the stats-strip
element; sets a `data-cluster-collapsed="true|false"` attribute on
the cluster wrapper; CSS reads the attribute. No new JS surface; the
observer wiring sits in `bootstrapPersistence` alongside the existing
`$watch('expanded', reflow)` pattern.

## `highlight-hint` reconciliation — stack vertically

**Decision.** The hint moves to a **second row above the cluster** when
`highlightedVersion != null`. The cluster stays put. Both render
right-aligned (`ml-auto` on the hint, the cluster keeps its existing
`ml-auto`). Strip height grows ~14 px during the hover only.

**Trade-off table.**

| Strategy | Pro | Con | Verdict |
|---|---|---|---|
| **Shift-on-hover** (cluster slides left when hint active) | Single-row strip preserved at all times. | Triggers a width recalculation on every version hover; NFR-09 reflow checks would need to assert "no overlap during hover transitions"; CSS transition timing interacts with `ResizeObserver` (potential thrash). The cluster moving on hover also hides the operationally relevant figure exactly when the user is engaged in version analysis. | Rejected. |
| **Replace** (hint takes the cluster's slot, cluster hides) | Zero geometry change; simplest implementation. | Hides live saturation data on hover. An operator hovering a version to "see where it landed" loses visibility of the PAT gauge — the two surfaces are independent concerns; replacing one with the other conflates them. | Rejected. |
| **Stack vertically — hint above the cluster** (chosen) | Both surfaces remain visible. No horizontal recalculation; only a `mt-1` row appears and disappears. Hint is a transient mode (≤ 200 ms hover transitions in practice); 14 px of strip vertical growth on hover is well below any other strip element's intrinsic height variation. | Strip becomes two-row during hover only. Acceptable — the precedent is the in-progress + prev-failed leaf already growing taller per row (version-display-options.md § Pros / cons). | **Selected.** |

**Geometry.** The hint absorbs the cluster's previous `ml-auto`
position (still the `text-xs text-gray-400 italic` styling from line
1344). The cluster's wrapper uses `ml-auto` on itself; the hint
renders inside the cluster's wrapper as a sibling `<div>` above the
pill+counter row, also right-aligned within the wrapper. Both stay
right-aligned and stack via a flex-column on the wrapper.

## Severity tokens

QA mockup-visual oracle (I12.c) reads this table declaratively to assert
the rendered pill's computed colour matches the band. Tokens are
**Tailwind utility classes** — no custom CSS variables are introduced;
dark-mode values come from the existing `[data-theme="dark"]` overlay
block in the mockup `<style>` (lines 920–1004) which already remaps
every utility in the Light column.

| Band | Threshold | CSS class (pill bg) | CSS class (pill text) | CSS class (dot) | Light dot value | Dark dot value |
|---|---|---|---|---|---|---|
| green   | `< 60%`              | `bg-green-100` | `text-green-700` | `bg-green-500` | `#22c55e` | `#86efac` |
| amber   | `60% – 85%`          | `bg-amber-100` | `text-amber-700` | `bg-amber-500` | `#f59e0b` | `#fcd34d` |
| red     | `> 85%`              | `bg-red-100`   | `text-red-700`   | `bg-red-500`   | `#ef4444` | `#fca5a5` |
| neutral | n/a — stale visual   | `bg-gray-100`  | `text-gray-500`  | `bg-gray-400`  | `#9ca3af` | `#9aa4ae` |

Stale fires when `now − received_at > 2 × poll_interval` (D6). MVP locks
`poll_interval = 60 s` per CR-0011 § 3d footnote — so the gate is 120 s.
The stale pill renders the neutral token PLUS `opacity-50` and replaces
the percent with literal `—` + italic `stale` (three orthogonal signals
per the table below in this doc).

The rendered cluster also exposes `data-severity="green|amber|red|neutral"`
+ `data-stale="true|false"` + `data-cluster-collapsed="true|false"` on
the cluster root (`data-testid="rate-limit-cluster"`) so the oracle can
assert without re-deriving the band from the snapshot data.

## Severity-band colour tokens — light + dark

Composes with the Theme axis (CR-0006); pills use Tailwind utility
classes for the light palette and the existing dark-mode overlay
(`[data-theme="dark"] .bg-amber-100`, etc.) for the dark palette.

| Band | Threshold | Light | Dark (Dim) |
|---|---|---|---|
| **green** | `< 60%` | `bg-green-100 border-green-200 text-green-700` | `bg-#14532d border-#166534 text-#86efac` (existing dark-mode overlay) |
| **amber** | `60% – 85%` | `bg-amber-100 border-amber-200 text-amber-700` | existing dark-mode overlay (`bg-#2a1f0a border-#92400e text-#fcd34d`) |
| **red** | `> 85%` | `bg-red-100 border-red-200 text-red-700` | existing dark-mode overlay (`bg-#7f1d1d border-#991b1b text-#fca5a5`) |
| **stale (neutral)** | n/a — `now - received_at > 2 × poll_interval` | `bg-gray-100 border-gray-200 text-gray-500` + `opacity-50` | `bg-#21262d border-#30363d text-#9aa4ae` + `opacity-50` |

No new colour tokens; every utility class above is already remapped
in the dark-mode overlay block (mockup `<style>` lines 920–1004).
**Theme axis invariant preserved by construction.**

WCAG-AA contrast at the listed colour pairs is preserved — the same
utility-class pairs render the existing ⚠ prev-failed badge (amber),
Failures count (red), and Success leaf (green) at acceptable contrast
on both light and dark surfaces.

## Stale-affordance visual

**Decision.** When `now - received_at > 2 × poll_interval` (MVP = 120 s):

1. Pill background switches to the **stale (neutral)** token from the
   table above.
2. Pill receives `opacity: 0.5` (composes with the neutral token;
   reads as visually de-emphasised).
3. The percent figure is replaced by literal `—` (em-dash; same
   character the version-display null-render invariant uses elsewhere
   in the canonical for absent attributes).
4. The label `used` is replaced by italic `stale`.
5. The tooltip exposes `last seen <received_at as relative time>` —
   e.g. `last seen 4 minutes ago` — for operator debugging.
6. The counter pill (` · N sources`) renders unchanged (the sources
   themselves are not stale, the per-source figures are).

**Why three signals (colour + opacity + label).** Single-signal
treatments are easy to misread:

| Single-signal option | Misread risk |
|---|---|
| Italic only | Reads as styling, not staleness. |
| Dimmed only | Reads as "still loading", not "data is old". |
| Colour only (neutral) | Reads as "no usage data", not "stale data" — ambiguous with the empty / cold-start state. |
| **Colour + opacity + "—" + "stale"** (chosen) | Three orthogonal signals; impossible to misread; the `—` and the `stale` label are the unambiguous textual cues. |

## NFR-09 footprint

**New invariant proposed for the harness** (flagged for `qa-engineer`
to add in Phase 5 — `frontend-engineer` does not edit `testing/`):

> **Invariant 7 (proposed) — stats-strip cluster non-overlap.** The
> right-aligned rate-limit cluster's left edge MUST be ≥ the left
> cluster's right edge + 24 px gutter, at every viewport ≥ 1024 px
> AND every services-count + adapters-count combination in the
> mockup fixture. Measured via `getBoundingClientRect()` on the
> two cluster wrappers; assertion is a strict numeric comparison,
> no pixel tolerance.

The collapse threshold above ensures this invariant holds by
construction: when measured slack drops below 360 px, the cluster
collapses to a ~80 px footprint (dot + percent), leaving > 280 px of
breathing room. The hover-stack (highlight-hint above the cluster) is
vertical, not horizontal — invariant 7 is unaffected.

The existing 6 head-comment invariants are unaffected — no leaf
renderer changes, no connector geometry changes, no env-tag column
changes. The cluster sits inside the stats-bar element which is
above the layout switcher and the matrix / swim-lane / workflow-rows
canvases.

## Fixture additions to the mockup

Three `(adapter, source-id)` snapshots, deliberately covering all
three bands to exercise the worst-band aggregation:

| `adapter_id` | `source_id` | `upstream_used` / `upstream_limit` | Band | Notes |
|---|---|---|---|---|
| `github-actions` | `acme/widget-a` | `1,400 / 5,000` (28%) | green | Healthy reading. |
| `github-actions` | `acme/widget-b` | `3,750 / 5,000` (75%) | amber | Shares PAT with `widget-a`; same `self_imposed_cap`. |
| `azure-devops` | `contoso/payments` | `4,400 / 5,000` (88%) | red | Different adapter → different PAT; independent cap. |

The cluster renders as: a red pill (worst band wins) + `88% used` +
` · 3 sources`. Hover → tooltip `4,400 / 5,000 · resets 14:00 UTC`.
Click counter → popover with three rows. Cycling the fixture's
`received_at` back ~3 minutes triggers the stale path.

## Wire shape consumed by the cluster

The SPA polls `GET /api/fetcher/usage` (CR-0011 § 3b) on the same
cadence as the matrix poll. Cluster reads:

```ts
// Proposed TypeScript shape — final lives in frontend/shared/ at Phase 4.
interface FetcherUsageSnapshot {
  adapter_id:         string;     // e.g. "github-actions"
  source_id:          string;     // e.g. "acme/widget-a"
  upstream_limit:     number;     // provider-reported window budget
  upstream_remaining: number;     // provider-reported remaining
  upstream_reset_at:  string;     // ISO-8601 UTC
  self_imposed_cap:   number;     // resolved cap (absolute or % of upstream_limit)
  upstream_used:      number;     // upstream_limit - upstream_remaining
  observed_at:        string;     // fetcher wall-clock at observation
  received_at:        string;     // server wall-clock at POST landing
}

interface FetcherUsageResponse {
  snapshots: FetcherUsageSnapshot[];   // empty array — never 404 — on cold start
}
```

Mockup carries the static fixture; SPA Phase 4 wires the poll +
mapping.

## Status

- Phase 2b design proposal — chosen variant table at the top is the
  locked output.
- Mockup HTML edited to ship the chosen variant before Phase 4 (per
  CR-0011 § 3e mockup-before-implementation rule).
- New harness invariant 7 (stats-strip cluster non-overlap) flagged
  for `qa-engineer` in the Phase 2b return; harness lives under
  `testing/mockup-visual/` (forbidden territory for
  `frontend-engineer`).

## FR / NFR pointers

- [CR-0011](../cr/CR-0011-fetcher-rate-limit-governance.md) — parent CR (FR-18 / FR-19 / FR-20; § 3d locks cluster constraints; § 3e mockup-before-implementation).
- [ADR-0008](../adr/ADR-0008-leaky-bucket-cap-and-republish-on-tick.md) — per-token cap / per-(adapter, source-id) reporting; `upstream_used` semantics.
- [CR-0006](../cr/CR-0006-light-dark-auto-theme.md) — Theme axis the severity tokens compose with.
- SAD §5 NFR-09 — reflow invariant the cluster must not violate.
- `frontend/matrix/src/lib/stats-bar.component.ts` — Phase 4 SPA insertion point.
