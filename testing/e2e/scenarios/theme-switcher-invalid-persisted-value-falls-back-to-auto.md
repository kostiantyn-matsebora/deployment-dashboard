# Theme switcher — invalid persisted value falls back to `auto`

**Intent:** any value other than the three enum members
(`light` / `dark` / `auto`) persisted under `dashboard.theme`
resolves to the default `'auto'`, which then derives the effective
palette from `prefers-color-scheme`.

## Citations

- `docs/ui-theme-options.md` "Persistence" table — "Unknown enum
  value → 'auto'."
- `docs/deployment-dashboard.html` lines 187–198 — the FOIT-safe
  bootstrap script validates the persisted value against the literal
  set `'light' / 'dark' / 'auto'` and falls back to `'auto'` on any
  other value (including unparseable garbage).
- `docs/deployment-dashboard-architecture.md` §7 — `dashboard.theme`
  row in the localStorage persistence table; load-time hardening rule
  ("missing or corrupt values fall back to default").

## Preconditions

- Stack up + seeded corpus.
- The test installs `addInitScript` to set
  `localStorage['dashboard.theme'] = 'garbage'` BEFORE navigation,
  so the inline bootstrap reads the corrupt value on first paint.
- `emulateMedia({ colorScheme: 'dark' })` so the OS-emulated value
  is deterministic; a correctly-implemented fallback resolves to
  `data-theme="dark"`.

## Steps

1. **Given** `localStorage.dashboard.theme === 'garbage'` is seeded
   before navigation,
2. **And** `emulateMedia({ colorScheme: 'dark' })`,
3. **When** the test navigates to `/`,
4. **Then** `<html data-theme="dark">` (fell back to `auto`, which
   resolved via OS preference to `dark`),
5. **And** `<html data-theme-pref="auto">` (corrupt pref replaced
   with default).
6. **Repeat** for several pathological seeds: `'GARBAGE'` (case
   mismatch), `'{"theme":"dark"}'` (JSON), `''` (empty string),
   `'system'` (plausible-but-not-in-enum). Each must yield
   `data-theme-pref="auto"`.
7. **Repeat** the entire flow with
   `emulateMedia({ colorScheme: 'light' })` — every fallback to
   `auto` must then resolve to `data-theme="light"`.

## Expected results

- Every non-enum persisted value falls back to `auto`.
- After fallback, `data-theme` is derived from
  `prefers-color-scheme` (we control via `emulateMedia`).
- `data-theme-pref` is normalised to `'auto'` — the corrupt original
  value is NOT preserved on the dataset.

## Out of scope

- Whether the corrupt value is OVERWRITTEN in localStorage on the
  first user interaction — the contract doesn't strictly require
  this; the inline bootstrap only normalises the dataset
  attributes. Re-writing on first user action is an implementation
  detail not pinned by the docs.

## Coverage

- `docs/ui-theme-options.md` "Persistence" table — "Unknown enum
  value → 'auto'.".
- `docs/deployment-dashboard.html` head bootstrap validation logic.
- `docs/deployment-dashboard-architecture.md` §7 — `dashboard.theme`
  localStorage row + load-time hardening rule.
