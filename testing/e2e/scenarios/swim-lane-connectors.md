# Swim-lane connectors render per-service topology edges

**Intent:** in the Swim-lane layout, the SPA draws a connector path
from every parent env node to every child env node defined in the
service's `topology.edges`. The connector emerges from the source
node's right edge and terminates at the target node's left edge,
as documented in NFR-09 (constructed via
`getBoundingClientRect()` + `ResizeObserver`).

## Citations

- `docs/cr/CR-0003-tree-topology-and-layout-axis.md` FR-13
  ("Swim-lane: One horizontal lane per service; envs laid out
  left-to-right along the per-service env DAG (parents to the left
  of children). Uses `topology.edges` from the matrix response.
  When a service has no edges, it renders as a single root chain
  (one node per env, ordered by `deployed_at` of `current`).").
- `docs/architecture.md` §5 NFR-09 — connector
  geometry anchored to `getBoundingClientRect()`.
- `docs/adr/ADR-0001-topology-derivation-five-pass.md` "Topology
  Derivation" — five passes producing the edges array.
- Fixture: `testing/fixtures/seed-data.json` →
  `topology.service[topo-explicit]` has the chain
  `dev → qa → prod` with `source: "explicit"`.

## Preconditions

- Stack up, fixtures seeded — `topo-explicit` exists with the
  three-env chain.
- Topology fetched from `GET /api/deployments` includes that
  service with `edges: [{from: dev, to: qa, source: explicit},
  {from: qa, to: prod, source: explicit}]`.
- `localStorage` cleared.

## Steps

1. **Given** the SPA is loaded against `http://localhost:8080`,
2. **And** the user has selected layout = Swim-lane (view may be
   the default Detailed),
3. **Then** the matrix root carries `data-layout="swim-lane"`,
4. **And** within the lane for service `topo-explicit`, every env
   node listed in the topology's edge `from`/`to` set is rendered,
5. **And** for every edge in
   `[(dev, qa, explicit), (qa, prod, explicit)]`, there is a
   connector path (CSS line or SVG `path.edge`) whose drawn
   geometry:
   - Starts at the source node's right edge
     (`Math.abs(start.x - sourceRight) ≤ 2 px`),
   - Ends at the target node's left edge
     (`Math.abs(end.x - targetLeft) ≤ 2 px`),
6. **And** the connector path does not cross any env-tag rect
   (mirrors mockup harness Invariant 5).

## Expected results

- For the `topo-explicit` service, exactly two connectors render in
  Swim-lane layout, anchored to live `getBoundingClientRect()`
  positions of the env nodes.
- The connector geometry meets the same tolerance as the mockup
  harness (±2 px).

## Out of scope

- Visual styling differences between `source: "explicit"` and
  `source: "correlated"` (covered indirectly via the visual
  invariants spec).
- Edge case: services with empty `topology.edges` rendering as a
  root chain (covered separately if needed; for now the SAD
  fallback is verified by `spa-visual-invariants.md` running
  cleanly on every service).

## Coverage

- FR-13 Swim-lane: topology-driven layout.
- NFR-09: connectors anchored to live measurements; emerge from
  source, terminate at target.
- `docs/adr/ADR-0001-topology-derivation-five-pass.md` Topology
  Derivation: explicit-first pass + per-service edges array.
