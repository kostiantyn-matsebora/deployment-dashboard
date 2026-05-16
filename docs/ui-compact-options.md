# UI density + attribute display — specification

The dashboard ships **four user-selectable views**, switchable at runtime, with a per-view configurable attribute picker. Canonical reference fixture: [`deployment-dashboard.html`](./deployment-dashboard.html). The requirement is recorded in [CR-0002](./cr/CR-0002-four-named-views-and-attribute-picker.md); this document is the design rationale that CR cites.

---

## Views

Canonical per-view defaults + caps live in [CR-0002 — "Layout views (FR-12)"](./cr/CR-0002-four-named-views-and-attribute-picker.md). This-cycle extension (rationale only):

- **Density targets** (services per 1080p viewport): Detailed ~6, Compact ~15, Glance ~25+, Focus ~15 collapsed / Detailed-size when expanded.
- **Compact specifics.** ~120 px boxes, ~36 px rows; same visual language as Detailed; matrix shape unchanged.
- **Glance specifics.** Pure triage — one status pill per environment, one attribute per pill. For catalogues > 20 services.
- **Focus specifics.** Compact rows by default; chevron drills any row into Detailed-size fidelity. Pin keeps a row expanded across filter changes.

Rationale for the names:
- **Detailed** — describes the content density, not "default / canonical / option A". A new visitor reading the switcher understands the tradeoff immediately.
- **Compact** — verb-style label, parallel to "Detailed". No ambiguity with "dense" (which can read as "hard to parse").
- **Glance** — names the user behaviour the view enables ("take a glance at the catalogue") rather than the layout primitive ("list" / "pills").
- **Focus** — names what the user gets, not how it works ("expandable" / "hybrid"). When triaging an incident the user clicks the chevron to focus on one service.

### Focus view specifics

The Focus view's chevron + pin controls have a fixed placement and lifecycle. The mockup is the canonical reference; the rules below codify the de-facto contract so a future implementation cannot drift.

| Control | Placement | Resting surface | Active surface |
|---|---|---|---|
| Chevron (expand / collapse) | Row gutter — leftmost edge of the row, before the service name. Framed `w-5 h-5` button. | `bg-*-50` | `bg-*-100` |
| Pin (keep expanded across filter changes) | Row gutter — adjacent to the chevron. Framed `w-5 h-5` button. | `bg-*-50` | `bg-*-100` |

- Inline placement (next to the service name or inside a leaf) is **out of contract**. The row gutter is the only valid host.
- Pin lifecycle under filters — pin state lives in `state.pinned[id]` and is **unaffected by filters**. If a pinned row is hidden by search or "failures only", the pin is preserved; when the row re-matches the active filter set, it re-renders expanded.
- Per-row `expanded` and `pinned` state is **session-only** (in-memory Alpine state). No `localStorage` key; a fresh load starts every row collapsed and unpinned. See the [localStorage shape](#localstorage-shape) section for the exhaustive list of persisted keys.
- **Layout scope.** Focus row-gutter affordances (chevron + pin) apply to **all three layouts**. Granularity is layout-specific:

  | Layout | Granularity | Expansion semantics |
  |---|---|---|
  | **Matrix** | per service-row | One chevron + one pin per service-row. Expanding grows the row vertically; all envs in the row use `--leaf-width-expanded` and show all 7 attributes. |
  | **Swim-lane** | per service-lane | One chevron + one pin per service-lane. Expanding grows the lane vertically; each leaf-pair in the lane uses `--leaf-width-expanded` and shows all 7 attributes. SVG connectors anchored to leaf-pair boxes reflow on expand (per NFR-09 a/b) via `recomputeEdges`. |
  | **Workflow-rows** | per service-header | One chevron + one pin per service-header. Expanding the service-header expands ALL of that service's root-to-leaf path rows simultaneously. Path-row-level affordances are **out of contract** — service-grain only. |

- **Pin survives layout switch.** `state.pinned[id]` is layout-agnostic. Switching Layout while a service is pinned keeps the pin; the affordance and its expansion semantics adapt to the new layout's granularity (per the table above), but the pinned set itself does not reset.
- **Focus toolbar discoverability hint** renders above all three layouts when View=Focus (not Matrix-only). The hint copy ("Click ▸ to expand a service for full attribute detail. Pin to keep it expanded across filters.") is layout-independent.

---

## Attribute vocabulary (per matrix slot)

Canonical 7-attribute table (keys, picker labels, source fields, null-render invariant for `ref`/`sha`) lives in [CR-0002 → "Attribute vocabulary"](./cr/CR-0002-four-named-views-and-attribute-picker.md) and [CR-0005](./cr/CR-0005-ref-sha-display-and-topology.md). This doc adds no new attribute semantics.

### Always-on (NOT configurable)

Always-on elements are codified in [CR-0002 → "Always-on elements (not affected by the picker)"](./cr/CR-0002-four-named-views-and-attribute-picker.md):

- Box background colour (green / red / orange + in-progress pulse) — status colour is the primary at-a-glance signal; it's a visual treatment of `current.status`, not an attribute.
- `⚠ prev. failed` badge — FR-03 "running + previously-failed" state.
- Last-successful split section (dashed divider, with version + ago) — FR-03. The picker controls the **top** (current) section only; the bottom is always shown when present.
- Drawer content — drawer is the source of truth; picker does not affect it.

### Out of scope for the picker

- `run_url` is bound to `run` — not a separate checkbox.
- `dt` (absolute timestamp, e.g. `May 15, 2026 09:00`) is drawer-only.

---

## Switcher + picker behaviour

### Switcher
- Segmented control in the header, right of the search input.
- Click selects the view; the active button is filled. Each button has a `title` attribute carrying the one-line description.
- Persisted to `localStorage` (key `dashboard.view`).
- Default for first-time visitors: **Detailed**.

### Attribute picker
- Dropdown button labelled `Display <n>/<max>`. The number reflects the **active view's** current selection.
- Popover shows seven checkboxes — one per attribute (`status`, `version`, `run`, `ago`, `actor`, `ref`, `sha`) — plus the helper text from `activeView.attrHint`.
- Cap enforcement: when `selectedAttrCount >= activeView.maxAttrs`, unchecked boxes render disabled (`opacity-40`, `cursor-not-allowed`, `disabled` attribute). Toggling an existing selection off frees a slot.
- Each view has an independent selection — switching views restores that view's selection from `localStorage`.
- Empty selection is a legitimate state: the box body renders empty (just the coloured outline and the always-on elements). Useful for the most stripped-down look on Glance.

---

## localStorage shape

Canonical key shapes, examples, and load-time hardening rules (corruption → defaults; unknown attrs filtered; cap truncation; empty-array preserved) live in [CR-0002 → "Client-side persistence (`localStorage`)" + "Load-time hardening rules"](./cr/CR-0002-four-named-views-and-attribute-picker.md). Per-view caps (Detailed ≤ 7, Compact ≤ 5, Glance ≤ 1, Focus ≤ 5) are codified in CR-0002's "Layout views (FR-12)" table. Additional keys (`dashboard.layout`, `dashboard.correlationAttribute`, `dashboard.theme`) live in CR-0003 and CR-0006.

### Session-only state (NOT persisted)

The keys above are the **exhaustive** list of persisted UI state. The following per-row state lives in memory only and resets on every page load:

| Domain | Where it lives | Reset trigger |
|---|---|---|
| Focus row `expanded` | In-memory Alpine state (`state.expanded[id]`) | Page reload / tab close |
| Focus row `pinned` | In-memory Alpine state (`state.pinned[id]`) | Page reload / tab close |

Rationale — a fresh load presenting every row collapsed and unpinned matches the principle of least surprise; pinning is a triage-session tool, not a saved preference.

---

## Drawer behaviour on view change

The drawer **stays open** when the user switches views, provided the previously-clicked `(service, env)` still exists in the new layout (which it always does — every view renders the same fixture). The drawer is the source of truth for slot detail and is independent of the matrix attribute picker, so re-rendering the matrix in a different layout has no effect on it. Closing the drawer on view change would penalise a user who is mid-investigation.

---

## Cross-cutting behaviours preserved across all four views

| Behaviour | Source |
|---|---|
| Filter by service name | Header search input |
| Filter to failures only | Header checkbox |
| Stats bar (Services, Failures, Last deploy, Never PROD) | The bar's `failureCount` is independent of the picker — it derives from `services[*].envs[*].current.status === 'failure'`. |
| Hover highlight (amber ring across boxes sharing a version) | `getBoxClass` / `getPillClass` add the ring when `dep.current.version === highlightedVersion`. |
| Drawer (click on a deployed slot) | Same Alpine action `openDrawer(service, env)` in every view. |
| 6 box-state colour treatment + ⚠ badge + split section | Always-on; see "NOT configurable" above. |

---

## FR / NFR coverage

- **FR-03 (6 box states)** — preserved in every view; always-on visual treatment + split section + `⚠ prev. failed` badge are not affected by the picker (it controls only supplementary attributes).
- **FR (matrix layout, service rows × environment columns)** — all four views preserve the matrix shape; they vary only in row height and per-slot content density.
- **NFR-05 (stateless backend)** — view preference is client-side only; backend wire shape is unchanged.
- **NFR-08 (no build step in the browser)** — view + picker state is `localStorage`-only on the client; no server round-trip, no compile, no bundler change at runtime.

---

## Implementation follow-ups

This document is the contract; the actual code lands in separate dispatches.

### Solution architect
- [CR-0002](./cr/CR-0002-four-named-views-and-attribute-picker.md) cites this document as the rationale; no further SAD or CR edit required unless the four-view shape changes.

### Frontend engineer (`frontend/`)
- **View switcher component** in `frontend/matrix/` (or `frontend/shared/` if more than the matrix needs the same control later).
- **Attribute picker component** in `frontend/matrix/`.
- **Signal Store slice** in `frontend/shared/` for `{ view, attrs[viewId] }` with derived signals `activeView`, `selectedAttrs`, `capReached`.
- **Per-view templates** in `frontend/matrix/` — four standalone components (`detailed-row`, `compact-row`, `glance-row`, `focus-row`) selected by the parent `matrix` component based on the active view.
- **localStorage persistence service** in `frontend/shared/` — typed wrapper that handles corruption (returns defaults on parse failure) and per-view caps (truncates on load). Pure client-side; no backend wire impact.

### QA engineer (`testing/`)
- E2E scenarios under `testing/e2e/scenarios/`:
  - Switching views preserves the drawer's open state.
  - Attribute picker enforces the cap (cannot exceed; disabled checkboxes are not focusable).
  - localStorage corruption returns the defaults.
  - Each view's default attribute set renders the documented attributes.
- No fixture change required — the 12-service corpus already exercises every box state ≥ 2×.

### Backend / DevOps
- No change. View selection + attribute picker are pure client-side UI state.
