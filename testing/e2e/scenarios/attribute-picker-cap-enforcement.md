# Attribute picker enforces the per-view cap

**Intent:** the picker counter reads `<n>/<max>` for the active view;
once `<n>` equals `<max>`, the remaining unchecked checkboxes are
disabled (cannot be checked) until the user frees a slot by unchecking
one. Caps differ per view: Detailed = 7, Compact = 5, Glance = 1,
Focus = 5.

## Citations

- `docs/architecture.md` §4 FR-02 (seven-attribute
  set: `status`, `version`, `run`, `ago`, `actor`, `ref`, `sha` —
  amended via `docs/cr/CR-0002-four-named-views-and-attribute-picker.md`
  and `docs/cr/CR-0004-ref-and-sha-optional-fields.md`).
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` FR-12
  ("an attribute picker ... subject to a per-view cap").
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` "Layout
  views (FR-12)" — `Max attributes` column per view: Detailed 7,
  Compact 5, Glance 1, Focus 5.
- `docs/ui/compact-options.md` — "Cap enforcement: when
  `selectedAttrCount >= activeView.maxAttrs`, unchecked boxes render
  disabled ... Toggling an existing selection off frees a slot."

## Preconditions

- Stack up, fixtures seeded with the 6-state corpus.
- `localStorage` cleared at the start of the test, so each view loads
  its default attribute set:
    - Detailed = `status, version, run, ago, actor` (5 of 7 — `ref`
      and `sha` are off by default but selectable up to cap 7),
    - Compact = `status, version, run, ago` (4 of 5),
    - Glance = `version` (1 of 1),
    - Focus = `status, version, run, ago` (4 of 5).
- The page is on the **Detailed** view (the first-visit default).

## Steps

1. **Given** the SPA is loaded and the view is Detailed,
2. **When** the test clicks `[data-testid="attribute-picker"]`,
3. **Then** the picker popover opens,
4. **And** `[data-testid="picker-counter"]` reads `5/7`,
5. **And** the five default `[data-testid="attr-checkbox-<key>"]`
   checkboxes (`status`, `version`, `run`, `ago`, `actor`) are
   `checked`,
6. **And** the two additional checkboxes (`ref`, `sha`) are present,
   unchecked, and **enabled** (room for two more selections).
7. **When** the test checks `[data-testid="attr-checkbox-ref"]`,
8. **Then** the counter reads `6/7`,
9. **And** `attr-checkbox-sha` is still unchecked and enabled (room
   for one more).
10. **When** the test checks `[data-testid="attr-checkbox-sha"]`,
11. **Then** the counter reads `7/7`,
12. **And** every checkbox in the picker is checked,
13. **And** no checkbox is `disabled` (every box is checked, so the
    cap-disabled state cannot be observed yet).
14. **When** the test unchecks `attr-checkbox-actor`,
15. **Then** the counter reads `6/7`,
16. **And** `attr-checkbox-actor` is now unchecked and **not**
    disabled (cap not reached, room for one more selection).
17. **When** the test switches to Compact via
    `[data-testid="view-option-compact"]`,
18. **Then** `[data-testid="picker-counter"]` reads `4/5` (Compact's
    default attribute set),
19. **And** the four default checkboxes (`status`, `version`, `run`,
    `ago`) are checked,
20. **And** the three other checkboxes (`actor`, `ref`, `sha`) are
    unchecked and **enabled** (one slot free, but only one — checking
    any one of them will fill the cap and disable the others).
21. **When** the test checks `attr-checkbox-ref`,
22. **Then** the counter reads `5/5`,
23. **And** the two remaining unchecked checkboxes (`actor`, `sha`)
    are now `disabled` (cap reached, no more slots).
24. **When** the test unchecks `attr-checkbox-run`,
25. **Then** the counter reads `4/5`,
26. **And** `attr-checkbox-actor` and `attr-checkbox-sha` are now
    enabled again (the cap freed a slot).
27. **When** the test switches to Glance via
    `[data-testid="view-option-glance"]`,
28. **Then** `[data-testid="picker-counter"]` reads `1/1` (Glance's
    default set: `version` only),
29. **And** the six other checkboxes (`status`, `run`, `ago`,
    `actor`, `ref`, `sha`) are unchecked and `disabled`.

## Expected results

- The counter text reflects the active view's selection / cap exactly,
  re-rendering on every selection change and on every view switch.
- The `disabled` attribute on a checkbox is present iff
  `selectedAttrCount === cap` AND the checkbox is currently unchecked.
- Toggling a checked checkbox off immediately re-enables previously
  disabled siblings (no need for a click anywhere else).
- Switching views re-reads that view's selection from the store and
  re-renders the counter / disabled states; selections from other
  views are not visible.
- The picker exposes **exactly seven** checkboxes for every view (one
  per FR-02 attribute). Per-view differences are in defaults + cap,
  never in the catalogue itself.

## Out of scope

- Cross-reload persistence of selections (covered by
  `attribute-picker-persistence.md`).
- The Focus view's expanded-row behaviour (covered by
  `full-attribute-disclosure.md`).
- Visual styling of the disabled state (`opacity-40`,
  `cursor-not-allowed`) — the E2E suite asserts the `disabled`
  attribute only, never CSS class strings.
- Whether selecting `ref` / `sha` renders the value in the slot body
  — covered by `picker-ref-sha-checkboxes.md` and
  `null-render-ref-sha.md`.

## Coverage

- FR-02: seven attributes selectable in the picker.
- FR-12: per-view cap enforcement on the attribute picker.
- `docs/cr/CR-0002-four-named-views-and-attribute-picker.md` "Layout
  views (FR-12)" — `Max attributes` column (7 / 5 / 1 / 5).
- `docs/ui/compact-options.md` "Cap enforcement" rule.
