# Theme switcher — persists across reload

**Intent:** the user's choice of theme is written to
`localStorage['dashboard.theme']` and survives a full page reload.

## Citations

- `docs/ui-theme-options.md` "Persistence" table — key
  `dashboard.theme`, default `'auto'`, valid values `light / dark /
  auto`.
- `docs/cr/CR-0006-light-dark-auto-theme.md` — `dashboard.theme` row
  in the localStorage persistence table (persistence semantics +
  load-time hardening detailed in
  `docs/adr/ADR-0003-theme-persistence-and-foit-safe-bootstrap.md`).
- `docs/deployment-dashboard.html` head bootstrap block (lines
  187–198) — reads `localStorage.getItem('dashboard.theme')` on first
  paint.

## Preconditions

- Stack up + seeded corpus.
- `localStorage` cleared in `beforeEach`.
- `emulateMedia({ colorScheme: 'light' })` for determinism.

## Steps

1. **Given** a first-time visitor (cleared `localStorage`) lands on
   the SPA,
2. **Then** `data-theme-pref="auto"` AND `localStorage.dashboard.theme`
   is either absent or `'auto'`.
3. **When** the test clicks gear → `theme-option-dark`,
4. **Then** `localStorage.getItem('dashboard.theme') === 'dark'`
   immediately (no debouncing).
5. **When** the test reloads the page,
6. **Then** `<html data-theme="dark">` AND
   `<html data-theme-pref="dark">` (no flash back to default),
7. **And** `localStorage.getItem('dashboard.theme') === 'dark'` still.
8. **Repeat** steps 3–7 for `theme-option-light`.
9. **Repeat** steps 3–7 for `theme-option-auto`.
10. **And** when persisted is `'auto'` after reload, the effective
    palette is whatever the OS emulation says — `'light'` in this test.

## Expected results

- The localStorage key `dashboard.theme` matches the most-recent
  click verbatim, synchronously on click.
- Reload restores both `data-theme` and `data-theme-pref` with NO
  intermediate frame in the default palette.
- All three values (`'light'`, `'dark'`, `'auto'`) round-trip.

## Out of scope

- Behaviour for corrupt persisted values — covered by
  `theme-switcher-invalid-persisted-value-falls-back-to-auto.md`.
- Live OS-preference flips while `auto` is active — covered by
  `theme-switcher-auto-follows-os-preference.md`.

## Coverage

- `docs/ui-theme-options.md` "Persistence" table.
- `docs/cr/CR-0006-light-dark-auto-theme.md` — `dashboard.theme`
  localStorage row.
- `docs/adr/ADR-0003-theme-persistence-and-foit-safe-bootstrap.md` —
  persistence semantics + FOIT-safe bootstrap.
