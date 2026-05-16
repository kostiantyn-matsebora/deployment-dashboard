# Theme — 6 box-state contract preserved under dark palette

**Intent:** the 6 box states (Success, Running + Last Successful,
Running + Failed + Last Successful, Failed + Last Successful, Running
no-history, Running + Failed no-history) render correctly under the
dark palette. Theme is a palette swap; box-state semantics
(`data-state`, `prev-failed-badge`, `last-successful-section`) are
invariant.

## Citations

- `docs/ui-theme-options.md` "6-box-state contract — palette mapping"
  + "Box-state contract — always on" sections — "Theme is purely a
  palette swap. The 6 box states … render in every view AND every
  layout AND every theme."
- `docs/deployment-dashboard-architecture.md` §4 FR-01 / FR-02 / FR-03
  — matrix renders, slot exposes its attributes, current +
  last-successful split when running or failed.
- `docs/cr/CR-0006-light-dark-auto-theme.md` Theme axis subsection —
  "palette only — no semantic change".
- `testing/e2e/scenarios/matrix-six-box-states.md` — the canonical
  6-state catalogue; this scenario re-uses the same fixture
  expectations under a different palette.

## Preconditions

- Stack up + seeded corpus via `testing/scripts/seed.ps1` (same
  6-state fixture set as `matrix-six-box-states.md`).
- The test sets `localStorage['dashboard.theme'] = 'dark'` via
  `addInitScript` BEFORE navigation so the SPA paints in dark
  from the first frame.

## Steps

1. **Given** the dashboard is loaded with persisted
   `dashboard.theme = 'dark'`,
2. **Then** `<html data-theme="dark">`,
3. **And** for each of the six canonical slots from
   `matrix-six-box-states.md`:

   | Slot | `data-state` |
   |---|---|
   | `service-b` × `dev`  | `success` |
   | `service-a` × `dev`  | `running-with-last` |
   | `service-c` × `dev`  | `running-prev-failed-with-last` |
   | `service-b` × `qa`   | `failed-with-last` |
   | `service-d` × `uat`  | `running` |
   | `service-d` × `dev`  | `running-prev-failed` |

   - the `[data-testid="stage-box-<svc>-<env>"]` element exists,
   - its `data-state` attribute matches the table verbatim,
   - the `last-successful-section` child is present iff the
     fixture expects it,
   - the `prev-failed-badge` child is present iff the fixture
     expects it.

4. **And** the four status colour buckets remain visually distinct
   under the dark palette — the box `class` string still contains the
   semantic Tailwind family name (`bg-green-…` / `bg-red-…` /
   `bg-orange-…` / `bg-amber-…`). The dark palette overrides happen
   in CSS (`[data-theme="dark"] .bg-green-50 { background: …}`) — the
   class TOKENS on the element MUST NOT change.

## Expected results

- All six `data-state` values appear under the dark palette,
  identical to the light-palette assertions.
- `last-successful-section` + `prev-failed-badge` render identically
  under both palettes.
- The Tailwind class TOKENS on every box are byte-identical between
  `data-theme="light"` and `data-theme="dark"` — the palette swap is
  a CSS-only overlay; no element ever has its class string rewritten
  by the theme switch.

## Out of scope

- Perceptual contrast of the dark palette (WCAG AA — manual smoke).
- Live OS flips — covered by
  `theme-switcher-auto-follows-os-preference.md`.
- Geometric NFR-09 invariants under dark — covered by the existing
  `spa-visual-invariants.spec.ts` (the harness is palette-agnostic;
  this scenario notes that no separate run-under-dark variant is
  needed because geometric invariants are independent of palette
  per `docs/ui-theme-options.md` "NFR-09 (UX-RESPONSIVENESS)
  unaffected").

## Coverage

- `docs/ui-theme-options.md` "6-box-state contract — palette
  mapping" + "Box-state contract — always on".
- `docs/deployment-dashboard-architecture.md` §4 FR-01 / FR-02 /
  FR-03 — palette-invariant.
- `docs/cr/CR-0006-light-dark-auto-theme.md` Theme axis subsection —
  "no semantic change".
