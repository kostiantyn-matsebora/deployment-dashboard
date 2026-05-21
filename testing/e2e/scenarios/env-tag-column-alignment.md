# Workflow-rows: env-tag column is aligned per path-position within a service block

**Intent.** When a service has multiple workflow paths whose env labels differ in
width at the same path-position (e.g. row-1 position-1 = `QA`, row-2 position-1
= `QAHOTFIX`), the nth deployment cell of every row in that service must start
at the same X coordinate. The env-tag column at each position widens to its own
widest content; the SAME width is shared by every row in the same service block
at that position. This is the per-service-block "depth-slot" analogue of the
swim-lane layout's column alignment.

## Citations

- GitHub issue [#23](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/23)
  — bug report: per-row drift in workflow-rows mode.
- `docs/ui/env-tag-column-alignment.md` — locked Phase 2 design doc (Variant A
  per-position width approved, two design-review comments 2026-05-20).
- `docs/ui/env-tag-column-alignment-variant-a.html` — locked Variant A
  reference HTML (the canonical "after" geometry, hardcoded fixture).
- `docs/architecture.md` §5 NFR-09 — layout reflow invariant. The fix
  is structural inside that envelope (env-tag column reservation
  widens; box reflow follows; connector geometry recomputes via the
  existing `recomputeConnectorTops`).
- `frontend/shared/src/lib/env-tag-column-width.directive.ts` — the
  Variant A directive that writes `--env-tag-col-N-width` CSS custom
  properties on each `.svc-block`.
- `frontend/dashboard/src/app/workflow-rows-layout.component.ts:236-251`
  — `.leaf-pair` rendering with `[attr.data-env-position]="idx"`.
- `frontend/dashboard/src/styles.css:182-187` — `.leaf-pair` column-1
  consumes `var(--env-tag-col-width, auto)`; per-position alias rules
  for `data-env-position="0"..="15"` wire each position to its host's
  variable.

## Preconditions

- Stack up (`pwsh -NoProfile -File dev_env/start.ps1`); fixtures seeded
  via the auto-teardown re-seed pass.
- `localStorage` cleared so view/layout default and "expand all" state
  start from a known position.
- An **ephemeral multi-path service** POSTed via the Write API at
  the start of the test:
  - Service id: `qa-bot-issue23-<run-suffix>`.
  - Topology forms two paths sharing position-0 and position-2 envs
    with different widths at position-1:
    - Path A: `qa-bot-dev` → `qa-bot-qa` → `qa-bot-prod`
    - Path B: `qa-bot-dev` → `qa-bot-qahotfix` → `qa-bot-prod`
  - Position-1 thus exposes two rows whose env-tag texts (`QA-BOT-QA`
    vs `QA-BOT-QAHOTFIX`) differ in visual width by 6+ characters,
    making the per-position invariant non-trivial.
  - Cleanup is handled by `testing/e2e/run-tests.ps1`'s auto-teardown
    pass (`seed.ps1 -CleanOnly`).

## Steps

1. **Given** the SPA is loaded against `http://localhost:8080`.
2. **And** ephemeral multi-path service `qa-bot-issue23-<suffix>` has
   been POSTed (3 events, 2 paths, varied env-label widths at
   position-1).
3. **When** the user selects layout = Workflow-rows.
4. **Then** the matrix root carries `data-layout="workflow-rows"`.
5. **When** the user clicks "Expand all workflows".
6. **Then** the ephemeral service renders two `.wf-row` rows (one per
   path).
7. **When** the layout settles (2 paint frames after the click).
8. **Then** for the ephemeral `.svc-block[data-service="qa-bot-issue23-<suffix>"]`:
   - **For each path-position index N** (0, 1, 2):
     - Every `.leaf-pair[data-env-position="N"]` in that block (excluding
       `.leaf-pair-glance` cells) has the same
       `.getBoundingClientRect().left` value within ≤ 0.5 px.
9. **And** the invariant must hold across every MVP view that renders
   the outside-the-box env-tag column (Detailed, Compact, Focus).
   Glance is excluded — `.leaf-pair-glance` inlines the env-tag inside
   the pill, so the per-position invariant does not apply.

## Expected results

- Within the ephemeral `.svc-block`, the position-0 columns (DEV) align
  at the same X; the position-1 columns (QA / QAHOTFIX, different
  widths) align at the same X; the position-2 columns (PROD) align at
  the same X.
- The directive's `ceil(widest) + 1 px` write rule means the spread is
  0 px in theory; we accept ≤ 0.5 px for sub-pixel browser rounding.
- The arrow channel between the nth box and the (n+1)th env-tag is
  the same width across every row (visually: connectors line up).

## Out of scope

- Cross-service alignment — the directive scope is the **single
  `.svc-block`**; different services may (and will) have different
  per-position widths.
- Swim-lane / Matrix layouts — the per-position invariant is
  workflow-rows-specific; swim-lane uses depth-slots (a separate model)
  and Matrix is deferred to Phase 2.0.
- Visual-similarity / pixel-diff baselines — geometric assertion is
  authoritative; the `*-workflow-rows.png` screenshots under
  `testing/mockup-visual/__screenshots__/` are diagnostic only.
- Glance view — `.leaf-pair-glance` cells inline the env-tag inside
  the pill and are deliberately skipped.

## Coverage

- Issue #23 — per-row drift fix (Variant A).
- NFR-09 — layout reflow invariant (the per-position width is part
  of the workflow-rows reflow envelope).
- FR-13 — workflow-rows layout (one row per root-to-leaf path).
