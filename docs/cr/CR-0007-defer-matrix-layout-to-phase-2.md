# CR-0007 — Defer Matrix layout from MVP to Phase 2.0

- **Status:** accepted
- **Trigger:** User decision after the Phase 2 mockup-iteration cycle on the root `TODO` "Version width" item (TODO line 10) surfaced unresolved geometric tensions in the Matrix layout — per-cell centering of variable-width version strings, connector midpoint anchoring across a shared column track, and content-sized column alignment without CSS subgrid. User opted to ship MVP without Matrix rather than block the layout axis on these tensions. User's words: *"Swim-lane and Workflows rows are okay, we can go with them, just remove matrix"* + *"add it to Phase 2 todo, after MVP"*.
- **Change:**
  1. The FR-13 Layout axis is reduced from three options to two for MVP: **Swim-lane** and **Workflow-rows**. The **Matrix** option is deferred to Phase 2.0.
  2. Default first-paint layout changes from `Matrix` to `Swim-lane`.
  3. The `localStorage` allow-list for `dashboard.layout` is reduced to `{'swim-lane', 'workflow-rows'}`. Persisted values of `'matrix'` (from any pre-CR-0007 client) fall back to the new default `'swim-lane'` via the load-time hardening rule (same mechanism as any other out-of-set value).
  4. The Matrix-layout-specific provisions of CR-0003 — the layout-axis table row, the Focus per-layout granularity row "Matrix is per service-row", the Glance exception note "In Matrix layout the pills are inline along the row", and the env-header column-alignment sibling invariant in NFR-09 — are superseded for the MVP window. They remain in CR-0003 as historical record and become re-applicable when Matrix is reintroduced in Phase 2.0.
  5. The **matrix wire shape** (`GET /api/deployments` → per-service `envs` map keyed by environment) is **unchanged**. "Matrix" as a wire-shape / read-API term is independent of "Matrix" as a layout option; only the latter is deferred. Matrix-derivation rules, the six box states, `lastSuccessful` / `previousFailed`, and the SSE slot-update contract are all untouched.
- **Impact:**
  - **FR-13** (introduced by CR-0003) — option set reduced to two for MVP. Default changes from `Matrix` to `Swim-lane`. Re-expansion to three options is queued under Phase 2.0 per the root `TODO`.
  - **CR-0003** — the Matrix-as-MVP portions are superseded by this CR. CR-0003 is amended with a `Superseded by` line referencing CR-0007; the body of CR-0003 is left intact per the append-only rule.
  - **NFR-09** — the "env-header column alignment under expand" sibling invariant only applies to Matrix layout; it is moot during the MVP window. The primary responsiveness invariant and the "service-name single-line auto-width" sibling invariant remain in force across the two surviving layouts.
  - **Mockup** (`docs/ui/deployment-dashboard.html`) — Matrix-layout templates and Alpine.js branches deleted; default `dashboard.layout` initialiser flipped to `swim-lane`. **Out of scope for this CR — owned by `frontend-engineer`** per the routing in `CLAUDE.md`. Land this CR first; mockup mirrors after.
  - **Tests** (`testing/`) — Matrix-layout-specific E2E scenarios (e.g. any `matrix-*.spec.ts` covering FR-13 Matrix-layout rendering, not the matrix-derivation suite) deferred to Phase 2.0. **Out of scope for this CR — owned by `qa-engineer`** per the routing in `CLAUDE.md`.
  - **Backend** — none. Wire shape unchanged; topology endpoints unchanged; derivation algorithm (ADR-0001) unchanged.
- **References:**
  - **CR-0003** — the CR being amended. Matrix-as-MVP-default portion is the part superseded.
  - **ADR-0001** — unaffected (topology derivation is layout-agnostic).
  - Root `TODO` Phase 2.0 section — already lists the Matrix-reintroduction work item (line 20).
  - `docs/ui/tree-topology-options.md` — UX rationale for the layout axis (covers all three options; Matrix coverage retained as future reference).

## SAD-level content owned by this CR — verbatim

### FR-13 — amended (verbatim post-amendment text, supersedes the CR-0003 FR-13 block for the MVP window)

> The SPA shall offer two layouts — **Swim-lane**, **Workflow-rows** — selectable from a top-bar segmented control. Layout selection is orthogonal to view (FR-12): all 4 × 2 = 8 (view, layout) combinations are supported. Layout selection persists client-side in `localStorage` under key `dashboard.layout`. Default: `Swim-lane`. Allowed values: `'swim-lane' | 'workflow-rows'`. Persisted values outside this set (including the legacy `'matrix'` from any pre-CR-0007 client) fall back to the default. Both layouts render per-service topology (§5 "Topology derivation" / §7 "Topology in the wire shape"); when a service has no topology (no explicit `parent_deployments` and the correlation fallback yields no edges), that service renders as a single root chain. The mockup (`docs/ui/deployment-dashboard.html`) is the visual contract; the responsiveness invariant in NFR-09 covers both layouts. The Matrix layout option is deferred to Phase 2.0.

### §7 "Layout axis (FR-13)" — verbatim (supersedes the CR-0003 §7 block for the MVP window)

> Orthogonal to the four views above, the SPA offers two **layouts**. The user switches between them via a second segmented control in the header (independent of the view switcher); the active layout is persisted in `localStorage` (`dashboard.layout`). All 4 × 2 = 8 (view, layout) combinations are supported.
>
> | Layout | Intent | Topology data required | Render shape |
> |---|---|---|---|
> | **Swim-lane** | Default first paint — one horizontal lane per service; envs laid out left-to-right along the per-service env DAG (parents to the left of children). | Yes — uses `topology.edges` from the matrix response (§"API Contract"). When a service has no edges, it renders as a single root chain (one node per env, ordered by `deployed_at` of `current`). | Per-service horizontal lane; connectors anchored to `getBoundingClientRect()` per NFR-09. |
> | **Workflow-rows** | One DAG drawn per service with envs as rows; promotes the topology to a first-class visual element. | Yes — same `topology.edges` source. Empty-topology services render as a single root chain (same fallback as Swim-lane). | Per-service vertical DAG; rows are envs, columns are DAG levels. |
>
> Default for first-time visitors: **Swim-lane**.
>
> Layout is **orthogonal** to view (FR-12): the chosen view's attribute picker, density, and 6-box-state rendering remain identical across layouts. Only the spatial arrangement of envs within a service changes.
>
> **Phase 2.0 — Matrix layout reintroduction.** The third layout option (services × environments grid) is deferred to Phase 2.0 per the root `TODO`. When reintroduced, the option set returns to three, the default-layout decision is revisited, and the CR-0003 Matrix-specific invariants (env-header column alignment under expand; Focus per-layout granularity row for Matrix; Glance exception note for Matrix) become re-applicable.

### §7 "Glance exception under FR-13" — amended (verbatim post-amendment text)

> The Glance view's "env-tag-inside-pill" rendering (NFR-09 Glance exception) applies in both layouts. In Swim-lane and Workflow-rows, the pill rendering is used at each node in the DAG, with the env label inside the coloured pill rather than to its left. The mockup (`docs/ui/deployment-dashboard.html`) is the visual contract for this; the responsiveness invariant in NFR-09 is the geometric guarantee.

### §7 "Focus per-layout granularity (FR-13)" — amended (verbatim post-amendment text)

> The Focus view's row-gutter affordances (chevron + pin) apply across **both layouts**. Granularity is layout-specific and codified in `docs/ui/compact-options.md` "Focus view specifics" — Swim-lane is per service-lane, Workflow-rows is per service-header (one chevron + pin per service expands all of that service's root-to-leaf path rows; path-row-level affordances are out of contract).
>
> - **Pin survives layout switch.** `state.pinned[id]` is layout-agnostic; switching layout while a service is pinned keeps the pin. The expansion semantics adapt to the new layout's granularity but the pinned set itself does not reset.
> - **Focus toolbar hint** renders above both layouts when View=Focus.
>
> The mockup (`docs/ui/deployment-dashboard.html`) is the visual contract; the responsiveness invariant in NFR-09 (including the "service-name single-line auto-width" sibling invariant in §5) is the geometric guarantee under any expand/collapse state in either layout.

### `localStorage` keys — amended

| Key | Value shape | Example | Cap |
|---|---|---|---|
| `dashboard.layout` | one of `'swim-lane'`, `'workflow-rows'` (string) | `"swim-lane"` | n/a |

Load-time hardening (amends the CR-0003 rule for `dashboard.layout`):

> - For `dashboard.layout`: if the persisted string is not in the allowed set `{'swim-lane', 'workflow-rows'}`, fall back to the default (`swim-lane`). The legacy value `'matrix'` from any pre-CR-0007 client is one such out-of-set value; no special-case migration code is required — the generic fallback handles it.
