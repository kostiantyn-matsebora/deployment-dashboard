# UI tree topology — design note

The canonical mockup `docs/deployment-dashboard.html` is the single source of truth for the dashboard's visual + interactive contract. Topology rendering ships as a **second user-selectable axis** alongside the existing view switcher: a **Layout** segmented control with three options. The two earlier per-option HTML files (`deployment-dashboard-tree-swim-lane.html`, `deployment-dashboard-tree-workflow-rows.html`) have been merged into the canonical and deleted.

## Two orthogonal axes

| Axis | Control | Effect | Owner |
|---|---|---|---|
| **View** | header segmented control | per-box density + which attributes appear | existed in the canonical before this change |
| **Layout** | header segmented control | overall arrangement of services and envs | new — added when the tree options merged into the canonical |

Every (view × layout) combination renders correctly. View controls the *leaf renderer* (the inside of a stage box); layout controls the *outer arrangement* and provides the box's container, sizing, and click target.

## Layout options

| ID | Label | Arrangement | Default |
|---|---|---|---|
| `matrix` | Matrix | services × environments grid (the original canonical) | yes |
| `swim-lane` | Swim-lane | services as horizontal lanes; envs grouped into logical columns by topological depth; sibling envs stack within a depth slot; SVG edges drawn between depth slots | no |
| `workflow-rows` | Workflow rows | one row per root-to-leaf path through the service's topology; rows grouped per service; collapsed by default to the path containing the latest event with a chevron expand | no |

## Persistence

`localStorage` keys for view, layout, attrs, and focus-on-last-event are canonical in [CR-0002](./cr/CR-0002-four-named-views-and-attribute-picker.md) and [CR-0003](./cr/CR-0003-tree-topology-and-layout-axis.md). This doc adds nothing new for those keys. The `dashboard.layout` enum landed here: `'matrix' | 'swim-lane' | 'workflow-rows'`, default `'matrix'`.

## Box-state contract — always on

The 6 box states (status colour, ⚠ prev-failed badge, dashed-divider last-successful split) render in **every view AND every layout**. The attribute picker only constrains which textual fields appear inside the box body. Layout swap never changes the box-state contract.

## Topology data model

The mockup encodes topology declaratively per service via a `TOPOLOGIES` adjacency map (env id → parent env id, or array of parents for fan-in). This is the same shape across all 12 fixture services and matches the wire shape proposed for option (b) in the earlier design pass: `promoted_from` per event, with the topology query returning `(service, env, promoted_from)` triplets.

## FR / NFR pointers

Layout is orthogonal to data shape and box-state semantics. All FRs and NFRs (FR-01..FR-13, NFR-03/05/08) are preserved or unaffected:

- **Preserved by construction.** FR-01 (per-service rows), FR-02 (attributes), FR-03 (6 box states), FR-04 (history drawer), FR-07 (filters), FR-08 (live updates via `injectEvent` + per-layout `applyFocusOrInPlace`), FR-12 (four named views remain peers).
- **Unaffected.** FR-09 (discovery from data — topology is itself data sourced from `promoted_from`), NFR-03 (live update ≤ 5 s), NFR-05 (stateless backend; persistence is per-browser `localStorage`), NFR-08 (no build step; Tailwind CDN + Alpine.js v3).

## Status

This document is a design note, not a contract. The canonical mockup is the contract. The accepted scope (tree topology, three-layout axis, derivation algorithm) is recorded in [CR-0003](./cr/CR-0003-tree-topology-and-layout-axis.md) and [ADR-0001](./adr/ADR-0001-topology-derivation-five-pass.md).

## Open questions for the user

| Question | Effect |
|---|---|
| Should the Layout default be `matrix` or `swim-lane` when topology data exists? | Default is `matrix` today to preserve the existing canonical's first-load behaviour. |
| When a service has zero `promoted_from` events, should swim-lane / workflow-rows render it with a single-column topology, or omit it? | Currently every service renders in every layout — services without branches just look linear. |
| Should the Layout switcher hide when no topology data has arrived yet? | Currently always visible. |
