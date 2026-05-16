# Focus view is visually and behaviourally distinct from Compact

**Intent:** the Focus view is the only view that exposes per-service
**chevron** (expand / collapse) and **pin** (keep-expanded across
filter changes) affordances in the row gutter. These two controls are
Focus's defining contract — without them Focus collapses visually into
Compact (both views share the same collapsed leaf width and the same
default attribute set). A regression that hid or removed the chevron
button has shipped in the past and the existing oracles all stayed
green, so this scenario is written specifically to **catch that class
of regression** by asserting on the row-gutter affordances directly.

**Path A — all three layouts.** Per `docs/ui-compact-options.md`
"Focus view specifics > Layout scope", the chevron + pin appear in
**all three layouts** when View=Focus. Granularity is service-grain in
every layout:

| Layout | Granularity | Expected affordance count when View=Focus |
|---|---|---|
| Matrix | per service-row | one chevron + one pin per service-row |
| Swim-lane | per service-lane | one chevron + one pin per service-lane |
| Workflow-rows | per service-header | one chevron + one pin per service-header (NOT per path-row) |

Frontend's commitment: testids `row-chevron-{svcId}` / `row-pin-{svcId}`
and the per-layout service anchor (`[data-service-row]`,
`[data-testid^="swim-lane-row-"]`, `[data-testid^="workflow-rows-"]`)
are layout-agnostic.

**Pin survives Layout switch.** `state.pinned[id]` is layout-agnostic.
Switching Layout while a service is pinned keeps the pin; the
affordance and its expansion semantics adapt to the new layout's
granularity, but the pinned set itself does not reset.

## Citations

- `docs/ui-compact-options.md` "Focus view specifics" — the chevron +
  pin lifecycle table:
  - Chevron and pin live **in the row gutter** (leftmost edge of the
    row, before the service name).
  - Both are framed `w-5 h-5` buttons with a tinted resting surface.
  - **Inline placement (next to the service name or inside a leaf) is
    out of contract.**
- `docs/ui-compact-options.md` "Focus view specifics" — pin lifecycle:
  pin state lives in `state.pinned[id]` and is **unaffected by filters**.
  If a pinned row is hidden by search or "Failures only", the pin is
  preserved; when the row re-matches the active filter set, it
  re-renders expanded.
- `docs/ui-compact-options.md` "Session-only state (NOT persisted)" —
  Focus row `expanded` and `pinned` reset on page reload.
- `docs/deployment-dashboard-architecture.md` §4 FR-12 — the four named
  layout views, one of which is Focus.
- `docs/deployment-dashboard.html` — canonical mockup. The `focus-row`
  template carries `data-testid="row-chevron-{id}"` and
  `data-testid="row-pin-{id}"`; the row itself flips its `data-testid`
  between `row-collapsed-{id}` and `row-expanded-{id}` depending on
  state; `data-expanded` and `data-pinned` mirror the same state in
  attributes a test can read without DOM-class coupling.

## Preconditions

- Stack up, fixtures seeded with the canonical 6-state corpus via
  `testing/scripts/seed.ps1`. The seeded corpus contains at least
  `service-a`, `service-b`, `service-c`, `service-d` (per
  `testing/fixtures/seed-data.json`), of which **only `service-b`**
  has any slot with `current.status === 'failure'` — i.e. only
  `service-b` survives the "Failures only" filter. The pin-across-
  filter assertion uses `service-a` (a service that is filtered OUT
  when "Failures only" is on) so the pin's filter-resilience is
  observable.
- `localStorage` cleared at the start of every test (the suite uses
  the standard `await page.evaluate(() => localStorage.clear())` in
  `beforeEach`), so the page loads on the Detailed view.
- No `data-testid` for the chevron / pin / focus-row is invented in
  the test; everything below uses the testids the frontend already
  exposes in the mockup, mirrored into the Angular SPA.

## Steps

### A. Chevron-presence oracle (regression-preventing core assertion) — runs against EACH of `{matrix, swim-lane, workflow-rows}`

1. **Given** the SPA on the Detailed view (first paint, cleared
   `localStorage`),
2. **When** the test selects Layout=`{layout}` via
   `[data-testid="layout-option-{layout}"]`,
3. **When** the test switches to the Compact view via
   `[data-testid="view-option-compact"]`,
4. **Then** there are **zero** elements matching
   `[data-testid^="row-chevron-"]` and **zero** matching
   `[data-testid^="row-pin-"]` (Compact rows have no row-gutter
   affordances — they would be indistinguishable from Focus if any
   leaked in).
5. **When** the test switches to Focus via
   `[data-testid="view-option-focus"]`,
6. **Then** the count of `[data-testid^="row-chevron-"]` equals the
   count of visible *services* under the active layout:
   - Matrix: `[data-service-row]` count.
   - Swim-lane: `[data-testid^="swim-lane-row-"]` count.
   - Workflow-rows: `[data-testid^="workflow-rows-"]` count (NOT
     `[data-service-row]` — that selector also matches each `.wf-row`
     path-row and over-counts).
7. **And** the count of `[data-testid^="row-pin-"]` equals the same
   number,
8. **And** the set of service ids carried in the chevron / pin
   testid suffixes (`row-chevron-{svcId}`) is **distinct** — no
   duplicate ids. (Defends against a duplicate-per-path regression
   in workflow-rows.)
9. **And** for every visible service the chevron and pin are
   *direct descendants of the row gutter* — not nested inside any
   `[data-testid^="stage-box-"]`. (Inline placement is
   out-of-contract per `ui-compact-options.md`.)

### B. Chevron expand / collapse toggle — runs against EACH of `{matrix, swim-lane, workflow-rows}`

1. **Given** the SPA on Layout=`{layout}` and View=Focus, no services
   expanded,
2. **Then** the service `service-a` has
   `[data-testid="row-collapsed-service-a"]` present (testid mirrors
   collapsed state in every layout),
3. **When** the test clicks `[data-testid="row-chevron-service-a"]`,
4. **Then** the same service carries
   `[data-testid="row-expanded-service-a"]`,
5. **When** the test clicks the chevron again,
6. **Then** the service reverts to
   `[data-testid="row-collapsed-service-a"]`.

Note: `data-expanded="true"` / `="false"` is asserted in the Matrix
variant because that attribute is canonical on the matrix
`[data-service-row]`. In workflow-rows, expansion is per
service-header (the `.wf-row` path-rows are rendered/unrendered by
the expansion state), so the canonical observable is the testid flip
between `row-collapsed-{svc}` and `row-expanded-{svc}`.

### C. Pin preserves expansion across filter changes

1. **Given** the SPA on the Focus view, no rows expanded, no
   "Failures only" filter active,
2. **When** the test clicks
   `[data-testid="row-pin-service-a"]` (a service that has no slot
   with `current.status === 'failure'`),
3. **Then** the `service-a` row carries
   `data-pinned="true"` and `data-expanded="true"` (pinning a
   collapsed row implies expansion per
   `ui-compact-options.md`).
4. **When** the test toggles
   `[data-testid="failures-only-toggle"]` to ON,
5. **Then** the `service-a` row is filtered out (the failures-only
   filter is unchanged behaviour),
6. **When** the test toggles "Failures only" back OFF,
7. **Then** the `service-a` row re-appears **and** is still
   `data-expanded="true"` **and** `data-pinned="true"` — the pin
   state survived the filter sweep, as the doc prescribes ("the pin
   is preserved; when the row re-matches the active filter set, it
   re-renders expanded").

### E. Pin survives a Layout switch (pin state is layout-agnostic)

1. **Given** the SPA on Layout=Matrix and View=Focus,
2. **When** the test clicks `[data-testid="row-pin-service-a"]`,
3. **Then** the matrix row carries `data-pinned="true"` and
   `data-expanded="true"`.
4. **When** the test switches Layout to Swim-lane via
   `[data-testid="layout-option-swim-lane"]`,
5. **Then** `[data-testid="row-pin-service-a"]` is still rendered
   (the affordance is layout-agnostic) **and**
   `[data-testid="row-expanded-service-a"]` is present (the service
   came back already expanded under the new layout's granularity).
6. **When** the test switches Layout to Workflow-rows,
7. **Then** the same assertion holds — the pin survived a second
   Layout switch.

This codifies the "Pin survives layout switch" rule in
`docs/ui-compact-options.md` "Focus view specifics".

### D. `collapseAll` honours pinned rows

1. **Given** the SPA on the Focus view with `service-a` pinned (and
   therefore expanded) and `service-c` expanded but NOT pinned
   (click its chevron once),
2. **Then** the page exposes a `[data-testid="collapse-all"]` button
   (the mockup labels it "Collapse all" and is `x-show`'d when
   `hasExpanded` is truthy),
3. **When** the test clicks `[data-testid="collapse-all"]`,
4. **Then** the `service-c` row collapses to
   `data-expanded="false"` (testid flips to `row-collapsed-service-c`),
5. **And** the `service-a` row stays `data-expanded="true"` AND
   `data-pinned="true"` (pinned rows are exempt from
   `collapseAll`, per the mockup's `collapseAll()` action which
   skips pinned ids).

## Expected results (observable)

| # | Observable |
|---|---|
| A1 | Each layout, Compact view: `[data-testid^="row-chevron-"]` count == 0. |
| A2 | Each layout, Compact view: `[data-testid^="row-pin-"]` count == 0. |
| A3 | Each layout, Focus view: chevron count == visible service count > 0 (matrix uses `[data-service-row]`; swim-lane uses `[data-testid^="swim-lane-row-"]`; workflow-rows uses `[data-testid^="workflow-rows-"]`). |
| A4 | Each layout, Focus view: pin count == visible service count > 0. |
| A5 | Each layout, Focus view: chevron / pin service-id suffixes are DISTINCT (no duplicate-per-path in workflow-rows). |
| A6 | Each layout, Focus view: chevron and pin are NOT nested inside a `stage-box-*` element. |
| B  | Each layout: clicking the chevron flips the service's `data-testid` between `row-collapsed-{id}` and `row-expanded-{id}` (in matrix the row's `data-expanded` attribute also flips). |
| C  | After pin + "Failures only" toggle round-trip, the pinned row's `data-expanded` is still `"true"` and `data-pinned` is still `"true"`. |
| D  | `collapseAll` collapses unpinned rows but leaves pinned rows expanded. |
| E  | After pin (matrix) + Layout switch matrix → swim-lane → workflow-rows, the pin testid for the pinned service is still rendered AND `row-expanded-{svc}` is still present in the new layout. |

If a future change removed the chevron from Focus rows, assertion
**A3** (`chevron count == visible service-row count`) would fail at
zero — i.e. this oracle catches the exact regression that motivated
its creation.

If a future change leaked chevron / pin into Compact (collapsing the
two views in the opposite direction), assertions **A1 / A2** would
fail with non-zero counts.

If a future change broke the pin's filter-resilience, assertion **C**
would fail because the row would either come back collapsed or stay
hidden.

## Out of scope

- Visual rendering / colour of the chevron and pin (size, surface
  colour, hover state). The
  `testing/mockup-visual/mockup-invariants.spec.ts` harness covers
  the geometric invariants; the per-view visual contract for these
  controls lives in `ui-compact-options.md` and is a frontend craft
  concern.
- Per-row leaf width difference between Focus-expanded and
  Compact-collapsed. Implementing as a brittle pixel-width assertion
  was considered and rejected — the chevron-count oracle above is a
  cheaper and far stricter regression catcher.
- Persistence of `expanded` / `pinned` across reload — the doc
  explicitly says these are session-only; a separate "reset on
  reload" scenario could be added later, but it's not the regression
  we're guarding against.
- The Focus view's expanded-row attribute disclosure (all 7
  attributes) — that is the
  `full-attribute-disclosure.md` scenario's job; this scenario only
  cares that the affordances exist and behave.

## Coverage

- `docs/ui-compact-options.md` "Focus view specifics" — chevron and
  pin row-gutter placement, lifecycle, and filter resilience.
- `docs/ui-compact-options.md` "Session-only state (NOT persisted)"
  — `expanded[id]` / `pinned[id]` lifecycle.
- `docs/deployment-dashboard-architecture.md` §4 FR-12 — the four
  named layout views (the Focus row must remain a *distinguishable*
  view).
- Regression history: a prior change rendered Focus
  indistinguishable from Compact because the chevron + pin existed
  but were too understated to read. This oracle exists to prevent
  re-occurrence.
