# Frontend Requirements

Requirements distilled from design-iteration conversations. One requirement per bullet. Refines and extends `docs/SAD.md` §7 "Dashboard Frontend (MVP)".

## Functional

### Views

- The dashboard provides four views — **Matrix**, **Swimlanes**, **Feed**, and **Analytics** — switchable via a top-nav segmented control, in that tab order.
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

### Column visibility and order (Matrix only)

- The Matrix view provides a column visibility picker (Columns button, `⊞`) that lets the user show or hide individual environment columns.
- Hiding an environment column fully removes it from the grid (header + all cells); no placeholder column remains.
- The last visible environment column cannot be hidden.
- Visible environment columns are draggable to reorder via a `⠿` grip handle on each column header.
- A "Show all · reset order" action in the Columns popover restores all columns to visible and resets to the default column order.
- Column visibility (hidden set) and column order persist client-side to `localStorage` keys `dd:colHidden` and `dd:colOrder`.
- Both persistence keys are cleared by "Show all · reset order".
- On reload, persisted column state is restored; a stale `colOrder` (environment set changed) falls back to the default order.
- The Fields button and Columns button each display an accent active state plus a numeric count badge when their respective hidden counts are greater than zero. The badge and accent clear when the count returns to zero.
- Each button's tooltip reflects the current hidden count: `"Fields — N field(s) hidden"` / `"Columns — N environment(s) hidden"` when N > 0; default label text when N = 0.

### Service filter — glob patterns (Matrix + Swimlanes)

- Both Matrix and Swimlanes views provide a **glob pattern filter** for services, accessible via a topbar **Services** button that opens a popover.
- The popover contains:
  - A **mode segmented control**: "Show all except" (exclude mode) or "Show only" (include mode).
  - A list of **removable pattern chips** — one chip per active pattern, each with a remove (`×`) button.
  - An **inline text input** with an autocomplete dropdown populated from known service names.
- **Service identity.** Each slot is keyed by `(namespace, service)`. Services with a non-null `namespace` have the composite identity `namespace/service`. Services with no namespace are identified by the bare `service` name.
- **Namespace display (render-on-collision).** A `namespace/` prefix is rendered in the Matrix row label and Swimlanes lane label **only** when two or more services share the same name under different namespaces; otherwise the bare service name is shown.
- **Glob syntax:** `*` matches any sequence of characters; `?` matches any single character. All other characters are literal. Matching is case-insensitive.
- **Pattern matching rules:**
  - A pattern **containing `/`** is matched against the full `namespace/service` string.
  - A pattern **without `/`** is matched against the `service` segment alone, across all namespaces — backward-compatible with all existing saved patterns.
- A service is **visible** when:
  - Exclude mode: it does not match any active pattern (or no patterns are set — show all).
  - Include mode: it matches at least one active pattern (or no patterns are set — show all).
- **Autocomplete** is populated from composite identities (`namespace/service` for namespaced rows, bare name for null-namespace rows) derived from received data — no configuration required.
- Hiding a service **fully removes** its Matrix row and Swimlanes lane — no placeholder remains.
- The existing inline "filter services…" text input (substring match) and "Failures only" pill toggle coexist with this filter independently.
- The **KPI stat chips** (SERVICES / ENVS / IN-FLIGHT / FAILED) recompute over visible services × visible environments — the glob service filter and the Columns env filter both affect the counts.
- Mode and pattern list persist to `localStorage` keys `dd:svcFilterMode` and `dd:svcPatterns`.

### Details surfaces

- Clicking any slot in the Matrix view opens a side drawer showing the per-slot deployment history.
- Clicking any node in the Swimlanes view selects it and updates a persistent Inspector panel.
- The history drawer and Inspector panel always display every visible domain-model field regardless of attribute-picker state.

### Header surfaces

- The header displays only the application brand name ("Deployment Dashboard") — no sub-line, no docs icon in the topbar.
- A KPI strip in the header surfaces services count, environments count, in-flight count, and failed count, all derived from rendered data.
- A live/SSE indicator surfaces real-time connection status in the header.
- A theme switcher in the header provides three modes — dark, light, auto.
- The auto theme mode resolves the active theme via the system `prefers-color-scheme` media query.
- The user's theme selection persists across reloads via `localStorage`.
- A **bell toggle** in the header enables/disables browser notifications. Toggling ON for the first time triggers the browser permission request (lazy permission). The toggle reflects the current enabled state. When the browser does not support notifications, the permission is denied, or the page is not in a secure context, the toggle is hidden or disabled.

### Footer

- A fixed glass footer bar is anchored to the viewport bottom and persists across all views.
- The footer left side contains:
  - A **version chip** sourced from `GET /api/version`; displayed as `v` + version string.
  - A **Documentation** link.
- The footer right side contains the copyright line `© 2026 @kostiantyn-matsebora · MIT License`.
- The version chip is hidden while the version response is loading.
- On `GET /api/version` error or non-200 response the version chip falls back to `0.0.0-dev`.
- Source: `GET /api/version` (unauthenticated); response `{ version: string }`.

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

### Browser notifications

> **Scope.** Opt-in desktop notifications driven by the existing deployment SSE stream — no new backend.

**Permission model.**
- Permission is requested **lazily** — only when the user first enables notifications via the topbar bell toggle.
- Permission is never requested on page load.
- The feature degrades silently when the browser does not support the Web Notifications API, when the user denies permission, or when the page runs in an insecure context.

**Event coverage.**
- Notifications fire on **status transitions** only: initial load, SSE replay, and backfill events are suppressed.
- All 8 deployment statuses are covered.
- De-duplication: one logical change produces exactly one notification.

**Notification payload.**
- Content: service name · environment · version · status label.
- Clicking a notification focuses the dashboard tab and opens the related CI/CD run (`run_url`).

**Three independent filter axes** (all persisted to `localStorage`):

| Axis | Options |
|---|---|
| Status | Per-status enable/disable (all 8 deployment statuses) |
| Service | Glob pattern filter — "Watch all except" (exclude) OR "Watch only" (include) mode; same widget as the services board filter |
| Environment | Glob pattern filter — "Watch all except" (exclude) OR "Watch only" (include) mode; same widget as the services board filter |

**Glob matching (service and environment axes).** Pattern syntax: `*` = any chars, `?` = one char, case-insensitive. Matching upgraded from exact-match to glob in #351.

**Data source.** The existing `GET /api/events/stream` (deployment SSE) — no new API endpoints.

**Scope limits.**
- Foreground and backgrounded tab only — no service worker, no push notifications.
- No persistence of notification history in the SPA.

### Live interactions

- Hovering any version anywhere in the Matrix amber-highlights every tile across environments where the same version is deployed.

### Feed

- The dashboard provides a **deployment-event feed** with two surfaces: a toggleable bottom dock (visible on every view) and a full-page **Feed** view — the 3rd tab in the top-nav segmented control, ordered **Matrix → Swimlanes → Feed → Analytics**.
- Both surfaces render the same chronological event log, either **flat** (one row per event) or **grouped by `deployment_id`** (roll-up row + expandable detail), driven by one shared grouped/flat toggle state. Default: grouped ON.
- **Feed dock.**
  - Opened/closed via a persistent topbar icon button, visible on every view. Collapsed (closed) by default; the open/closed state persists across reloads.
  - Shows the **last 8** deployment events (or groups), newest-first.
  - New events arrive via the existing deployment SSE stream and prepend to the dock with a one-shot flash animation — no page reload, no polling.
  - The dock is suppressed while the Feed view itself is active — the page IS the full log — without discarding the persisted open/closed preference; the topbar toggle button is disabled (dimmed) while on the Feed view.
  - An "Open feed →" affordance switches to the Feed view/tab.
- **Feed view.**
  - A top-level route rendering the full chronological event history, not bounded to the last 8.
  - Loads pages via cursor-based infinite scroll (`cursor` / `next_cursor`) as the user scrolls near the bottom of the log.
  - A search input performs **server-side free-text search** via the `q` query param on `GET /api/deployments` — it searches the full history, not only the rows currently rendered, and composes by logical AND with any other active structured filters. A new search resets pagination to the first page.

### Analytics view

- The dashboard provides a fourth view — **Analytics** — accessible via the top-nav segmented control as the 4th tab, after Matrix, Swimlanes, and Feed.
- The Analytics view is **read-only** — no user writes; CI/CD writes are the sole data source.
- The period selector exposes three windows: **7d**, **14d**, **30d**; only one may be active at a time.
- The active window is **bounded server-side** by `HISTORY_RETENTION_DAYS`; when `window.clamped === true` the SPA surfaces the clamp in the period selector subtitle ("bounded by HISTORY_RETENTION_DAYS").
- All aggregation is **server-side**; the SPA MUST NOT compute p95 / group-by / frequency counts over raw deployment history client-side.
- The DORA KPI band displays **four keys**: Deployment Frequency (`per_day`), Lead Time for Changes (`hours`), Change Failure Rate (`ratio`), and Time to Restore (`minutes`).
- Each DORA KPI card renders: formatted value + unit, a performance classification chip (`elite` / `high` / `medium` / `low`), a signed trend chip vs the prior half-window (direction semantics: up = good for frequency; up = bad for CFR, lead-time, MTTR), and a per-day sparkline.
- The Lead Time card MUST display a visible approximation label; the value MUST NOT be presented as measured commit→prod lead time (source: `api-guidelines.md` §12 lead-time caveat).
- The chart grid contains **8 charts** backed by the 9 focused analytics endpoints:
  - Deployment frequency over time — stacked bars, success vs failure per day (`GET /api/analytics/frequency`).
  - Change failure rate trend — daily CFR line + dashed 15% elite reference line (`GET /api/analytics/change-failure-rate`).
  - Deployment duration distribution — histogram bins (minutes) + p50 and p95 markers (`GET /api/analytics/duration-histogram`).
  - Promotion funnel — operator-configured promotion ladder (default `dev,staging,qa,preprod,prod`) sankey/funnel, count + conversion per stage (`GET /api/analytics/promotion-funnel`).
  - Status distribution — donut of all 8 statuses, zero-filled for stable slice set (`GET /api/analytics/status-distribution`).
  - Deploy heatmap — 7-row (day-of-week) × 24-col (UTC hour) intensity grid (`GET /api/analytics/heatmap`).
  - Top deployers — leaderboard of actor + count, descending, default 10 entries (`GET /api/analytics/top-deployers`).
  - Time to restore — recent incidents list, worst-first; each row shows service, environment, elapsed, severity chip (`GET /api/analytics/incidents`).
- The DORA KPI band data comes from `GET /api/analytics/dora` (a 9th endpoint — not one of the 8 charts).
- Every analytics GET carries a weak `ETag`; the SPA SHOULD send `If-None-Match` for `304` short-circuit on unchanged data.
- The Analytics view uses `ngx-echarts` (`echarts` as peer) for all 8 chart renders. See `docs/design/libraries.md` for rationale and version.

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
- The fields picker, columns picker, correlation picker, and time-window control are on-demand header icon-button popovers.
- The columns picker icon button is hidden when the Swimlanes view is active.
- The theme switcher is a persistent header control.
- The bell toggle is a persistent header control; clicking it toggles notifications on/off.
- When notifications are enabled, a **notification settings popover** is accessible from the bell button area: it exposes the three filter axes (Status, Service, Environment), each with its toggle set.
- Every interactive topbar control carries a concise hover tooltip.
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

### Feed grouping and search

- The `deployment_id` field groups feed events into per-deployment roll-ups; group order and event order within a group are newest-first by `happened_at`.
- Free-text search (`q`) is evaluated **server-side** against `service`, `namespace`, `environment`, `version`, `status`, `actor`, `ref`, `sha`, `deployment_id`, and `run_number` — never computed client-side over already-rendered rows.
