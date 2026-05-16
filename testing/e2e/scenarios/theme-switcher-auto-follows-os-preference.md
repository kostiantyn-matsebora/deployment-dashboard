# Theme switcher — auto follows the OS preference (live)

**Intent:** when the persisted preference is `'auto'`, the effective
palette tracks `prefers-color-scheme` both at initial paint AND when
the OS preference flips mid-session. Conversely, when the persisted
preference is `'light'` or `'dark'`, an OS flip does NOT change the
effective palette — the user's explicit choice wins.

## Citations

- `docs/ui-theme-options.md` "Auto resolution" §2 ("Live OS-level
  changes — the Alpine component registers a `change` listener on the
  `MediaQueryList` … no reload required.") + "The user's choice of
  `light` or `dark` overrides the OS preference; only `auto` listens."
- `docs/deployment-dashboard.html` lines 3450–3461 — `change` event
  handler registered on
  `window.matchMedia('(prefers-color-scheme: dark)')`, only re-resolves
  when `themePref === 'auto'`.
- `docs/deployment-dashboard-architecture.md` §7 Theme axis subsection.

## Preconditions

- Stack up + seeded corpus.
- `localStorage` cleared in `beforeEach`.

## Steps

### Case A — auto + initial OS=light

1. **Given** `localStorage.dashboard.theme === 'auto'` (default),
2. **And** `emulateMedia({ colorScheme: 'light' })` before navigation,
3. **When** the test navigates to `/`,
4. **Then** `data-theme="light"` AND `data-theme-pref="auto"`.

### Case B — auto + OS flips to dark mid-session

5. **Given** the SPA is loaded under the conditions of Case A
   (`pref=auto`, `data-theme=light`),
6. **When** the test calls `emulateMedia({ colorScheme: 'dark' })`,
7. **Then** within 500 ms, `<html data-theme="dark">` AND
   `<html data-theme-pref="auto">` (preference unchanged; effective
   flipped),
8. **And** no navigation occurred (assert via a `window` marker
   installed before the flip).

### Case C — auto + OS flips back to light

9. **When** the test calls `emulateMedia({ colorScheme: 'light' })`
   again,
10. **Then** within 500 ms, `<html data-theme="light">` AND
    `<html data-theme-pref="auto">`.

### Case D — explicit dark + OS flips light → does NOT change

11. **Given** the test sets pref to `'dark'` via the gear popover
    (so `data-theme-pref="dark"`, `data-theme="dark"`),
12. **When** the test calls `emulateMedia({ colorScheme: 'light' })`,
13. **Then** `<html data-theme="dark">` STILL (no change — explicit
    pref wins over OS preference per the contract).
14. **Then** `<html data-theme-pref="dark">` STILL.

### Case E — explicit light + OS flips dark → does NOT change

15. **Given** the test sets pref to `'light'`,
16. **When** the test calls `emulateMedia({ colorScheme: 'dark' })`,
17. **Then** `<html data-theme="light">` STILL.

## Expected results

- Auto: OS flips drive `data-theme` flips live (no reload), preference
  attribute unchanged.
- Explicit Light / Dark: OS flips are ignored — the explicit
  preference is the binding effective palette.
- No navigation / reload happens during any flip — the
  `MediaQueryList` change listener mutates `data-theme` in place.

## Out of scope

- Auto resolution at first paint without any OS emulation — covered
  by `theme-switcher-foit-safe-initial-paint.md`.
- Popover open/select interaction — covered by
  `theme-switcher-popover-open-and-select.md`.

## Coverage

- `docs/ui-theme-options.md` "Auto resolution" §2 + "The user's
  choice of `light` or `dark` overrides the OS preference; only
  `auto` listens.".
- `docs/deployment-dashboard.html` MQL change listener (lines
  3450–3461).
