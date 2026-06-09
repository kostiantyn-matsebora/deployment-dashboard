# Views

## Matrix View Layout

### Grid Structure

```css
.matrix {
  display: grid;
  grid-template-columns: 180px repeat(N, minmax(140px, max-content));
  column-gap: 6px;
  row-gap: 9px;  /* clear visual separation between service rows */
}
```

- **First column (180px):** Service name, sticky-left during horizontal scroll (`position: sticky; left: 0`). Background: `--glass-strong` + `backdrop-filter` so content doesn't show through.
- **Env columns:** `minmax(140px, max-content)` — each column expands to fit widest cell. Columns consume available viewport width when content allows.
- **Service-row accent:** `border-left: 2px solid rgba(var(--accent-rgb), 0.35)` on `.row-head`.
- **Matrix shell:** `overflow-x: auto; overflow-y: visible`. Bottom hairline: `border-bottom: 1px solid var(--glass-edge-2)` closes the container visually.
- **Column headers:** environment tag in `.env-tag` monospace pill.

### Filtering

- **Service filter:** inline `pInputText` in topbar. Case-insensitive substring match against component name. Matching toggles `.is-hidden` on `.row` elements.
- **Failures-only:** inline `p-toggleSwitch` pill. When ON, hides service rows that have no failed states (fail-last, run-fail-last, run-fail-only).

### Column Controls

#### Show / Hide

- The `⊞` Columns button (Matrix-only topbar icon) opens a popover listing every environment with a checkbox.
- Unchecking an environment **fully removes** that column — header cell and all body cells — and the matrix re-renders from the visible, ordered environments. No placeholder or empty column remains.
- The last visible environment cannot be unchecked (click is blocked).
- "Show all · reset order" (popover footer action) restores all environments and the default column order in one step.

#### Drag Reorder

- Visible column headers (`.col-head`) carry a `⠿` grip glyph (`.col-drag-grip`), are `draggable="true"`, and have `cursor: grab` / tooltip `"Drag to reorder"`.
- Dragging uses the HTML5 Drag and Drop API (`dragstart` / `dragover` / `drop` events on `.col-head` elements).
- The dragged column fades to 40% opacity; the drop target gains an accent dashed outline.
- On drop: the column order updates, the new order is persisted, the matrix re-renders, and the picker reflects the new order.

#### Persistence

Column state persists client-side to `localStorage`. Both keys are cleared by "Show all · reset order".

| Key | Format | Content |
|-----|--------|---------|
| `dd:colOrder` | JSON array | Ordered permutation of all environment names. |
| `dd:colHidden` | Comma-separated string | Names of hidden environments. Empty string = none hidden. |

On load: the persisted order is validated as a full permutation of the known environment set; if stale (environment added or removed) it falls back to the default environment order. Hidden-set entries not in the known environment set are ignored.

---

## Swimlanes View Layout

### Overall Structure

```css
.vis-shell {
  display: grid;
  grid-template-columns: 1fr 320px;  /* canvas | inspector */
  gap: 14px;
}
```

### Canvas & Lanes

- **One horizontal lane per service.** Each lane has a header (`.lane-head`) and a content area containing a dedicated `<ngx-graph>` instance.
- **One `<ngx-graph>` per service** — since no cross-service edges exist (each lane is self-contained), each service gets its own graph component. This keeps data binding simple.
- **Multiple disconnected DAGs** within a lane stack **vertically** (top-to-bottom), not horizontally. Dagre handles disconnected subgraphs natively.
- **Time axis:** left-to-right within each DAG, based on `happened_at`.

### ngx-graph Configuration

```html
<ngx-graph
  [nodes]="laneNodes"           <!-- Node[] for this service -->
  [links]="laneLinks"           <!-- Edge[] derived from parrent_deployments -->
  [view]="[canvasWidth, laneHeight]"
  layout="dagre"
  [layoutSettings]="{
    orientation: 'LR',          // left-to-right (time axis)
    rankPadding: 60,            // gap between rank columns
    nodePadding: 12,            // vertical gap between parallel nodes
    edgePadding: 8,
    multigraph: true
  }"
  [curve]="curveBundle"         // d3 curve for smooth edges
  [autoZoom]="false"
  [panningEnabled]="false"      // outer .vis-canvas scrolls instead
  [zoomEnabled]="false"
  (select)="onNodeSelect($event)"
>
  <ng-template #nodeTemplate let-node> ... </ng-template>
  <ng-template #linkTemplate let-link> ... </ng-template>
  <ng-template #defsTemplate> ... </ng-template>
</ngx-graph>
```

### Data Mapping

| ngx-graph Input | Source | Mapping |
|-----------------|--------|---------|
| `[nodes]` | Deployment events for this service | `{ id: event.id, label: event.version, data: { ...event } }`. Attach the full domain-model record in `data` so the node template can render all fields. |
| `[links]` | `parrent_deployments` | For each node, emit one link per parent: `{ id: nodeId+parentId, source: parentId, target: nodeId, data: { status: parentNode.status } }`. Only intra-service parents produce links. |
| `[view]` | Computed | `[availableWidth, computedLaneHeight]`. Re-evaluate on attribute toggle and window resize. |

### Custom Node Template (`#nodeTemplate`)

The `#nodeTemplate` receives `let-node` with `node.data` containing the full deployment record. Render the vis-card layout (see [§ Swimlane Node Card](components.md#swimlane-node-card)) as an SVG `<foreignObject>` wrapping an HTML `.vis-card` div — this preserves the glass aesthetic, `backdrop-filter`, and the 2-column CSS grid layout.

```html
<ng-template #nodeTemplate let-node>
  <svg:foreignObject
    [attr.width]="node.dimension.width"
    [attr.height]="node.dimension.height">
    <xhtml:div class="vis-card"
      [class.s-success]="node.data.currentStatus === 'success'"
      [class.s-progress]="node.data.currentStatus === 'in-progress'"
      [class.s-failure]="node.data.currentStatus === 'failure'"
      [class.s-never-deployed]="node.data.neverDeployed"
      [class.is-selected]="node.data.id === selectedNodeId">
      <!-- never-deployed: render neutral surface + status chip (hue from node.data.status) -->
      <!-- ctx-badge overlay (.ctx-row): present when node.data.nextStatus is set -->
      <!-- vis-card internal structure per § Swimlane Node Card -->
    </xhtml:div>
  </svg:foreignObject>
</ng-template>
```

> **Node sizing:** ngx-graph uses `node.dimension.width` / `node.dimension.height` for layout. Pre-calculate these from the node's visible fields (or render once hidden, measure, then update). When attribute toggles change visible fields, update dimensions and call `graph.update$.next(true)` to trigger relayout.

### Custom Link Template (`#linkTemplate`)

Status-colored edges with arrow markers. The link's `data.status` determines stroke color.

```html
<ng-template #linkTemplate let-link>
  <svg:g class="edge">
    <svg:path
      [attr.d]="link.line"
      [attr.stroke]="getEdgeColor(link.data.status)"
      stroke-width="1.5"
      fill="none"
      marker-end="url(#arrow)" />
  </svg:g>
</ng-template>

<ng-template #defsTemplate>
  <svg:marker id="arrow" viewBox="0 -5 10 10"
    refX="8" refY="0" markerWidth="4" markerHeight="4"
    orient="auto">
    <svg:path d="M0,-5L10,0L0,5" fill="currentColor" />
  </svg:marker>
</ng-template>
```

### Status Colour Map

**Tile / card colour** (the 3 effective statuses — drive box colour, edge stroke, and card class):

| Status | Hue | Token | Icon |
|--------|-----|-------|------|
| `success` | emerald | `--emerald` | `✓` |
| `in-progress` | amber | `--amber` | spinner `◴` |
| `failure` | coral | `--coral` | `✕` |

**Next-deployment badge** (the 5 non-effective statuses — rendered as `.ctx-badge` layered on the tile/card; never drive box colour):

| Status | Hue | Token | Icon | Description |
|--------|-----|-------|------|-------------|
| `pending` | slate | `--slate` | `○` | created, not started |
| `queued` | blue | `--blue` | `≡` | queued to run |
| `waiting` | violet | `--violet` | `◷` | blocked on approval / wait timer |
| `cancelled` | grey | `--grey` | `⊘` | run cancelled |
| `rejected` | rose | `--rose` | `⊗` | reviewer denied — never ran |

The next badge shows the **latest deployment beyond the live one** (if any). It is present on both Matrix tiles and Swimlane cards.

**Legend.** Each view (Matrix / Swimlanes) carries its own legend popover (`#legend-matrix` / `#legend-vis`), swapped on view change. Three sections:
- **Status key** — "Environment state" (3 effective) + "Next deployment" (5 context): icon + swatch + meaning.
- **Field reference** — each visible field rendered AS IT APPEARS + its meaning (matrix `MATRIX_FIELDS` / swimlane `SWIMLANE_FIELDS`).
- **Layout guide** — Matrix: tile layouts (split / prev. failed / never-deployed / empty). Swimlanes: edges = parent→child + the correlation predicate.

**Inspector.** The inspector panel shows the effective deployment's fields first, then a dotted separator, then a `next` group for the next-deployment entry (if present). The history drawer shows all 8 statuses as distinct entries, with the next deployment leading.

### Edge Color Mapping

Edges carry the **parent node's** effective status. All 8 status values map to a stroke colour (next-status nodes that appear in the history DAG use the same hue table):

| Parent Status | Stroke Color (dark) | Token |
|---------------|---------------------|-------|
| `success` | emerald | `--emerald` |
| `in-progress` | amber | `--amber` |
| `failure` | coral | `--coral` |
| `pending` | slate | `--slate` |
| `queued` | blue | `--blue` |
| `waiting` | violet | `--violet` |
| `cancelled` | grey | `--grey` |
| `rejected` | rose | `--rose` |

### Layout Constraints

- DAG edges must **never cross node bounding boxes** — dagre's rank-based layout satisfies this for standard graphs; validate with dense fixtures.
- Per-rank column spacing = the maximum card width in that rank plus the `rankPadding` gap.
- Canvas scrolls horizontally via `.vis-canvas { overflow-x: auto }` when graph width exceeds viewport.
- On attribute toggle → recalculate node dimensions → `graph.update$.next(true)` to relayout.
- Lanes pack densely with minimal inter-lane gap (~8px margin between stacked `<ngx-graph>` instances).

---

## Extension View Layout

The browser extension presents four distinct surfaces (no persistent canvas — each surface is self-contained):

| Surface | Entry point | Container |
|---------|-------------|-----------|
| Toolbar badge | Always visible | Browser toolbar icon |
| Deployment list popup | Click toolbar icon | Browser popup (`~360px` wide) |
| Notification toasts | Background SW on SSE event | Browser native notification |
| Config / options | Extension options page or popup settings tab | Full options page |

### Popup Panel Layout

Stateless list — re-fetches `GET /api/deployments` on open and on storage change.

```
┌─────────────────────────────┐
│  Loading… / Unconfigured /  │
│  Paused / (empty)           │
│  ─────────────────────────  │
│  [status-chip]  Service     │  ← row 1 (newest)
│  Environment · Version      │
│  @actor  ·  3h ago / UTC    │
│  [Open run #NNN]            │
│  ─────────────────────────  │
│  [status-chip]  Service     │  ← row 2 …
│  …                          │
│  ─────────────────────────  │
│  [Open dashboard]           │
└─────────────────────────────┘
```

- Fixed width ~360px; height content-driven.
- Shows last N events (newest-first); N = `popupCount` (default 5), configurable 1–50.
- Filtered by service+environment watch filter and status filter.
- "Open dashboard" shown whenever a URL is configured.
- Uses the same glass-surface tokens as the SPA (`.glass-base`, ink tokens, status palette).

### Config Panel Layout

```
┌─────────────────────────────┐
│  Dashboard URL  [________]  │
│  Watching  [●──────] ON     │
│  ─────────────────────────  │
│  [Watch all except|Watch only] │
│  Services  [ ] svc-a  [ ] svc-b │
│  Environments  [ ] prod  [ ] staging │
│  ─────────────────────────  │
│  Status filter              │
│  [ ] pending  [ ] queued  … │
│  ─────────────────────────  │
│  Show last N events  [5]    │
└─────────────────────────────┘
```

- Master Watching switch is prominent at top.
- Filter section (watch scope + status filter + popup count) is visually dimmed when switch is OFF.
- Mode segmented control + two checkbox lists (services, environments) + status checkboxes (8) + count picker (1–50).
- Persists all settings to extension storage.
