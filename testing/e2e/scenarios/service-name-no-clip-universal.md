# Service name renders without clipping across every View × Layout × Theme

**Intent:** the service name is the row's primary identifier. A
recently-reported defect rendered the service name with
`text-overflow: ellipsis` truncation in Workflow-rows under some
configurations, making the row indistinguishable from another whose
name shares the first N characters. The frontend is fixing the issue
structurally (column sizing + drop of `.truncate` where the column
auto-sizes). This scenario codifies the contract so any future
regression of the same shape fails LOUDLY against ALL 24 combinations
(4 views × 3 layouts × 2 themes).

## Citations

- `docs/deployment-dashboard.html` — the canonical mockup. Service
  name renders inside a `.truncate` `<p>` that may legitimately carry
  the Tailwind `.truncate` utility as defensive armour, but the
  enclosing column must be wide enough that the text never actually
  clips. The `:title="service.name"` attribute is present on the
  matrix Compact + Focus + Glance layouts, but a non-zero overflow
  still represents a visual defect — the user reads the row, not the
  hover tooltip.
- `docs/ui-compact-options.md` — service-name column sizing per view.
- `docs/deployment-dashboard-architecture.md` §4 FR-12, §7 "Visual
  layout" — service name is one of the always-on row metadata
  elements; truncation is out-of-contract.

## Preconditions

- Stack up, fixtures seeded via `testing/scripts/seed.ps1`.
- The seeded corpus must include at least one service with a long
  name to actually stress the column. The default 6-state corpus uses
  short ids (`service-a`, etc.); this scenario defensively injects a
  long-name service via the Alpine root before the assertion sweep so
  the test does not silently pass on a corpus that happens to fit.
- `localStorage` cleared at the start of every test so the page loads
  on the Detailed view with default attributes.

## Steps

For every combination in `{detailed, compact, glance, focus} ×
{matrix, swim-lane, workflow-rows} × {light, dark}`:

1. **Given** the SPA on Layout=`{layout}`, View=`{view}`,
   Theme=`{theme}`, and a service with a 32-character name injected
   into `root.services` (via Alpine `$data(document.body)` —
   in-memory only; not persisted to the backend),
2. **When** the test queries the service-name element for that
   service in the active layout's DOM site:
   - Matrix: the `p.truncate` rendering `x-text="service.name"`
     inside the per-service row's left-column gutter.
   - Swim-lane: the `.lane-label p.truncate` rendering
     `x-text="service.name"`.
   - Workflow-rows: the `.svc-block-meta-row p.truncate` rendering
     `x-text="service.name"`.
3. **Then** the element satisfies `scrollWidth <= clientWidth + 1`
   (1-px sub-pixel tolerance — identical to the I2 env-tag
   tolerance), proving the text is not horizontally clipped.

## Expected results (observable)

| # | Observable |
|---|---|
| 1 | For all 24 combinations, the long-name service-name element has `scrollWidth <= clientWidth + 1`. |
| 2 | The first regression of this defect (column too narrow + truncate active) fails with a clear "Service name is clipped" message naming the layout, view, theme, and the overflow amount in pixels. |

## Out of scope

- Visual appearance of the service name beyond no-clip (font weight,
  colour, size). Those live in `ui-compact-options.md` and are a
  frontend craft concern.
- Long-name handling in the drawer header. The drawer has its own
  width and renders the full name unconditionally — a separate
  scenario can cover it if a defect surfaces.
- Wrapping behaviour. The contract is no-clip; the contract does NOT
  prescribe whether the row layout wraps or extends horizontally —
  that is a frontend layout choice. The oracle only fails when the
  element's content is wider than its computed width.

## Coverage

- `docs/ui-compact-options.md` — service-name column sizing per view.
- `docs/deployment-dashboard-architecture.md` §4 FR-12 — the four
  named layout views all carry service-name in the row gutter.
- Defect history: a user-reported workflow-rows clipping defect that
  this oracle codifies as a regression test.
