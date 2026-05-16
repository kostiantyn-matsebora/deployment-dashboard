# Progress Snapshot — 2026-05-16 (end of session, TODO line 9 light/dark/auto theme closed)

Resume point. Read `CLAUDE.md` first; this is a working snapshot, not authoritative.

## One-line status

Theme axis (`{light, dark, auto}`) added to the SPA: Dim palette merged into the canonical mockup as the `dark` value behind a gear-popover affordance; `ThemeService` + `ThemeSwitcherComponent` shipped in `frontend/shared/` with FOIT-safe inline bootstrap, live MQL listener, and single-writer `<html data-theme>` invariant; SAD §7 Theme axis subsection extended (single-writer rule + corruption normalisation + mockup ↔ implementation naming parity). CLAUDE.md gained a new top-level "Task lifecycle — phased pipeline with maximum parallelism" section (8 phases including a new human-in-the-loop design-review gate); 136/136 frontend-shared unit tests green; 6 e2e scenarios + 6 Playwright specs authored against the contract; build clean.

## Cycle closed this session

### Cycle F — Theme axis (TODO line 9)

Full eight-phase execution against the new lifecycle:

| Phase | Agent | Deliverable |
|---|---|---|
| 1 — Analysis | `frontend-engineer` | Scoped Light / Dark / Auto + identified Theme as a third orthogonal axis alongside View and Layout. |
| 2 — Design & architecture | `frontend-engineer` (visual) | Three option mockups (`deployment-dashboard-theme-slate.html`, `-oled.html`, `-dim.html`) + `docs/ui-theme-options.md` design note: persistence table, auto-resolution spec, palette table, tradeoff rationale. Recommendation: Slate (textual segmented) — user picked Dim (gear popover). |
| 3 — Design review (user) | user | Picked Dim option. Approved merge. |
| 4 — Implementation | `frontend-engineer` (in parallel with phase 5) | Merged Dim palette into canonical `docs/deployment-dashboard.html` (+416 lines: `[data-theme="dark"]` overlay, FOIT-safe head script, MQL listener, gear+popover, THEMES const, Alpine state + setters); deleted the three option forks. Angular wiring: `ThemeService` (root, signal-based) + `ThemeSwitcherComponent` (gear + popover, `data-testid` hooks) in `frontend/shared/`; FOIT-safe inline script in `frontend/dashboard/src/index.html`; CSS overlay in `styles.css`; eager bootstrap in `main.ts`; `dashboard-header.component.ts` renders the switcher. Tailwind config annotated overlay-only strategy. |
| 5 — Testing | `qa-engineer` (in parallel with phase 4) | 6 e2e Markdown scenarios + 6 Playwright `.spec.ts` files under `testing/e2e/` (FOIT-safe initial paint; popover open + select; reload persistence; auto follows OS; invalid persisted value falls back to auto; 6-box-state contract under dark). `theme.service.spec.ts` + `theme-switcher.component.spec.ts` co-located in `frontend/shared/src/lib/`. |
| 6 — Bug fixing | parallel | `frontend-engineer`: `isThemePreferenceerence` typo → `isThemePreference` in `view-config.ts`. `qa-engineer`: deleted stale `frontend/karma.conf.js` (referenced unexported `@angular/build/plugins/karma`); renamed `theme-prefs.service.spec.ts` → `theme.service.spec.ts`. `frontend-engineer`: stale doc-comment in `theme.service.ts:14`. |
| 7 — SA review | `solution-architect` | **PASS with one flag** (manual smoke owed). Rulings landed: component stays in `frontend/shared/` (palette is cross-cutting); mockup ↔ implementation naming drift permitted for internal identifiers, required-identical for wire shapes + user-visible labels. SAD §7 Theme axis subsection extended with single-writer invariant + corruption-normalisation + mockup ↔ implementation naming parity. NFR-09 confirmed palette-agnostic by construction (overlay touches only colour properties; no layout-relevant property). |
| 8 — User approval | user | TODO line 9 → ☒. Manual browser smoke deferred to user (env lacks browser). |

### Cycle G — CLAUDE.md lifecycle codification

After the theme cycle, user gave process feedback that promoted from feedback memory to a permanent CLAUDE.md rule:

| Edit | Section | Effect |
|---|---|---|
| New section | `## Task lifecycle — phased pipeline with maximum parallelism` (lines 195–250) | 8-phase pipeline; parallelism rules (within-phase + cross-phase overlap); dispatch pattern; cross-reference to four-phase cross-domain-bug cycle. |
| Amendment | Phase 2 sub-deliverables | Added **API design** alongside system design, visual design, implementation plan. Ownership: backend-engineer (HTTP/JSON), frontend-engineer (SPA-visible), solution-architect (ratifies into SAD). |
| Amendment | New Phase 3 row | Inserted **Design review — user approval gate** between Design & architecture and Implementation. Synchronous; user signs off on phase-2 artefacts (SAD diff, mockup, API contract, WBS) before implementation starts. Phases 3–7 renumbered to 4–8. |
| Reframe | Why-line | "Work like a real engineering team" promoted from cultural framing to operational guidance — apply established software-engineering best practices (separation of concerns, contract-driven parallelism, testing as a first-class deliverable, fail-fast on contract drift, no idle agents). |

## SAD edits landed this session

| Section | Change |
|---|---|
| §7 `localStorage` persistence table | New `dashboard.theme` row (`'light'`/`'dark'`/`'auto'`, default `'auto'`); load-time hardening bullet now lists `dashboard.theme`. |
| §7 (new subsection) | **Theme axis (presentation-only)** — orthogonal to View and Layout, palette only, no effect on 6-box-state contract or NFR-09. |
| §7 Theme axis | Single-writer invariant — `ThemeService` is the only writer of `<html data-theme>` / `<html data-theme-pref>` after FOIT-safe bootstrap. |
| §7 Theme axis | Corruption normalisation — corrupt persisted value resolves to `'auto'` for the session; SPA MUST NOT silently rewrite `localStorage` on a read-only load. |
| §7 Theme axis | Mockup ↔ implementation naming parity — internal identifiers MAY drift; wire-shape names + user-visible labels MUST match. |

## Mockup edits landed this session

| Region | Change |
|---|---|
| `<head>` inline script | FOIT-safe synchronous palette bootstrap; reads `localStorage['dashboard.theme']`, validates enum, resolves `auto` via `prefers-color-scheme`, sets `<html data-theme="…">` before paint. |
| Theme axis head-comment block | New invariant block sibling to the existing UX-RESPONSIVENESS / NFR-09 block. |
| `[data-theme="dark"]` overlay | 84 dark-mode CSS overrides remapping Tailwind utility classes (`bg-white`, `bg-green-100`, `text-gray-900`, etc.) plus selectors `.arrow-line`, `.pill-empty`, `.lane-row`, `.svc-block`, `.edge`, `.env-tag`. Colour-only — no layout property touched. |
| Header | Gear icon + popover affordance with `data-testid` hooks `theme-switcher`, `theme-gear`, `theme-option-{light\|dark\|auto}`. |
| Alpine state | `themePref` / `effectiveTheme` / `osDark` / `themePopoverOpen` + `setThemePref` / `applyEffectiveTheme` + `$watch('themePref', …)` + persistence + MQL `change` listener wired into `bootstrapPersistence`. |

## CLAUDE.md edits landed this session

| Region | Change |
|---|---|
| New top-level section | "Task lifecycle — phased pipeline with maximum parallelism" — 8-phase table, parallelism rules, dispatch pattern, relation to cross-domain-bugs cycle. |
| Phase 2 row | API design added to sub-deliverables; ownership column expanded. |
| New phase 3 row | Design review — user approval gate. |
| Why-line | Reframed as binding operational guidance. |

## Test suite counts

| Suite | Count | Command |
|---|---|---|
| Frontend unit (shared lib only — `ng test shared --watch=false`) | **136 / 136** PASS | `cd frontend && npx ng test shared --watch=false` |
| Backend unit | **130 / 130** (unchanged — no backend work this cycle) | `dotnet test backend/Dashboard.sln` |
| Functional / API | **76 / 76** (unchanged) | `pwsh -NoProfile -File testing/functional/run-tests.ps1` |
| E2E (Playwright, chromium) | **79 + 6 new specs authored** | `pwsh -NoProfile -File testing/e2e/run-tests.ps1` |
| Mockup visual harness | **12 / 12** (unchanged — palette is overlay; harness palette-agnostic by construction per SA review) | `pwsh -NoProfile -File testing/mockup-visual/run-tests.ps1` |

E2E theme specs not yet run end-to-end (manual smoke pending; specs authored against the fixed contract, expected to pass once stack runs).

## Contract landmarks landed today

| Landmark | SAD anchor | Code anchor |
|---|---|---|
| Theme axis (`{light, dark, auto}`, default `auto`) | SAD §7 "Theme axis (presentation-only)" | `frontend/shared/src/lib/theme.service.ts` (single-writer); `frontend/dashboard/src/index.html` (FOIT-safe bootstrap) |
| Single-writer `<html data-theme>` | SAD §7 Theme axis → Single-writer invariant | `ThemeService` constructor effect — only mutator of `document.documentElement.dataset.theme` |
| Corruption normalisation policy | SAD §7 Theme axis → Corruption normalisation | `loadThemePreference()` validates against `THEMES`; falls back to `'auto'` without rewriting localStorage |
| Mockup ↔ implementation naming parity | SAD §7 Theme axis → Naming parity | Internal: `setThemePref` (mockup) ↔ `setPreference` (Angular) permitted; wire names identical (`dashboard.theme`, `data-testid="theme-*"`) |
| Task lifecycle — 8-phase pipeline | CLAUDE.md "Task lifecycle" | All future cycles run this pipeline |
| Design review gate (phase 3) | CLAUDE.md "Task lifecycle" → phase 3 row | Synchronous user approval between design and implementation |

## TODO status (`TODO` is canonical — file edited this session)

| # | Item | Status |
|---|---|---|
| 1 | Genericize service names | ☒ |
| 2 | UX: UI compactness + four-view picker (FR-12) | ☒ |
| 3 | UX: Tree-shaped promotion flow (Layout axis + topology) | ☒ |
| 4 | Add `ref` + `sha` attributes (data plane) | ☒ |
| 5 | UX: use `ref`/`sha` for Display + Topology | ☒ |
| 6 | Architecture: merge read+write APIs into one container | ☒ |
| 7 | **UX: light/dark/auto theme (this cycle)** | ☒ **closed this session** |
| 8 | UX: Version column width (long versions) | ☐ open — natural next pickup |
| 9 | Architecture: strict API validation + OpenAPI/Swagger | ☐ open |
| 10 | Architecture: optional CI/CD fetcher component (pull-mode alternative) | ☐ open |
| 11 | Architecture: Control API + periodic polling | ☐ open |
| 12 | Functionality: synchronization API (reconciliation + full) | ☐ open |
| 13 | UX: Rename "Workflow rows" → "Workflows" | ☐ open |
| 14 (Phase 2.0) | UX: group/colorize/correlate by attribute | ☐ open |

## Open follow-ups (non-blocking, surfaced during cycles)

1. **Manual browser smoke for the Theme axis** — env in this session has no browser. Owner: user (or next session with browser access). 7-step checklist surfaced in chat.
2. **Playwright DevTools-level smoke** — close the headless-integrator visual gap from prior cycle (E). Owner: `qa-engineer`. Pre-existing.
3. **Favicon 404** — cosmetic, surfaces in gateway access log during smoke. Owner: `frontend-engineer`. Pre-existing.
4. **`MapGroup` prefix semantic** — optional refactor; current `MapGroup(string.Empty).RequireApiKey()` is semantically identical to SAD §7's shorthand `MapGroup("/api").RequireApiKey()`. Pre-existing.
5. **Mockup drawer drift vs SPA drawer pattern** (pre-existing). Owner: `frontend-engineer`.
6. **Pre-existing e2e fragility**: no `localStorage.clear()` in `beforeEach`. Owner: `qa-engineer`. **Now more urgent** — theme e2e specs depend on a clean `dashboard.theme` slate.
7. **`docs/ui-compact-options.md` not cited in CLAUDE.md authoritative-files set**. Owner: `solution-architect`. Pre-existing.
8. **`docs/ci-cd-integration.md`** — pre-existing: ~9 sections needing `deployment_id` + `parent_deployments` additions. Modifications staged on disk from a prior session. Owner: `solution-architect`. Pre-existing.
9. **`testing/functional/Dashboard.Functional.Tests/ConfigTopologyTests.cs`** — pre-existing stale `AllowUserOverride` test references. Owner: `qa-engineer`. Pre-existing.
10. **In-memory `SlotUpdateBroker` ring buffer survives DB truncate** — pre-existing, post-MVP. 
11. **Defensive `.dockerignore` from prior cycle** — pre-existing.
12. **Stray malformed-path artifact at repo root** — pre-existing.
13. **Cleanup of `qa-bot-*` leaked rows** — pre-existing, cosmetic.
14. **NEW: `prefers-contrast: more`** — explicitly deferred in `docs/ui-theme-options.md` "Deferred / open"; revisit if Dim palette feels under-contrasty in practice.
15. **NEW: `.github/actions/notify/{README.md,action.yml}` pre-existing modifications** in working tree — not part of this commit; whoever owns that work picks it up.

## Resume instructions

1. Open the working directory in Claude Code — agent definitions reload.
2. Recommended clean cycle before substantive work: `pwsh -NoProfile -File dev_env/stop.ps1` → `pwsh -NoProfile -File dev_env/start.ps1` → `pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean`.
3. Run the theme e2e specs once the stack is up: `pwsh -NoProfile -File testing/e2e/run-tests.ps1 -Match theme-*` (or equivalent) to confirm the 6 new specs pass end-to-end.
4. Manual browser smoke of the Theme axis still owed (see open follow-up #1).
5. Per the TODO-driven workflow in `CLAUDE.md`: read `TODO`, ask the user about the first ☐ item — currently **TODO line 10 "UX: Version column width (long versions)"**.
6. Address the open follow-ups (above) opportunistically when adjacent work touches the same files.

## Git state

- Repo: local-only, branch `main`.
- Local git config (repo scope): `user.name = kostiantyn-matsebora`, `user.email = komkom@duck.com`.
- Working tree at session end: theme-cycle + lifecycle CLAUDE.md changes staged + committed in this session's commit.
- No remote configured.
- Pre-existing unstaged modifications in `.github/actions/notify/{README.md,action.yml}` left untouched — not owned by this session.
