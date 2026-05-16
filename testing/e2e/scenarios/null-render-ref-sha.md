# Null-render invariant — selecting `ref` or `sha` on a slot with null value renders empty, never `"null"`

**Intent:** when the user selects `ref` or `sha` as a Display
attribute, slots whose underlying `current.ref` / `current.sha` (or
`lastSuccessful.ref` / `lastSuccessful.sha`) is null or absent on the
wire must render with the attribute slot **empty** — no placeholder,
no the literal string `"null"`, no `"undefined"`. The other selected
attributes on the same slot continue to render normally. This is the
`docs/cr/CR-0005-ref-sha-display-and-topology.md` "Null-render
invariant for nullable attributes", encoded as an observable property
of the SPA.

## Citations

- `docs/cr/CR-0005-ref-sha-display-and-topology.md` "Null-render
  invariant for nullable attributes" (verbatim): "The attribute slot
  in the box body renders empty — no text, no placeholder, no the
  literal string `"null"` / `"undefined"`."
- `docs/cr/CR-0005-ref-sha-display-and-topology.md` "Attribute
  vocabulary" — `ref` / `sha` rows ("Nullable on the wire (FR-05);
  when null/absent the picker slot renders empty per the null-render
  invariant below").
- `docs/deployment-dashboard-architecture.md` §4 FR-02 + FR-05 (the
  attributes' existence + nullability contract — FR-02 amended via
  `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`; FR-05
  amended via `docs/cr/CR-0004-ref-and-sha-optional-fields.md`).
- `docs/deployment-dashboard.html` head comment "Null-render
  invariant" — the mockup-side encoding of the same rule (the SPA is
  asserted against, the mockup is the contract for the SAD-level
  invariant compliance).

## Preconditions

- Stack up, canonical 6-state corpus seeded.
- `localStorage` cleared at the start of the test.
- The page is on **Detailed** view (cap 7).
- Fixture invariants exercised here:
  - `service-b/qa` — current event has NEITHER ref NOR sha (legacy
    shape); the slot is a `failed-with-last-success` state with a
    lastSuccessful split that also has neither.
  - `service-d/uat` — running-only state; the single event has
    neither ref nor sha.
  - `service-a/dev` — current event has `ref: "feature/login-revamp"`
    and NO sha; lastSuccessful event has `ref: "main"` and NO sha.
    Selecting `ref` on this slot must render text; selecting `sha`
    must render empty.
  - `service-c/dev` — current event has `sha: "deadbeef1234"` and NO
    ref (intermediate failure event); the current is itself in-
    progress with neither.

## Steps

### Part 1 — Selecting `ref` on slots with null ref renders empty

1. **Given** the SPA is loaded, Detailed view, picker not opened.
2. **When** the test opens the picker and checks
   `[data-testid="attr-checkbox-ref"]` (counter goes 5/7 -> 6/7),
3. **And** closes the picker so it doesn't overlap the grid.
4. **Then** for `service-b/qa` (fixture: ref is null), the per-slot
   ref render anchor `[data-testid="current-ref-service-b-qa"]` is
   either absent from the DOM (count = 0) OR present with an empty
   text content. The SAD permits both — the only forbidden render is
   the literal `"null"`.
5. **And** the text content of `[data-testid="stage-box-service-b-qa"]`
   contains no occurrence of the literal string `"null"` (case-
   insensitive, word-boundary tolerant — must not appear as a standalone
   token in any text node).
6. **And** the other selected attributes on `service-b/qa` continue
   to render: `current-version-service-b-qa` is `v1.7.9`, the slot
   border colour and last-successful split section are intact.
7. **And** the same holds for `service-d/uat` (running, no ref no
   sha) — the box renders the running state, the version is
   `v4.0.4`, no `"null"` text appears anywhere in the box.

### Part 2 — Selecting `sha` on slots with null sha renders empty

8. **When** the test opens the picker and ALSO checks
   `[data-testid="attr-checkbox-sha"]` (counter 6/7 -> 7/7).
9. **Then** for `service-a/dev` (fixture: latest event has ref but
   no sha), `[data-testid="current-sha-service-a-dev"]` is either
   absent (count = 0) OR present with empty text.
10. **And** the box for `service-a/dev` continues to render the ref
    value (`feature/login-revamp`) — selecting sha did not suppress
    the unrelated ref render.
11. **And** the slot's text content contains no `"null"` literal
    anywhere.

### Part 3 — Slots that DO carry a value still render correctly

12. **Then** for `service-b/dev` (fixture: BOTH ref + sha populated),
    `[data-testid="current-ref-service-b-dev"]` is visible with text
    `"main"` and `[data-testid="current-sha-service-b-dev"]` is
    visible with non-empty text. This pins the rule that the null-
    render invariant did not over-suppress the positive case.

### Part 4 — lastSuccessful split also honours null-render

13. **Then** for `service-c/dev` (fixture: lastSuccessful is
    `v3.1.0` with neither ref nor sha; the in-progress current also
    lacks both; an intermediate failure event has sha but is not on
    the current/lastSuccessful pair) the slot renders BOTH the
    in-progress current section AND the lastSuccessful split, neither
    of which contain the literal `"null"`.

## Expected results

- For every slot in the matrix whose `current.ref` (or
  `lastSuccessful.ref`) is null on the wire AND the user has `ref`
  selected, the slot renders without the literal token `"null"` or
  `"undefined"` anywhere in its text content. Equivalent rule for
  `sha`.
- The slot's other attributes (`status`, `version`, `run`, `ago`,
  `actor`) continue to render normally; the null-render invariant is
  per-attribute, not per-slot.
- The Detailed view's box renders survive the picker change without
  layout regression — boxes do not collapse to zero height even when
  every nullable attribute slot inside them is empty.

## Out of scope

- sha truncation when the value IS present (covered by
  `sha-truncation.md`).
- The history-drawer rendering of `null` ref / sha (covered by
  `full-attribute-disclosure.md`).
- Wire-format `null` vs absence equivalence — that's the
  functional-suite oracle (`RefShaFieldsTests.cs`).

## Coverage

- `docs/cr/CR-0005-ref-sha-display-and-topology.md` "Null-render
  invariant for nullable attributes".
- FR-02 (the attribute set).
- FR-05 (the optional / nullable wire shape).
- FR-12 (the picker controls grid rendering only).
