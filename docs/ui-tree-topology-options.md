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

Each user choice persists independently in `localStorage`. Every key validates against a known-good list on load; corrupt or missing values fall back to the default.

| Key | Type | Default | Validation |
|---|---|---|---|
| `dashboard.view` | enum | `'detailed'` | must be one of `detailed / compact / glance / focus` |
| `dashboard.layout` | enum | `'matrix'` | must be one of `matrix / swim-lane / workflow-rows` |
| `dashboard.attrs.{viewId}` | string[] (JSON) | per-view defaults | filtered to known attribute keys; trimmed to per-view `maxAttrs` |
| `dashboard.focusOnLastEvent` | boolean | `true` | must parse as `'true'` or `'false'` |

## Box-state contract — always on

The 6 box states (status colour, ⚠ prev-failed badge, dashed-divider last-successful split) render in **every view AND every layout**. The attribute picker only constrains which textual fields appear inside the box body. Layout swap never changes the box-state contract.

## Topology data model

The mockup encodes topology declaratively per service via a `TOPOLOGIES` adjacency map (env id → parent env id, or array of parents for fan-in). This is the same shape across all 12 fixture services and matches the wire shape proposed for option (b) in the earlier design pass: `promoted_from` per event, with the topology query returning `(service, env, promoted_from)` triplets.

## FR / NFR pointers

| Requirement | Effect of layout switcher |
|---|---|
| FR-01 (per-service rows) | preserved in every layout |
| FR-02 (5 attributes) | preserved — picker applies to whichever leaf renderer the active view defines |
| FR-03 (6 box states) | unchanged — always on, every view × every layout |
| FR-04 (history drawer) | preserved — click any box in any layout opens the drawer |
| FR-07 (filters) | preserved — search + failures-only operate on the service list; every layout reflows |
| FR-08 (live updates) | preserved — `injectEvent` flows through the same mutable state; per-layout post-injection animation routes through `applyFocusOrInPlace` |
| FR-09 (discovered from data) | unaffected — topology is data when sourced from `promoted_from`; FR-09's spirit preserved (no static config baked into the image) |
| FR-12 (four named views) | preserved — the four views remain peers; layout is a separate axis |
| NFR-03 (live update ≤ 5 s) | unaffected |
| NFR-05 (stateless backend) | unaffected — persistence is per-browser via `localStorage` |
| NFR-08 (no build step) | preserved — single HTML file, Tailwind CDN + Alpine.js v3 |

## Status

This document is a design note, not a contract. The canonical mockup is the contract. SAD updates (additive: `promoted_from` field, `GET /api/topology` endpoint, FR-12 scoping of views to the active layout) are deferred until the user signs off the prototype and a serial dispatch (`solution-architect` → `backend-engineer` → `frontend-engineer` + `qa-engineer`) lands the change.

## Open questions for the user

| Question | Effect |
|---|---|
| Should the Layout default be `matrix` or `swim-lane` when topology data exists? | Default is `matrix` today to preserve the existing canonical's first-load behaviour. |
| When a service has zero `promoted_from` events, should swim-lane / workflow-rows render it with a single-column topology, or omit it? | Currently every service renders in every layout — services without branches just look linear. |
| Should the Layout switcher hide when no topology data has arrived yet? | Currently always visible. |
