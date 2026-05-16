# Workflow-rows layout renders one row per root-to-leaf path, expandable on click

**Intent:** the Workflow-rows layout shows each service as a set of
rows where each row corresponds to a path through the per-service
topology DAG. Clicking a row expands it; the collapsed view shows
the path containing the latest event for that service.

## Citations

- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` FR-13
  ("Workflow-rows: One DAG drawn per service with envs as rows;
  promotes the topology to a first-class visual element. Uses
  `topology.edges` source. Empty-topology services render as a
  single root chain (same fallback as Swim-lane).").
- `docs/deployment-dashboard-architecture.md` §5 NFR-09 — connectors
  anchored to live measurements; layout reflow under all attribute
  combinations.
- Fixture: `testing/fixtures/seed-data.json` →
  `topology.service[topo-explicit]` provides a non-trivial DAG
  (linear chain `dev → qa → prod` — the minimum to exercise
  row-as-path rendering).

## Preconditions

- Stack up, fixtures seeded.
- `localStorage` cleared.

## Steps

1. **Given** the SPA is loaded against `http://localhost:8080`,
2. **When** the user selects layout = Workflow-rows,
3. **Then** the matrix root carries
   `data-layout="workflow-rows"`,
4. **And** the `topo-explicit` service renders at least one
   workflow row (`[data-testid^="workflow-row-topo-explicit-"]` is
   visible),
5. **And** the workflow row that contains the latest deployment
   carries `data-active="true"` (the path containing the most
   recent event),
6. **When** the test clicks the workflow row,
7. **Then** the row's `aria-expanded` attribute (or
   `data-expanded="true"`) reflects the expanded state,
8. **And** the env nodes for `dev`, `qa`, and `prod` are visible
   within that row,
9. **When** the test collapses the row (clicks again),
10. **Then** the row returns to its compact form, with the active
    path still marked.

## Expected results

- One or more workflow rows render per service in Workflow-rows
  layout.
- The "latest event" path is visible without user interaction; the
  user can expand additional paths.
- Empty-topology services (e.g. one of `service-a`/`b`/`c`/`d`
  with no parent_deployments and no correlation siblings) render
  as a single root chain — the test asserts at least one row
  renders for every visible service.

## Out of scope

- Sibling-path layout when the DAG is non-linear — the seeded
  topology is linear, so the assertion is "≥ 1 row visible" rather
  than a path-count match.
- Drawer interaction (covered by `drawer-history.md`).

## Coverage

- FR-13 Workflow-rows: topology-driven row layout.
- NFR-09: layout under the third layout option.
