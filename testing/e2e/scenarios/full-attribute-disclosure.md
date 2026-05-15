# Full-attribute disclosure — drawer and Focus-expanded rows show every attribute regardless of picker state

**Intent:** the matrix attribute picker constrains what is rendered on
the matrix grid only. Two surfaces are always full-fidelity: the
history drawer (FR-04) and the Focus view's expanded rows. Both must
render every FR-02 attribute (`status`, `version`, `run`, `ago`,
`actor`, `ref`, `sha`) plus the absolute `deployed_at` timestamp
(drawer only) regardless of the user's picker selection — including
when the picker selection is empty. For nullable attributes (`ref` /
`sha`), the drawer and the expanded row honour the null-render
invariant (SAD §7) — when the underlying value is null the slot
renders empty, never the literal string `"null"`.

## Citations

- `docs/deployment-dashboard-architecture.md` §4 FR-02 (seven-attribute
  set: `status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`).
- `docs/deployment-dashboard-architecture.md` §4 FR-02 ("the user may
  select a subset of these attributes for the matrix view via the
  attribute picker (FR-12); the history drawer and any Focus-view
  expanded row always show every attribute").
- `docs/deployment-dashboard-architecture.md` §7 "Full-attribute
  disclosure rule" — explicit rule that the drawer and Focus-expanded
  rows are full-fidelity detail surfaces.
- `docs/deployment-dashboard-architecture.md` §7 "Null-render invariant
  for nullable attributes" — when `ref` / `sha` is null/absent, the
  attribute slot renders empty, NOT the literal `"null"`.
- `docs/ui-compact-options.md` "Always-on (NOT configurable)" — the
  drawer is always full-fidelity; "dt (absolute timestamp ...) is
  drawer-only".

## Preconditions

- Stack up, fixtures seeded with the 6-state corpus.
- `localStorage` cleared at the start of the test, so each view loads
  its default attribute set.
- The slot `service-b/qa` exists in the fixture and has a deployed
  current state (so all attributes are present on the wire). Note
  this slot's events deliberately carry NEITHER `ref` nor `sha`
  (legacy shape) — the drawer must surface the attribute slot for
  each AND render it empty.
- The slot `service-b/dev` exists in the fixture with BOTH `ref` and
  `sha` populated — exercises the non-null drawer render path.

## Steps

### Part 1 — Drawer always shows every attribute (legacy slot, ref/sha empty)

1. **Given** the SPA is loaded,
2. **When** the test switches to **Glance** via
   `[data-testid="view-option-glance"]` (cap 1, default picker
   selection = `version` only),
3. **Then** the picker counter reads `1/1`,
4. **And** every checkbox except `attr-checkbox-version` is unchecked
   and disabled.
5. **When** the test clicks the pill / box for `service-b/qa`,
6. **Then** the drawer opens (`[data-testid="history-drawer"]` is
   visible),
7. **And** the drawer's "current" panel renders each of the seven
   FR-02 attributes — surfaced via dedicated data-testids that the
   frontend exposes on the drawer:
   - `[data-testid="drawer-current-status"]` (status badge text)
   - `[data-testid="drawer-current-version"]` (version)
   - `[data-testid="drawer-current-run"]` (run number, with the
     `run_url` as the anchor `href`)
   - `[data-testid="drawer-current-ago"]` (relative elapsed time)
   - `[data-testid="drawer-current-actor"]` (actor)
   - `[data-testid="drawer-current-ref"]` (Source ref — rendered
     empty for service-b/qa per fixture)
   - `[data-testid="drawer-current-sha"]` (Commit SHA — rendered
     empty for service-b/qa per fixture)
8. **And** the drawer additionally renders the absolute timestamp via
   `[data-testid="drawer-current-deployed-at"]` (drawer-only — never
   on the matrix grid).
9. **And** the text contents of `drawer-current-ref` and
   `drawer-current-sha` are empty strings (zero non-whitespace
   characters) — the literal string `"null"` MUST NOT appear.

### Part 2 — Drawer renders ref and sha when populated

10. **When** the test closes the drawer and clicks the box for
    `service-b/dev` (fixture carries `ref: "main"` and
    `sha: "9f1c0d2e8a"`),
11. **Then** `drawer-current-ref` contains the text `"main"`,
12. **And** `drawer-current-sha` contains the FULL value
    `"9f1c0d2e8a"` (the drawer is full-fidelity — no truncation per
    SAD §7 "Full-attribute disclosure rule"). The matrix-grid render
    MAY truncate; the drawer MUST NOT.

### Part 3 — Focus expanded row always shows every attribute, even with an empty picker

13. **When** the test switches to **Focus** via
    `[data-testid="view-option-focus"]`,
14. **And** the test opens the picker and unchecks every checkbox
    (`status`, `version`, `run`, `ago` — Focus cap 5; the three extras
    `actor`, `ref`, `sha` are already off by default),
15. **Then** the picker counter reads `0/5`,
16. **And** `localStorage.getItem('dashboard.attrs.focus')` parses to
    `[]` (empty array — legitimate per SAD).
17. **And** every Focus collapsed row's body renders only the
    always-on elements:
    - the slot background colour treatment is present,
    - the `prev. failed` badge is present where applicable,
    - the last-successful split section is present where applicable,
    - the per-attribute slots for every FR-02 attribute are absent
      from the collapsed row body.
18. **When** the test clicks the chevron
    `[data-testid="focus-row-expand-service-a"]` to expand the
    `service-a` row,
19. **Then** the expanded row carries `data-expanded="true"` and
    renders, **for each environment slot in `service-a`**, every
    FR-02 attribute via slot-scoped testids exposed by the frontend's
    `focus-row` component:
    - `[data-testid="focus-expanded-status-service-a-<env>"]`
    - `[data-testid="focus-expanded-version-service-a-<env>"]`
    - `[data-testid="focus-expanded-run-service-a-<env>"]`
    - `[data-testid="focus-expanded-ago-service-a-<env>"]`
    - `[data-testid="focus-expanded-actor-service-a-<env>"]`
    - `[data-testid="focus-expanded-ref-service-a-<env>"]`
    - `[data-testid="focus-expanded-sha-service-a-<env>"]`
20. **And** the expanded row's rendering is independent of the
    picker — the empty picker state (`0/5`) does NOT hide any of the
    attributes inside the expanded row.
21. **And** for slots where `ref` or `sha` is null in the fixture,
    the corresponding `focus-expanded-{ref|sha}-…` testid renders
    empty text — NOT the literal `"null"`.

## Expected results

- The drawer renders all seven FR-02 attributes plus the absolute
  `deployed_at`, in every view and at every picker setting (verified
  here at Glance's cap-1 default).
- The Focus-expanded row renders all seven FR-02 attributes per slot,
  even when the user has unchecked every box in the picker — the
  "full-attribute disclosure rule" is the contract.
- The Focus collapsed row in the empty-picker state shows the
  always-on elements (colour, badge, split section) and nothing
  else — confirming the picker controls collapsed-row attributes
  only.
- Where `ref` / `sha` is null, the slot in the drawer or the
  expanded row renders empty (no `"null"` text node).

## Out of scope

- The history list portion of the drawer (covered by
  `drawer-history.md`).
- Detailed-view rendering of the same attributes (covered by
  `matrix-six-box-states.md` for the always-on elements; the picker
  is a no-op there because Detailed defaults include the five
  legacy attributes).
- Focus row "pin" behaviour across filter changes — the SAD mentions
  it under §7 Layout views but it deserves its own scenario; out of
  scope here.
- The matrix-grid render of ref/sha (covered by
  `picker-ref-sha-checkboxes.md`, `sha-truncation.md`, and
  `null-render-ref-sha.md`).

## Coverage

- FR-02: every attribute available to the user (including `ref`,
  `sha`).
- FR-04: drawer is the full-fidelity detail surface.
- FR-12: matrix picker constrains only the matrix grid.
- SAD §7 "Full-attribute disclosure rule" — the user's explicit
  contract.
- SAD §7 "Null-render invariant for nullable attributes" — empty
  render, never the literal `"null"`.
