# Theme switcher — gear popover open + select

**Intent:** the gear icon in the header opens a popover with three
radio options (Light / Dark / Auto); clicking each option live-updates
the `data-theme` attribute on `<html>` without a navigation. The
switcher is present in the header alongside the existing View / Layout
switchers.

## Citations

- `docs/deployment-dashboard.html` lines 1108–1145 — the
  `data-testid="theme-switcher"` container, gear button
  (`data-testid="theme-gear"`) with `aria-expanded`, and the three
  radio options (`data-testid="theme-option-{light|dark|auto}"`).
- `docs/ui-theme-options.md` "Switcher affordance — gear icon +
  popover" + "Three orthogonal axes" table.
- `docs/cr/CR-0006-light-dark-auto-theme.md` "Theme axis
  (presentation-only)" subsection.

## Preconditions

- Stack up. Seeded corpus loaded.
- `localStorage` cleared in `beforeEach` so the popover starts from
  the default `'auto'` preference.
- `emulateMedia({ colorScheme: 'light' })` so the OS-reported value
  is deterministic and `auto` initially resolves to `light`.

## Steps

1. **Given** the SPA is loaded and the test has cleared
   `localStorage` + reloaded,
2. **Then** `[data-testid="theme-switcher"]` is visible in the header,
3. **And** `[data-testid="theme-gear"]` is visible and reports
   `aria-expanded="false"`,
4. **And** the popover (containing `[data-testid^="theme-option-"]`)
   is not visible.
5. **When** the test clicks `[data-testid="theme-gear"]`,
6. **Then** `aria-expanded` flips to `"true"`,
7. **And** all three options become visible:
   `theme-option-light`, `theme-option-dark`, `theme-option-auto`.
8. **When** the test clicks `[data-testid="theme-option-dark"]`,
9. **Then** `<html data-theme="dark">` AND
   `<html data-theme-pref="dark">` within 250 ms,
10. **And** no navigation has occurred (page URL unchanged; no full
    reload — assert by checking a marker installed earlier via
    `addInitScript` is still present on `window`).
11. **When** the test clicks `[data-testid="theme-option-light"]`,
12. **Then** `<html data-theme="light">` AND
    `<html data-theme-pref="light">`.
13. **When** the test clicks `[data-testid="theme-option-auto"]`,
14. **Then** `<html data-theme-pref="auto">` AND `data-theme` resolves
    to the OS-emulated value (`"light"` in this test because of the
    `emulateMedia({ colorScheme: 'light' })` precondition).
15. **And** the gear button's `title` attribute matches the format
    `Theme: {pref} · effective {eff}` (case-insensitive substring
    check is sufficient — we are not asserting the exact label text,
    just that both the pref and effective values are present).

## Expected results

- Three radio options render under `data-testid` hooks
  `theme-option-{light|dark|auto}`.
- Clicking any option flips `<html data-theme>` and
  `<html data-theme-pref>` synchronously (no reload).
- The gear's `aria-expanded` mirrors the popover open/closed state.
- The popover footer (live "Effective {eff} · OS {dark|light}"
  line) is visible while the popover is open and contains both
  current effective value and OS value as plain text — assert
  presence, not exact wording.

## Out of scope

- Persistence across reload — covered by
  `theme-switcher-persists-across-reload.md`.
- Auto resolution + live OS flips — covered by
  `theme-switcher-auto-follows-os-preference.md`.
- FOIT-safe initial paint — covered by
  `theme-switcher-foit-safe-initial-paint.md`.

## Coverage

- `docs/deployment-dashboard.html` lines 1108–1145 — theme switcher
  affordance contract (`data-testid`s + `aria-expanded`).
- `docs/ui-theme-options.md` "Switcher affordance — gear icon +
  popover" section.
- `docs/cr/CR-0006-light-dark-auto-theme.md` Theme axis subsection.
