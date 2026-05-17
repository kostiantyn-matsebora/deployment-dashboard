# Display picker exposes `ref` and `sha`; selecting them renders the fixture values

**Intent:** the Display attribute picker exposes a checkbox for every
FR-02 attribute, including the two FR-05 additions (`ref`, `sha`).
Selecting either causes the matching value from the slot's
`current.ref` / `current.sha` (or `lastSuccessful.ref` /
`lastSuccessful.sha`) to render in the slot body for slots whose
underlying field is a non-empty string. For slots where the field is
null or absent, the slot still renders the box — only the
ref/sha-specific line is absent (covered separately by
`null-render-ref-sha.md`).

## Citations

- `docs/architecture.md` §4 FR-02 (the
  seven-attribute set: `status`, `version`, `run`, `ago`, `actor`,
  `ref`, `sha` — amended via
  `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` and
  `docs/cr/CR-0004-ref-and-sha-optional-fields.md`).
- `docs/cr/CR-0004-ref-and-sha-optional-fields.md` FR-05 amendment
  ("Optional fields ref + sha on the ingest payload, surfaced on the
  matrix wire shape").
- `docs/cr/CR-0005-ref-sha-display-and-topology.md` "Attribute
  vocabulary" rows for `ref` / `sha`:
  - `ref` → `current.ref` (source identifier — branch / PR / tag).
  - `sha` → `current.sha` (commit hash, truncated in display).
- `docs/WBS.md` MVP §1.3.10 "Attribute picker component" —
  explicit "seven checkboxes (`status`, `version`, `run`, `ago`,
  `actor`, `ref`, `sha`)".

## Preconditions

- Stack up, canonical 6-state corpus seeded.
- `localStorage` cleared at the start of the test (defaults restored).
- The page is on **Detailed** view (cap 7, defaults 5/7).

## Steps

### Part 1 — Selecting `ref` shows the source identifier

1. **Given** the SPA at `/`, Detailed view, picker not yet opened.
2. **When** the test clicks `[data-testid="attribute-picker"]` and
   checks `[data-testid="attr-checkbox-ref"]`.
3. **Then** `[data-testid="picker-counter"]` reads `6/7`,
4. **And** the matrix grid now exposes a per-slot ref render anchor
   `[data-testid="current-ref-<service>-<env>"]` for every slot whose
   `current.ref` is a non-empty string.
5. **And** for `service-b/dev` (fixture stores `ref: "main"`) the
   text content of `[data-testid="current-ref-service-b-dev"]` is
   exactly `"main"` — verbatim, no truncation, no decoration.
6. **And** for `service-a/dev` (fixture stores
   `ref: "feature/login-revamp"`) the text content of
   `[data-testid="current-ref-service-a-dev"]` is exactly
   `"feature/login-revamp"`.

### Part 2 — Selecting `sha` shows the commit hash (truncation rule applies on the grid)

7. **When** the test checks `[data-testid="attr-checkbox-sha"]`,
8. **Then** the counter reads `7/7`,
9. **And** the matrix grid exposes a per-slot sha render anchor
   `[data-testid="current-sha-<service>-<env>"]` for every slot whose
   `current.sha` is a non-empty string.
10. **And** for `service-b/dev` (fixture stores `sha: "9f1c0d2e8a"`,
    10 chars) the text content of
    `[data-testid="current-sha-service-b-dev"]` begins with the first
    7 chars of the value (the conventional Git short-sha) — the full
    value is asserted by `sha-truncation.md`. This scenario only
    asserts the test-id is present and non-empty.

### Part 3 — Unchecking removes the render anchor

11. **When** the test unchecks `[data-testid="attr-checkbox-ref"]`,
12. **Then** the counter reads `6/7`,
13. **And** `[data-testid="current-ref-service-b-dev"]` is no longer
    in the DOM (count = 0).
14. **And** `[data-testid="current-sha-service-b-dev"]` is still
    visible (the other attribute's render is independent).

### Part 4 — Persistence across reload

15. **When** the test reloads the page,
16. **Then** the persisted attrs include `sha` (and exclude `ref`),
17. **And** `[data-testid="current-sha-service-b-dev"]` is in the
    DOM on first paint,
18. **And** `[data-testid="current-ref-service-b-dev"]` is NOT.

## Expected results

- The picker exposes seven checkboxes including `ref` and `sha`.
- Selecting either adds a per-slot render anchor on the matrix grid
  with the testid pattern `current-{ref|sha}-<service>-<env>`. The
  anchor is rendered for slots where the corresponding field is a
  non-empty string.
- Unchecking removes the anchor (count drops to 0).
- The attribute selection persists across reload under
  `localStorage["dashboard.attrs.detailed"]`.

## Out of scope

- Truncation of `sha` to first 7 chars + ellipsis on the grid
  (covered by `sha-truncation.md`).
- Slots where `ref` / `sha` is null — covered by
  `null-render-ref-sha.md`.
- Topology correlation by `ref` / `sha` (covered by
  `topology-picker-ref-sha-query-param.md` for the picker, by
  `TopologyCorrelationByRefShaTests.cs` for the API contract).

## Coverage

- FR-02 (seven-attribute set).
- FR-05 (ref + sha additive on the matrix wire shape).
- FR-12 (per-view picker exposes every FR-02 attribute).
- `docs/cr/CR-0005-ref-sha-display-and-topology.md` "Attribute
  vocabulary" — `ref` and `sha` bindings.
- `docs/WBS.md` MVP §1.3.10 — attribute picker exposes seven checkboxes.
