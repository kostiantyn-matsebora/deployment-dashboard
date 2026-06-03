# Frontend Requirements

Requirements distilled from design-iteration conversations. One requirement per bullet. Refines and extends `docs/SAD.md` §7 "Dashboard Frontend (MVP)".

## Functional

### Views

- The dashboard provides two views — **Matrix** and **Swimlanes** — switchable via a top-nav segmented control.
- The Matrix view renders deployments as a services × environments grid with rows = services and columns = environments.
- The Swimlanes view renders deployments as per-service DAGs with one horizontal swimlane per service.
- The Swimlanes view stacks multiple disconnected DAGs within a service's lane vertically (top-to-bottom), not horizontally.
- The Swimlanes view uses rank-based 2D layout where each node's rank equals its max parent-distance from a root.
- The Swimlanes view places parallel branches at the same rank on different vertical tracks.
- The Swimlanes view derives edges from each node's `parent_deployments` field.
- The Swimlanes view places no cross-service edges — each lane is fully self-contained.
- The Swimlanes view time axis flows left-to-right within each DAG based on `happened_at`.
- The Swimlanes view does NOT render `parent_deployments` as text on nodes — graph edges already convey parent relationships, so the text would duplicate information.

### Filtering and correlation

- The Matrix view supports filtering deployments by service name via an inline text input.
- The Matrix view supports a failures-only pill toggle that hides non-failed states.
- The Swimlanes view provides a correlation predicate picker with single-select choice of five options: `same sha`, `same run_number`, `same actor`, `same version`, `explicit parent`.
- The Swimlanes view provides a separate time-window parameter (e.g. 5 min / 1 hr / 1 day / 7 days) that bounds parent search for non-`explicit-parent` predicates.
- The time-window control is disabled when `explicit parent` is the selected correlation predicate.

### Attribute visibility

- Both views provide an attribute visibility picker that lets the user choose which fields render on deployment elements.
- The Matrix attribute picker exposes 8 toggles: `version`, `run_url`, `sha`, `run_number`, `ref`, `actor`, `happened_at`, `parent_deployments`.
- The Swimlanes attribute picker exposes 8 toggles: `environment`, `version`, `run_url`, `sha`, `run_number`, `ref`, `actor`, `happened_at`. `parent_deployments` is intentionally absent — the graph edges convey it.
- Both attribute pickers default to all options ON.

### Details surfaces

- Clicking any slot in the Matrix view opens a side drawer showing the per-slot deployment history.
- Clicking any node in the Swimlanes view selects it and updates a persistent Inspector panel.
- The history drawer and Inspector panel always display every visible domain-model field regardless of attribute-picker state.

### Header surfaces

- A KPI strip in the header surfaces services count, environments count, in-flight count, and failed count, all derived from rendered data.
- A live/SSE indicator surfaces real-time connection status in the header.
- A theme switcher in the header provides three modes — dark, light, auto.
- The auto theme mode resolves the active theme via the system `prefers-color-scheme` media query.
- The user's theme selection persists across reloads via `localStorage`.

### Operational telemetry — fetcher rate-limit indicator

> **Scope.** This subsection governs a **fetcher operational telemetry surface** in the header. It is distinct from deployment data. The 11-field deployment whitelist (see Data → Visible-field whitelist) governs deployment elements (tiles, nodes, drawers, inspector) and does **not** apply to this indicator.

Sources: [`docs/diagrams/fetcher-rate-limit.md`](../diagrams/fetcher-rate-limit.md), [`docs/api/api-guidelines.md`](../api/api-guidelines.md) §11 "Rate-limit report payload".

**Stream.** The SPA subscribes to `GET /api/control/events/stream` (SSE, event name `component`), filters frames where `event_type === "rate-limit"`, and maintains a **per-adapter map** keyed by `payload.adapter` (last-value-wins per adapter; no history).

**Visibility.** Chips are rendered only after the first qualifying event arrives; absent on initial load. The last-known per-adapter map persists to `localStorage` (key `dd.rateLimit`) and is hydrated on init so chips appear immediately after reload.

**Chips (`.hdr-icons` group).** One compact icon-button per adapter, sorted alphabetically by adapter name. Each displays inline `own_used / own_budget`. Clicking opens that adapter's `p-popover` with the full breakdown. With a single adapter the header looks identical to the single-chip design.

**Popover fields (per chip).**
- `adapter` — CI/CD adapter name; always present.
- `own_used / own_budget` — fetcher's own request usage vs self-throttle budget; displays `—` for null values.
- Usage bar — visual proportion of `own_used / own_budget`; rendered only when `own_budget > 0`; never divides by zero.
- `ci_remaining / ci_limit` — CI/CD-wide remaining vs total quota; displays `—` for null values.
- `reset_at` — window rollover time as local clock string; displays `—` when null.
- `state` badge — `running` (green) or `paused` (amber); styled distinctly.

**Null safety.** Any null numeric or time field renders as an em-dash (`—`). No `NaN` may appear in the UI.

**Live/SSE indicator.** `sseConnected` reflects `EventSource` connection state: `true` on `onopen`, `false` on `onerror` or when the connection is closed. It is independent of data-event arrival — the indicator stays green during idle periods between deployment events (e.g., `: ping` heartbeats keep the connection alive but do not fire JS events).

### Live interactions

- Hovering any version anywhere in the Matrix amber-highlights every tile across environments where the same version is deployed.

## Visual

### Box states (Matrix)

- Each Matrix slot renders one of six box states per the SAD's 6-box-states table.
- The Success state renders a full green tile with version, actor, and elapsed time.
- The Running (no prior) state renders a full orange spinning tile with version only.
- The Running + Failed (no prior) state renders a full orange spinning tile with a ⚠ prev-failed badge and no running-version text.
- The Running + Last Successful state renders a split tile with an orange spinner + running version on top and the last-successful identifier below.
- The Running + Failed + Last Successful state renders a split tile with an orange spinner + ⚠ badge on top (no running version) and the last-successful identifier below.
- The Failed + Last Successful state renders a split tile with a red top + failed version and the last-successful identifier below.
- Split-tile states use a literal dashed divider between the current and last-successful sections.
- The bottom section of any split tile renders a single identifier picked via the fallback chain `version` → `sha` → `ref` → `run_number`.

### Palette and semantics

- The status palette uses green for success, orange for running, red for failed, and amber for the cross-matrix version hover-highlight.
- The status palette is fixed semantic — colours never appear decoratively.

### Identifier prominence

- The Matrix tile renders `version` as its prominent headline identifier.
- The Swimlanes node renders `environment` as the prominent identifier in the bottom-right corner.
- The Swimlanes node renders `version` as a secondary smaller mono identifier.
- The Matrix tile `version` font-size and the Swimlanes node `environment` font-size are matched — the two surfaces' primary identifiers share a size.

### Field treatment on deployment elements

- Fields on Matrix tiles and Swimlanes nodes use mixed visual treatments — position, glyph prefix, typography weight — rather than uniform label/value rows.
- The reader identifies each field on a tile/node by its shape and position, not by a text label.

### Field treatment on details surfaces

- The history drawer and Inspector panel use explicit text label/value rows because they are details surfaces.

### Matrix structure

- The Matrix provides clear visual separation between service rows via a hairline divider plus a service-name left accent.
- The Matrix container has a visible bottom edge so the last row does not visually hang in empty space.

### Swimlanes node structure

- A Swimlanes node has a single top row that spans the full card width (colspan=2). `version` is flush to the card's left edge; `happened_at` is flush to the card's right edge.
- The remaining rows of a Swimlanes node form a 2-column grid: left content sits in column 1, right content in column 2.
- Column 1 of the body holds (top-to-bottom): `ref`, `sha`. Column 2 of the body holds (top-to-bottom): the run cluster (`run_url` + `run_number` + `actor`), `environment`.
- The horizontal gap between body columns is a single uniform value applied to every body row.
- `sha` sits at the bottom-left corner of the node; `environment` sits at the bottom-right corner on the same row.
- Rows scroll horizontally inside the node when their content exceeds the node's width, rather than overflowing the lane.
- Inter-row vertical distance inside a Swimlanes node is uniform across every node regardless of card height; long-version cards may grow taller but the inter-row distance itself does not vary.

## Behavior

### Responsive sizing

- Deployment elements size to their currently visible content.
- Tiles and node cards shrink when attribute fields are toggled off.
- The Swimlanes layout recomputes lane heights, rank-column positions, and total canvas size on every attribute toggle.
- Tiles and node cards stretch horizontally to fit their widest content.
- The `version` field may be up to 50 characters and must render fully on tiles and nodes as a single line, without truncation and without wrap.
- The Matrix grid columns expand to consume available viewport width when content allows.
- The Matrix and Swimlanes containers scroll horizontally when total content width exceeds viewport.
- The Matrix service column remains sticky during horizontal scroll so service names stay visible.
- The Swimlanes lanes pack densely with minimal inter-lane and inter-track gaps.
- Tile content distributes vertically across the available cell height (no large empty middle).

### Layout integrity

- No deployment element overlaps another in either view, regardless of content variance.
- Per-rank column spacing in the Swimlanes equals the maximum card width in that rank plus a fixed gap.
- DAG edges never cross node bounding boxes.
- All elements remain accessible — nothing is clipped, hidden, or rendered behind other surfaces unreachably.
- Split-tile bottom content remains contained within its cell and never visually bleeds into adjacent rows.

### Control surfaces

- The filter input and failures-only toggle are persistent inline elements in the Matrix header.
- The fields picker, correlation picker, and time-window control are on-demand header icon-button popovers.
- The theme switcher is a persistent header control.
- Popover surfaces render above all canvas content via z-index without being clipped by stacking contexts.

## Data

### Visible-field whitelist

- The visible-field whitelist contains 11 fields: `service`, `environment`, `version`, `status`, `run_url`, `sha`, `run_number`, `ref`, `actor`, `happened_at`, `parent_deployments`.
- The `id` field is synthetic and never appears in any visible UI surface.
- No fields outside the visible-field whitelist may appear in the UI.

### Derived values

- KPI counts derive purely from the whitelisted fields (no invented metrics).
- The `ref` field renders as a branch name or PR number per its domain definition.
- The `happened_at` field renders as elapsed time on tiles and nodes, and as elapsed plus absolute UTC in drawer and inspector rows.
