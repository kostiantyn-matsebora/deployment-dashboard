# Theme switcher — FOIT-safe initial paint

**Intent:** the dashboard's first frame paints in the persisted palette
(no flash of incorrect theme). Done by an inline `<head>` script that
runs synchronously before Angular bootstraps and sets `data-theme` /
`data-theme-pref` on `<html>` from `localStorage['dashboard.theme']`
+ `prefers-color-scheme`.

## Citations

- `docs/ui/deployment-dashboard.html` head comment block (lines 175–198)
  — FOIT-safe theme bootstrap and the `data-theme` / `data-theme-pref`
  dataset hooks.
- `docs/ui/theme-options.md` "Auto resolution" §1 ("Initial paint —
  inline `<script>` block at the top of `<head>` … sets `data-theme`
  on `<html>` immediately. No flash.").
- `docs/cr/CR-0006-light-dark-auto-theme.md` — new `dashboard.theme`
  row in the localStorage persistence table; new Theme axis
  subsection.
- `docs/adr/ADR-0003-theme-persistence-and-foit-safe-bootstrap.md` —
  FOIT-safe inline bootstrap decision (load-time hardening +
  corruption normalisation).

## Preconditions

- Stack up via `dev_env/start.ps1` and seeded with the canonical
  corpus (`testing/scripts/seed.ps1`).
- The test sets `localStorage['dashboard.theme']` via
  `page.addInitScript(...)` BEFORE navigation so the inline boot
  script observes the persisted value on its first run.
- The test does NOT depend on the Angular SPA reaching steady state
  — the assertion runs immediately on `domcontentloaded`.

## Steps

1. **Given** the test installs an init script that writes
   `'dark'` to `localStorage['dashboard.theme']` before navigation,
2. **When** the test navigates to `/` and waits for `domcontentloaded`,
3. **Then** `<html data-theme="dark">` is observable BEFORE any
   Angular content renders (the inline bootstrap has already run),
4. **And** `<html data-theme-pref="dark">` carries the persisted
   preference,
5. **And** the same holds for `'light'` (set via init script,
   observe `data-theme="light"`).
6. **And** for `'auto'`: the test installs the init script to set
   `'auto'`, calls `page.emulateMedia({ colorScheme: 'dark' })`
   before navigation, then asserts `data-theme="dark"` on first paint
   (auto resolved through the OS dark preference).
7. **And** with `emulateMedia({ colorScheme: 'light' })` + persisted
   `'auto'`, the test asserts `data-theme="light"` on first paint.

## Expected results

- `document.documentElement.getAttribute('data-theme')` matches the
  expected effective palette (`light` / `dark`) on first paint, before
  any Angular SPA content has been rendered.
- `document.documentElement.getAttribute('data-theme-pref')` matches
  the persisted preference verbatim (`light` / `dark` / `auto`).
- No transition / flicker between `light` and `dark` is observable —
  the very first paint is already in the correct palette.

## Out of scope

- Live OS-preference flips after the SPA is loaded — covered by
  `theme-switcher-auto-follows-os-preference.md`.
- The popover affordance — covered by
  `theme-switcher-popover-open-and-select.md`.
- Perceptual contrast thresholds (WCAG AA — manual smoke concern,
  not automatable here).

## Coverage

- `docs/ui/deployment-dashboard.html` head FOIT-safe bootstrap block.
- `docs/ui/theme-options.md` "Auto resolution" §1 (initial paint).
- `docs/cr/CR-0006-light-dark-auto-theme.md` — `dashboard.theme`
  localStorage row.
- `docs/adr/ADR-0003-theme-persistence-and-foit-safe-bootstrap.md` —
  FOIT-safe inline bootstrap.
