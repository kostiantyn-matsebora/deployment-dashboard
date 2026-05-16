# UI Focus expand/collapse across layouts — design note

The canonical mockup `docs/deployment-dashboard.html` is the single source of truth for the dashboard's visual + interactive contract. The chosen design for Focus's chevron + pin drill-down extends the affordance from Matrix (the original shipped surface) to **Swim-lane** and **Workflow-rows** using **Option A — wider + taller (matrix-parity)**. The two per-option HTML files (`deployment-dashboard-focus-a-wider.html`, `deployment-dashboard-focus-b-taller.html`) have been merged into the canonical and deleted.

User confirmations captured at merge time:

| Question | Answer |
|---|---|
| Option A (wider + taller) or Option B (taller-only)? | **A — wider + taller**. |
| Should the pin survive a layout switch (per-service, not per-(service,layout))? | **Yes** — pin lives on `service.id`. |
| Should the Focus toolbar discoverability hint render above all three layouts? | **Yes** — toolbar is layout-agnostic when View=Focus. |

## Three orthogonal axes (recap)

| Axis | Control | Effect | Status |
|---|---|---|---|
| **View** | header segmented control | per-box density + which attributes appear | existing |
| **Layout** | header segmented control | overall arrangement of services and envs | existing |
| **Theme** | header gear icon → popover | colour palette only — no semantic change | existing |

Focus's drill-in is not a new axis. It is a per-service expand/pin overlay on top of the View × Layout grid; collapsed Focus reads like Compact, expanded Focus reads like Detailed.

## Chosen design — granularity

| Layout | Granularity | Affordance host | Expansion target |
|---|---|---|---|
| Matrix | per service-row | row gutter, chevron + pin `w-5 h-5` buttons in the service-name column | Detailed leaf renderer; column width shared across rows (NFR-09 #7) |
| Swim-lane | per service-lane | `.lane-label` gutter alongside the service name | Detailed leaf renderer; lane-row writes `--leaf-width: var(--leaf-width-expanded)` |
| Workflow-rows | per service-block | `.svc-block-meta-row` alongside the existing path-expand chevron | Detailed leaf renderer; all path rows for the service widen simultaneously |

The chevron + pin visual treatment is identical across all three layouts — framed `w-5 h-5` buttons with `bg-blue-50 / bg-blue-100` resting/active for chevron and `bg-gray-50 / bg-amber-100` for pin, plus the `.focus-row::before` left-accent rail. This ensures Focus is never visually mistaken for Compact in any layout.

## Reflow strategy

Expanded leaves swap to the **Detailed leaf renderer** AND grow to `--leaf-width-expanded` (200 px). One mental model across all three layouts: expand = wider AND taller box, Detailed content density wherever the user drills in.

| Layout | Width override site | Connector reflow |
|---|---|---|
| Matrix | page-level `--leaf-width: hasExpanded ? 200 : leafWidthForView` (single CSS variable; header + every row read it) | `recomputeConnectorTops(serviceId)` on every `expanded` flip via `$watch('expanded', reflow)` in `bootstrapPersistence` |
| Swim-lane | per-lane-row `--leaf-width: var(--leaf-width-expanded)` when `expanded[id]` is true | `recomputeEdges(serviceId)` on every flip; two-frame wait (`queueMicrotask` + `requestAnimationFrame`) so the wider Detailed leaf has settled before SVG paths re-emit |
| Workflow-rows | per-service-block `--leaf-width: var(--leaf-width-expanded)` when `expanded[id]` is true | `recomputeConnectorTops(serviceId)` on every flip; each `.wf-row`'s `--target-line-width` and `--target-half` recomputed from `getBoundingClientRect` against the new wider leaf |

The Glance-view exception (env-tag inside the pill) is untouched — Focus and Glance are mutually exclusive views.

## Persistence

No new persistence keys. Both `state.expanded[id]` and `state.pinned[id]` are session-only Alpine state (per [`ui-compact-options.md` § Session-only state](./ui-compact-options.md#session-only-state-not-persisted)). A fresh page load starts every service collapsed and unpinned in every layout. The chevron + pin in swim-lane and workflow-rows write to the same store and share the same `toggleExpand` / `togglePin` / `collapseAll` actions used by Matrix Focus.

**Cross-layout pin semantics — pinned by service, not by layout.** A user who pins `service-a` in matrix Focus then switches to swim-lane keeps `service-a` rendered expanded in the swim-lane layout. The pin state lives on the service id, not on the `(service, layout)` pair. This is consistent with the spirit of the matrix Focus rule "pin survives filter exclusion" — the user's intent is "keep this service drilled in", and layout switches preserve that intent.

## Focus toolbar — layout-agnostic

The toolbar (`Click the chevron next to a service to drill into Detailed-size fidelity. Pin to keep it expanded across filters.`) renders above ALL three layouts whenever `view === 'focus'`. Each layout template hosts its own copy gated on `view === 'focus'`; the matrix copy sits inside the matrix Focus template (so it inherits the matrix's `view === 'focus'` x-if), the swim-lane and workflow-rows copies sit at the layout-template top level with `x-show="view === 'focus'"`. The hint is the only signal at first paint that the view is the drill-in / pin one; suppressing it in tree layouts would re-create the "Focus looks like Compact" problem.

## NFR-09 preservation

The UX-RESPONSIVENESS invariant block in the mockup head comment + SAD NFR-09 + `testing/mockup-visual/mockup-invariants.spec.ts` codify the geometric contract. Every existing sub-invariant (a)/(b)/(c) and rules 1–5 are preserved by construction:

- **(a)** Leaf-pair grid template (`auto var(--leaf-width)`) unchanged. `--leaf-width` takes its value from a per-row or per-block override when expanded; grid cells cannot overlap.
- **(b)** Arrow anchors to MEASURED rects via `recomputeEdges` / `recomputeConnectorTops`. Both functions re-run on every `expanded` flip.
- **(c)** ResizeObserver on `[data-service-row]` (re-attached on layout / search / filter / expandedServices change) backs up any indirect reflow.

Two new sibling invariants land with this merge:

- **#6 — Service name never clipped under any view × layout × theme combination.** Every service-name `<p>` uses `whitespace-normal break-words` (no `truncate`, no `overflow:hidden`, no `text-overflow:ellipsis`, no `white-space:nowrap`). The fixed column widths (matrix `w-44/w-40/w-36`, swim-lane `.lane-label` 176 px, workflow-rows `.svc-block` 176 px) are container constraints, not clip masks — long names wrap onto multiple lines vertically rather than being chopped with `…`.
- **#7 — Env-header columns stay aligned with deployment-row columns under any combination of expanded / collapsed Focus rows.** Matrix Focus writes `--leaf-width` ONCE on the page-level container as `hasExpanded ? 200 : leafWidthForView`. The header row and every service row read the same property — widening is binary across the entire matrix and headers track by construction. The per-row expand affordance grows the affected row VERTICALLY (Detailed leaf renderer with full-attribute disclosure); per-column widening is shared across all rows by the same CSS variable. Swim-lane and workflow-rows are not subject to this rule — they have no shared column header.

Both invariants are encoded in the mockup head-comment block (the canonical place for NFR-09 enforcement-by-construction rules) and are now part of the chosen design's contract.

## FR / NFR pointers

| Requirement | Effect |
|---|---|
| FR-03 (6 box states) | unchanged — always on, every view × every layout |
| FR-04 (history drawer) | unchanged — click any expanded or collapsed leaf opens the drawer |
| FR-07 (filters) | unchanged — pin survives filter exclusion in every layout |
| FR-08 (live updates) | unchanged — `injectEvent` flows through the same mutable state |
| FR-12 (four named views) | unchanged — Focus is still a peer view |
| NFR-03 (live update ≤ 5 s) | unaffected |
| NFR-05 (stateless backend) | unaffected — expand / pin is per-browser, in-memory only |
| NFR-08 (no build step) | preserved — single HTML file, Tailwind CDN + Alpine.js |
| NFR-09 (UX-RESPONSIVENESS) | preserved — `recomputeEdges` / `recomputeConnectorTops` triggered by the existing `$watch('expanded', …)`; two new sibling invariants (#6, #7) codified in the head-comment block |

## SAD updates implied

- `ui-compact-options.md § Focus view specifics → "Layout scope"` — the paragraph "Matrix only" struck and replaced with the three-layout granularity table above. Owner: `solution-architect`.
- A note in the same section codifying cross-layout pin semantics ("pin lives on `service.id`, not `(service, layout)`"). Owner: `solution-architect`.
- SAD §"FR-12 / Focus view" — mention the new sibling invariants #6 (service-name no-clip) and #7 (env-header alignment under expand). Owner: `solution-architect`.

## Status

This document is a design note, not a contract. The canonical mockup is the contract. Both forks have been merged into the canonical and deleted; this note records the chosen design's granularity, reflow strategy, persistence, and NFR-09 preservation for posterity.
