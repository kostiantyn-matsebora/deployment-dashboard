# `sha` is truncated to first 7 chars + ellipsis on the matrix grid; full value lives in `title` and the drawer

**Intent:** the matrix-grid rendering of the `sha` attribute is the
conventional Git short-sha — first 7 characters of the value, followed
by a single `…` ellipsis when the underlying value is longer than 7.
The full value remains accessible via the slot's `title` (HTML
tooltip) and is rendered untruncated in the history drawer. This
matches the SAD §7 "Attribute vocabulary" sha row:
"The SPA MAY truncate the rendered value for display (e.g. first 7
chars) without altering the underlying stored value; the full value
remains in the history drawer."

## Citations

- `docs/deployment-dashboard-architecture.md` §7 "Attribute
  vocabulary" — `sha` row, truncation clause + full-attribute
  disclosure rule.
- `docs/deployment-dashboard-architecture.md` §7 "Full-attribute
  disclosure rule" — drawer always shows the full value.
- `docs/deployment-dashboard.html` head comment "SHA TRUNCATION RULE"
  — conventional short-sha is 7 chars; ellipsis when the underlying
  value is longer.

## Preconditions

- Stack up, canonical 6-state corpus seeded.
- `localStorage` cleared at the start of the test.
- Page on **Detailed** view (cap 7), picker opened, `sha` checked.
- Fixtures exercised:
  - `service-b/dev` — `sha: "9f1c0d2e8a"` (10 chars; truncates).
  - `service-d/dev` — latest event has no sha; `sha-correlated`
    fixtures have `sha: "a1b2c3d4e5f6"` (12 chars; truncates) — used
    by the topology-correlation tests but also visible in the
    matrix for this assertion.
  - A POSTed test row with a 7-char sha — exercises the boundary
    case (exactly 7 chars must render verbatim with NO ellipsis).

## Steps

### Part 1 — Long sha is truncated to first 7 chars + ellipsis

1. **Given** the SPA on Detailed view with `sha` selected (counter
   reads `6/7`).
2. **When** the test reads the text of
   `[data-testid="current-sha-service-b-dev"]`,
3. **Then** the rendered text is exactly `9f1c0d2…` (first 7 chars
   `"9f1c0d2"` + single ellipsis character `…`),
4. **And** the `title` attribute on the same element is the full
   value `9f1c0d2e8a` (HTML tooltip on hover; users without a mouse
   open the drawer to see the full value),
5. **And** the rendered text length is exactly 8 chars (7 + the
   ellipsis), not 10 (the full value's length).

### Part 2 — Exactly-7-char sha renders verbatim (no ellipsis)

6. **Given** a 7-char sha value (`abc1234`) is POSTed for an ephemeral
   service `qa-bot-sha-7char-<run-suffix>`,
7. **When** the test waits for the matrix to reflect the event and
   selects `sha`,
8. **Then** the rendered text of
   `[data-testid="current-sha-qa-bot-sha-7char-<suffix>-fn-sha7"]`
   is exactly `abc1234` (no ellipsis appended),
9. **And** the `title` attribute is also `abc1234` (full value =
   rendered value).

### Part 3 — Drawer shows the full value (no truncation)

10. **When** the test clicks the stage box for `service-b/dev`,
11. **Then** the drawer opens and
    `[data-testid="drawer-current-sha"]` text is exactly
    `9f1c0d2e8a` (full value, no ellipsis).

## Expected results

- Grid render of `current.sha`:
  - if `len(value) > 7` → first 7 chars + `…` (one Unicode ellipsis
    character; precisely 8 chars total).
  - if `len(value) ≤ 7` → the value verbatim.
  - `title` attribute is the full value in both cases.
- Drawer render of `current.sha` is the full value, untruncated.

## Out of scope

- Validation of the sha format (hex, length) — SAD §10 Decision #10
  defers validation; any string is allowed.
- The matrix-grid render of `ref` (no truncation — refs may legally
  be long, the SAD does not mandate truncation).
- Layout regression checks — covered by `spa-visual-invariants.md`.

## Coverage

- SAD §7 "Attribute vocabulary" — sha truncation clause.
- SAD §7 "Full-attribute disclosure rule" — drawer keeps the full
  value.
- FR-02 (sha is a first-class attribute).
- FR-05 (sha is the optional commit-hash field).
