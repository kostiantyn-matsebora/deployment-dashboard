# ADR-0003 — Theme persistence in `localStorage` with FOIT-safe inline bootstrap

- **Status:** accepted
- **Context:** CR-0006 introduced a third orthogonal UX axis — Theme — with three values (`light` / `dark` / `auto`) and the default `auto`. Two architectural questions arise:
  1. **Where does the preference live?** Two options: server (per-user account or anonymous session) or client (`localStorage`).
  2. **How is the first paint themed correctly without a flash of incorrect theme (FOIT)?** The SPA bundle's JS does not run until the bundle is parsed and the framework boots; if the theme is applied at that point the user sees the default theme for one or two frames first.

  Constraints:
  - **NFR-05 (stateless backend)** — server-side per-user state requires a session model and a user-identity model. The dashboard has no user-identity model (§8 — read endpoints are unauthenticated; auth is delegated to a sidecar). Adding one for a palette preference is over-engineering.
  - **NFR-04 (internal-only; SPA ships no API key)** — server-side mutation of theme preference would need an auth path, and the SPA does not carry an API key. Reusing the write-side `X-Api-Key` for a palette toggle would punch a hole in the auth surface for cosmetic reasons.
  - **NFR-08 (no build step in the browser)** — the bootstrap must run in plain JS in the HTML head; no transpiler, no module loader, no framework.
  - **Mockup ↔ SPA parity (CR-0006 single-writer invariant)** — after bootstrap, exactly one writer mutates `<html data-theme>` / `<html data-theme-pref>`. The mechanism must scale from the mockup (Alpine.js root) to the Angular SPA (`ThemeService` in `frontend/shared/`).

- **Decision:**
  1. **Preference lives in `localStorage`** under the key `dashboard.theme` (allowed values: `'light'`, `'dark'`, `'auto'`). This co-locates Theme with View, Layout, attribute-picker, and correlation-attribute preferences — all are per-browser preferences (already part of the `dashboard.*` `localStorage` namespace).
  2. **First paint is themed by an inline `<script>` block at the top of `<head>`**, BEFORE the Tailwind CDN + Alpine.js script tags (mockup) and BEFORE the Angular bundle (SPA). The script:
     - Reads `localStorage.getItem('dashboard.theme')` synchronously.
     - If the value is `'light'` or `'dark'`, sets `<html data-theme="…">` and `<html data-theme-pref="…">` immediately.
     - If the value is `'auto'`, missing, or any other string, reads `window.matchMedia('(prefers-color-scheme: dark)').matches` synchronously and sets `<html data-theme="dark"|"light">` and `<html data-theme-pref="auto">`.
     - Triggers NO layout, NO async work, NO framework code — pure synchronous DOM attribute set before the first frame is committed.
  3. **After the first frame, exactly one writer** is the `ThemeService` in `frontend/shared/` (mockup analogue: Alpine root's `applyEffectiveTheme()` method). It exposes `effective` (one of `light` / `dark`) and `preference` (one of `light` / `dark` / `auto`) signals; consumers read these signals — no other service or component mutates `<html data-theme>` or `<html data-theme-pref>`.
  4. **`auto` listens for OS-level changes** via a `MediaQueryList` returned by `window.matchMedia('(prefers-color-scheme: dark)')`. When the OS preference flips and `preference === 'auto'`, the writer recomputes `effective` and updates the `<html>` attributes — no reload required. The user's explicit `light` / `dark` choice overrides the OS preference.
  5. **Corruption normalisation is read-only.** A persisted value not in `{light, dark, auto}` resolves to `auto` for the current session; the SPA MUST NOT silently rewrite `localStorage` on a read-only load — debuggability over correctness. The corrupt value remains until the next user-driven preference change overwrites it.

- **Consequences:**
  - **No server-side state, no auth boundary expansion.** The Read API is not extended; the Write API is not extended. NFR-04 holds; NFR-05 holds.
  - **No FOIT.** The user never sees the wrong palette: the `<html data-theme>` attribute is set before the first paint by inline JS that runs before the framework boots.
  - **The palette switch is CSS-only at runtime.** A single `[data-theme="dark"]` block in the stylesheet remaps each Tailwind utility class to its Dark equivalent. NO leaf renderer DOM changes; NO Tailwind class string rewrites; NO geometric invariant (NFR-09) is touched.
  - **Cross-tab synchronisation is not provided in this cycle.** Two tabs of the dashboard with `preference === 'auto'` will agree (they both read OS state); two tabs with different explicit preferences disagree by design. A `storage` event listener could add cross-tab sync; deferred — not a stated requirement.
  - **Per-user / per-account preference (e.g. theme follows the user across machines) is out of scope.** When the dashboard adopts a user-identity model in a future cycle, this ADR is superseded by an ADR that introduces a `GET /api/preferences` / `PATCH /api/preferences` endpoint and migrates the read path.
  - **`prefers-contrast: more` is not handled.** Deferred — would expand the enum to four values; revisit if any user reports the dark palette feels under-contrasty.
  - **Single-writer invariant is enforceable in code.** `ThemeService` is the only `public` writer of the `<html>` attributes in `frontend/shared/`; lint or unit tests can assert this. The mockup's Alpine root holds the same role (`applyEffectiveTheme()`).
  - **NFR-09 (UX-RESPONSIVENESS) extension** — the responsiveness invariant now reads "every View × Layout × Theme combination"; theme palette swaps are purely visual and do not break geometric invariants (verified by the mockup-visual harness across `data-theme="light"` and `data-theme="dark"`).

- **References:**
  - **CR-0006** — Light / Dark / Auto theme axis (the requirement).
  - SAD §7 "Visual layout → Client-side persistence (`localStorage`)" — `dashboard.theme` key (added by CR-0006).
  - SAD §7 "Visual layout → Theme axis (presentation-only)" — single-writer invariant, corruption normalisation, mockup-vs-implementation parity (added by CR-0006).
  - SAD §5 NFR-09 — sibling invariant covers all three axes (View × Layout × Theme).
  - SAD §8 (Security Considerations) — internal-only, no user-identity model; supports the "no server-side per-user state" decision.
  - `docs/ui-theme-options.md` — palette choice (Dim), status-colour mappings, gear-popover affordance design.
