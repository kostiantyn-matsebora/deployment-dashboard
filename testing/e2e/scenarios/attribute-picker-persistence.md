# Attribute picker selection persists per view, including the empty selection

**Intent:** the attribute picker writes the active view's checked
attributes to `localStorage` under `dashboard.attrs.<view>` as a JSON
array. A full reload restores the exact selection. An empty array is
a legitimate persisted state (per the SAD's load-time hardening rules)
and must NOT be auto-restored to the view's defaults. `ref` and `sha`
are part of the catalogue (FR-02 seven-attribute set) and persist
through the same key the other five attributes do.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-02 (seven-attribute
  set: `status`, `version`, `run`, `ago`, `actor`, `ref`, `sha` —
  amended via `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  and `docs/cr/CR-0004-ref-and-sha-optional-fields.md`).
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` FR-12
  ("view selection and per-view attribute selection persist
  client-side in `localStorage`").
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  "Client-side persistence (`localStorage`)" — the key shapes and the
  load-time hardening rules; specifically, "An empty array (`[]`) is
  a legitimate user choice ... Do not auto-restore defaults in this
  case." The example values include `ref` and `sha` keys (e.g.
  `["status","version","run","ago","actor","ref","sha"]` for
  Detailed).
- `docs/ui-compact-options.md` — "Empty selection is a legitimate
  state".

## Preconditions

- Stack up, fixtures seeded with the 6-state corpus.
- `localStorage` cleared at the start of the test.

## Steps

### Part 1 — Compact selection (including ref/sha) persists across reload

1. **Given** the SPA is loaded and the view is Compact (cap 5,
   defaults `status` / `version` / `run` / `ago`),
2. **When** the test opens the picker via
   `[data-testid="attribute-picker"]`,
3. **Then** `[data-testid="picker-counter"]` reads `4/5`.
4. **When** the test unchecks `[data-testid="attr-checkbox-run"]`
   (freeing a slot) and checks `[data-testid="attr-checkbox-sha"]`,
5. **Then** `[data-testid="picker-counter"]` reads `4/5`,
6. **And** `localStorage.getItem('dashboard.attrs.compact')` parses to
   a JSON array equal to `["status","version","ago","sha"]` (order
   may vary; test as a set).
7. **When** the test reloads the page,
8. **Then** the view is still Compact,
9. **And** the picker counter reads `4/5`,
10. **And** the same four checkboxes (`status`, `version`, `ago`,
    `sha`) are checked and the other three are unchecked.

### Part 2 — Glance empty selection persists across reload

11. **When** the test switches to Glance (cap 1, default `version`),
12. **Then** the picker counter reads `1/1`,
13. **And** `attr-checkbox-version` is checked.
14. **When** the test unchecks `attr-checkbox-version`,
15. **Then** the picker counter reads `0/1`,
16. **And** `localStorage.getItem('dashboard.attrs.glance')` parses to
    `[]` (an empty array — legitimate per SAD).
17. **When** the test reloads the page,
18. **Then** the view is still Glance,
19. **And** the picker counter still reads `0/1` (the empty selection
    is preserved — defaults are NOT auto-restored),
20. **And** every checkbox in the picker is unchecked, including
    `attr-checkbox-ref` and `attr-checkbox-sha`.

### Part 3 — Glance honours ref / sha as a single-attribute pick

21. **When** the test checks `attr-checkbox-ref` (Glance cap 1),
22. **Then** the counter reads `1/1`,
23. **And** `localStorage.getItem('dashboard.attrs.glance')` parses to
    `["ref"]`,
24. **And** the other six checkboxes are unchecked and disabled
    (cap reached).
25. **When** the test reloads the page,
26. **Then** the persisted `["ref"]` is reflected — `attr-checkbox-ref`
    is the single checked box.

## Expected results

- Every check / uncheck mutates `localStorage` for the active view's
  key only (other views' keys are untouched).
- Reload restores the persisted array exactly, including `[]` and the
  ref / sha cases above.
- `ref` and `sha` are first-class attribute keys in the persisted
  array — never aliased, never split out into a separate key, never
  filtered.

## Out of scope

- Cap enforcement at toggle time (covered by
  `attribute-picker-cap-enforcement.md`).
- Recovery from corrupted JSON in `localStorage` — the SAD's
  hardening rules are unit-test territory; the E2E suite asserts the
  happy-path serialisation + the legitimate empty-array case.
- Whether selecting `ref` / `sha` renders the value on the matrix
  grid (covered by `picker-ref-sha-checkboxes.md`).

## Coverage

- FR-02: seven attributes — `ref` and `sha` persist alongside the
  original five.
- FR-12: per-view attribute selection persists across reload.
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  "Client-side persistence (`localStorage`)" — key shapes
  `dashboard.attrs.<view>` and the empty-array rule.
- `docs/ui-compact-options.md` "Empty selection is a legitimate
  state".
