# CR-0006 — Light / Dark / Auto theme axis

- **Status:** accepted
- **Trigger:** `TODO` line 9 — "UX: Add ability to switch to light/dark/auto theme, propose options by making new mockups".
- **Change:** The SPA exposes a **Theme** control — a header gear icon that opens a popover with three radios: `light`, `dark`, `auto` (default `auto`). The control is **orthogonal** to View (FR-12) and Layout (FR-13); all (view × layout × theme) combinations render correctly. Theme controls **palette only** — no data shape change, no wire field, no effect on the 6-box-state contract, no effect on NFR-09 geometric invariants.

  - `auto` follows the OS-reported `prefers-color-scheme` setting via a `MediaQueryList` listener; the user's explicit `light` or `dark` choice overrides the OS preference.
  - Theme preference persists in `localStorage` under `dashboard.theme`.
  - The initial paint is FOIT-safe: an inline `<script>` at the top of `<head>` (before the SPA bundle) reads `localStorage` and the OS preference synchronously and applies `data-theme` to `<html>` before any frame is committed. **The decision record for the persistence + bootstrap mechanism lives in `ADR-0003`** (this CR records the requirement; ADR-0003 records the architecture).
  - A single-writer invariant binds the runtime: exactly one Angular service (the `ThemeService` in `frontend/shared/`) is the sole writer of `<html data-theme>` and `<html data-theme-pref>` after the inline bootstrap paints the first frame. No feature library, no component, and no other service may mutate either attribute.

- **Impact:**
  - **§7 Visual layout → Theme axis (presentation-only)** — new subsection (verbatim text captured below).
  - **§7 Visual layout → Client-side persistence (`localStorage`)** — new key `dashboard.theme` (allowed values `'light'`, `'dark'`, `'auto'`; default `'auto'`).
  - **§7 Visual layout → Load-time hardening rules** — new `dashboard.theme` parse-time fallback rule for out-of-set persisted values (verbatim text below).
  - **NFR-09 (UX-RESPONSIVENESS INVARIANT)** — extended to include the theme axis ("every View × Layout × Theme combination") in the sibling-invariant text (see CR-0003 for the amended invariant covering layout; this CR contributes the Theme dimension to the same enumeration).
  - **Mockup** (`docs/deployment-dashboard.html`) — header gear icon + popover; `[data-theme="dark"]` CSS overlay; FOIT-safe inline bootstrap; Alpine root carries `themePref / effectiveTheme / osDark / themePopoverOpen` state + a `MediaQueryList` listener (canonical visual contract).
- **References:**
  - SAD §4 FR-12 (View axis — orthogonal peer).
  - SAD §4 FR-13 (Layout axis — orthogonal peer).
  - SAD §5 NFR-09 (UX-RESPONSIVENESS INVARIANT — extended via the View × Layout × Theme enumeration).
  - SAD §7 "Visual layout → Theme axis (presentation-only)".
  - SAD §7 "Visual layout → Client-side persistence (`localStorage`)" — new key `dashboard.theme`.
  - **ADR-0003 — Theme persistence in `localStorage` with FOIT-safe inline bootstrap** (paired).
  - `docs/ui-theme-options.md` — design rationale (Dim palette, gear popover, status-colour mappings).

## SAD-level content owned by this CR — verbatim

### §7 "Theme axis (presentation-only)" — verbatim

> **Theme axis (presentation-only):** Orthogonal to View and Layout, the SPA exposes a Theme control (gear icon → popover; values `light` / `dark` / `auto`, default `auto`). Theme controls palette only — no data shape, no wire field, no effect on the 6-box-state contract or NFR-09 geometric invariants. The mockup (`docs/deployment-dashboard.html`) is the visual contract; persistence is `dashboard.theme` in the `localStorage` table above.
>
> - **Single-writer invariant.** After the FOIT-safe inline bootstrap in the dashboard `index.html` paints the first frame, exactly one Angular service (the `ThemeService` in `frontend/shared/`) is the sole writer of the `<html data-theme>` and `<html data-theme-pref>` attributes. No feature library, no component, and no other service may mutate either attribute. Consumers that need to react to palette MUST read the `effective` / `preference` signals exposed by that service. The mockup analogue is the Alpine root's `applyEffectiveTheme()` method.
> - **Corruption normalisation.** A persisted `dashboard.theme` value that is not one of `{light, dark, auto}` resolves to the default `auto` for the current session. The SPA MUST NOT silently rewrite `localStorage` on a read-only load — the corrupt value remains until the next user-driven preference change overwrites it. Debuggability over correctness: a corrupt value is observable for incident review.
> - **Mockup ↔ implementation naming parity.** Identifier shapes need not be byte-identical between the mockup's Alpine root and the Angular implementation — the mockup is a prototype, the Angular code is the canonical implementation. Drift is allowed where the implementation idiom differs (e.g. mockup `setThemePref(id)` ↔ Angular `ThemeService.setPreference(id)`). Wire-shape names (JSON fields, query parameters, `localStorage` keys) and user-visible labels MUST remain identical; method names, internal helper names, and signal names MAY differ to suit each runtime's conventions.

### `dashboard.theme` — `localStorage` key (verbatim row)

| Key | Value shape | Example | Cap |
|---|---|---|---|
| `dashboard.theme` | one of `'light'`, `'dark'`, `'auto'` (string) | `"auto"` | n/a |

### `dashboard.theme` — load-time hardening rule (verbatim)

> For `dashboard.theme`: if the persisted string is not in the allowed set, fall back to the default (`auto`). No throw — `localStorage.getItem` returns a string or `null`.
