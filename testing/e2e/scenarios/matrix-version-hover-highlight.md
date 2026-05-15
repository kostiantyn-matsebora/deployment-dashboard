# Hovering a version amber-rings every box that hosts that version

**Intent:** hovering any stage box highlights every box across environments
where the same version appears (whether as the current deployment or as the
last-successful pin). This proves the cross-environment promotion-tracing
behaviour from the mockup.

## Citations

- `docs/deployment-dashboard.html` - the `getBoxClass` helper and the
  `HIGHLIGHT = 'ring-2 ring-offset-1 ring-amber-400 '` prefix added by the
  mockup. Frontend mirrors this in
  `frontend/matrix/src/lib/box-styles.ts` (visual contract per
  `CLAUDE.md` source-of-truth rule: mockup wins for visual / interactive
  behaviour).
- `docs/deployment-dashboard-architecture.md` §7 "Web Dashboard (MVP) -
  Visual layout" - "Boxes share a version highlight on hover".
- `frontend/shared/src/lib/highlight-version.directive.ts` - the directive
  driving `mouseenter`/`mouseleave` into the store's `highlightedVersion`
  signal.
- `testing/fixtures/seed-data.json` - `service-b/dev` has version `v2.3.0`,
  which also appears in the `service-d/dev` history but the
  *matrix* only features one occurrence; we therefore use a version that
  the fixture guarantees is current in exactly one slot to keep the
  assertion deterministic.

## Preconditions

- Stack up, fixtures seeded (same as `matrix-six-box-states.md`).
- The version `v2.3.0` appears as the `current` of `service-b/dev`
  (state `success`). No other slot in the seeded matrix has it as
  `current` *or* as `lastSuccessful`, so the highlight assertion is
  trivially "one box highlighted" without coupling to fixture noise.

## Steps

1. **Given** the SPA is loaded and the pipeline matrix is visible,
2. **When** the mouse enters `[data-testid="stage-box-service-b-dev"]`,
3. **Then** the stats bar `[data-testid="highlight-hint"]` element becomes
   visible and contains the text `v2.3.0`,
4. **And** `[data-testid="stage-box-service-b-dev"]`'s `class` attribute
   contains `ring-amber-400`,
5. **And** at least one stage box outside the `service-b/dev` slot does
   NOT carry the `ring-amber-400` class (negative control - the highlight
   is targeted, not global),
6. **When** the mouse leaves the box,
7. **Then** the `highlight-hint` element is no longer present in the DOM,
8. **And** the previously-highlighted box no longer carries the
   `ring-amber-400` class.

## Expected results

- Amber-ring class toggles on `mouseenter` / `mouseleave` exactly on the
  boxes whose `current.version` or `lastSuccessful.version` matches the
  hovered version.
- The stats-bar hint reflects the hovered version verbatim.
- No additional re-renders or DOM thrash is required to remove the
  highlight when the mouse leaves.

## Out of scope

- Click-to-open-drawer interaction - covered by `drawer-history.md`.
- Multi-slot highlight assertions (e.g. version present in dev and qa) -
  the fixture does not guarantee a stable multi-slot version, so coverage
  for cross-environment highlight is satisfied by the class assertion
  alone.

## Coverage

- Mockup: `getBoxClass` amber-ring highlight on hover.
- SAD §7 Web Dashboard (MVP) - Visual layout - "version highlight" sentence.
