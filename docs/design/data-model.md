# Data Model

## Deployment Event (11 visible fields)

| Field | Type | Required | UI Treatment |
|-------|------|----------|--------------|
| `component` | string | Yes | Row header (Matrix), lane header (Swimlanes). Implicit — not in field picker. |
| `environment` | string | Yes | Column header (Matrix), promoted identifier bottom-right (Swimlanes). Toggleable in Swimlanes picker. |
| `version` | string | No | Headline identifier (Matrix tile). Secondary top-left (Swimlane node). Up to 50 chars, never truncated. |
| `status` | enum | Yes | 8 values — **effective** (mutate/mutated the environment): `success`, `in-progress`, `failure`; **next** (the latest deployment beyond the live one): `pending`, `queued`, `waiting`, `cancelled`, `rejected`. Tile/box colour is driven by the effective status only; next-status appears as a `.ctx-badge` layered on the tile, not as the box colour. Implicit — not in field picker. |
| `run_url` | string | No | ↗ "run" dashed link. Opens in new tab. |
| `sha` | string | No | Plain mono hex. Mid-row left (Matrix), bottom-left (Swimlane). |
| `run_number` | string | No | # prefix. Mid-row right cluster. |
| `ref` | string | No | ⎇ prefix. Branch name or PR number. Mid-row left (Matrix), body col 1 (Swimlane). |
| `actor` | string | No | @ prefix. Headline row right (Matrix), body col 2 (Swimlane). |
| `happened_at` | datetime | Yes | Rendered as elapsed ("3h ago") on tiles/nodes. Elapsed + absolute UTC in drawer/inspector. |
| `parrent_deployments` | GUID[] | No | Matrix: ⟵ N parents text. Swimlanes: edges only (text intentionally omitted). Drawer/Inspector: list of truncated GUIDs. |

> **`id`** is synthetic — it NEVER appears in any visible UI surface. No fields outside this 11-field whitelist may appear in the UI.

> **`namespace`** (optional, ≤ 128 chars) scopes `service` into the composite identity surfaced as `component`. It is **not** a standalone visible field: when present it prefixes the `component`/lane header as `namespace/service`, and only when a bare service name collides across namespaces (#353). Absent ⇒ the component renders unprefixed (legacy rows unchanged).

## Swimlane Edge Derivation

Edges derived from each node's `parrent_deployments` array. Only intra-service edges are rendered — cross-service relationships are ignored.

## Attribute Visibility Pickers

### Matrix Toggles (8)

`version`, `run_url`, `sha`, `run_number`, `ref`, `actor`, `happened_at`, `parrent_deployments`

Default: **all ON**.

### Swimlanes Toggles (8)

`environment`, `version`, `run_url`, `sha`, `run_number`, `ref`, `actor`, `happened_at`

`parrent_deployments` is intentionally absent — the graph edges already convey parent relationships.

Default: **all ON**.

---

## KPIs & Derived Values

| KPI | Derivation | Class Modifier |
|-----|-----------|----------------|
| **Services** | Count of distinct `component` values in rendered data | — |
| **Environments** | Count of distinct `environment` values in rendered data | — |
| **In-flight** | Count of slots where state ∈ {running-only, run-last, run-fail-last, run-fail-only} | `.is-warn` (amber text) |
| **Failed** | Count of slots where state ∈ {fail-last, run-fail-only} | `.is-bad` (coral text) |

KPI counts derive from visible data only — filtered by the glob service filter (`dd:svcFilterMode` / `dd:svcPatterns`) and the Columns env filter (`dd:colHidden`). No invented metrics.

---

## Feed Grouping & Search (#397)

The Feed view and feed dock read the same `GET /api/deployments` list endpoint as the Swimlanes drawer/inspector, not a bespoke endpoint. Two list-endpoint query params and one grouping key are specific to the Feed surfaces:

| Param / key | Type | Description |
|---|---|---|
| `q` (query param) | string, max 200 chars | Server-side free-text search — case-insensitive substring match against `service`, `namespace`, `environment`, `version`, `status`, `actor`, `ref`, `sha`, `deployment_id`, `run_number`; a row matches when **any** field contains the value. Composes by logical AND with the structured filters (`service`/`environment`/`status`/`deployment_id`/`since`/`until`) and is applied **before** cursor pagination — `next_cursor` pages stay consistent for a fixed `q`. Empty/absent ⇒ no text filter. |
| `cursor` / `next_cursor` (query param / response field) | string, opaque | Cursor pagination pair. `cursor` requests the next page from a prior `next_cursor`; `next_cursor: null` marks the final page. |
| `deployment_id` (grouping key) | string | Not new — the existing wire field. The Feed surfaces use it as the **grouping key**: one roll-up per distinct `deployment_id`. Group order and event order within a group are newest-first by `happened_at`. |

The Feed surfaces are the only UI surfaces that show `deployment_id` — it is not part of the 11-field Matrix/Swimlanes whitelist above, but it is a real wire field, not an invented one.

## Extension Field Usage

The extension popup panel and notification toasts consume a subset of the existing [Deployment Event](#deployment-event-11-visible-fields) fields — no new fields are required.

| Surface | Fields consumed |
|---------|----------------|
| Toolbar badge | `status` (effective only — `success` / `in-progress` / `failure`) |
| Notification toast | `component`, `environment`, `version`, `status`, `run_url`, `run_number` |
| Latest-change popup | `component`, `environment`, `version`, `status`, `actor`, `happened_at`, `run_url`, `run_number` |

- The popup renders `happened_at` as both elapsed and absolute UTC (same as the drawer/inspector).
- `run_url` and `run_number` together produce the "Open run" link (same `hist-link` pattern as the SPA).
- No additional fields beyond the 11-field whitelist are surfaced.

---

## Analytics Derived Metrics

Analytics metrics are **server-computed** from the `deployment_events` log. They are NOT part of the 11-field visible whitelist and do NOT appear on tiles, nodes, drawers, or the inspector. The SPA receives pre-aggregated responses from `/api/analytics/*` and renders them in the Analytics view only.

### DORA Four Keys — Definitions

| Key | Definition | Unit | `approximated` |
|---|---|---|---|
| **Deployment Frequency** | Terminal `success` events per day over the window | `per_day` | false |
| **Lead Time for Changes** | Approximated time from first event in a `parent_deployments` chain to the configured production terminal `success` event | `hours` | **true** |
| **Change Failure Rate** | `failure / (success + failure)` over terminal events in the window | `ratio` (0–1) | false |
| **Time to Restore** | Median `restored_at − failed_at` across incidents in the window | `minutes` | false |

**Lead-time approximation (binding).** True DORA lead time (commit → prod) is NOT in the event log — the store carries deployment-state events, not commit timestamps. Lead time is approximated via `parent_deployments` promotion chains that reach the configured production terminal. The API flags this with `approximated: true`; the SPA MUST surface the label.

> **Operator note.** The promotion-funnel ladder and the production terminal are operator-configured via `ANALYTICS_FUNNEL_ENVIRONMENTS` (default `dev,staging,qa,preprod,prod`; last entry = production terminal for lead-time; values matched case-insensitively against deployment `environment`). See [Configuration — API](../guide/configuration/api.md#api).

### Classification Thresholds

The server assigns each KPI a band (`AnalyticsClassification`) based on DORA industry thresholds. Bands:

| Band | CSS class | Color token |
|---|---|---|
| `elite` | `.an-class-chip.elite` | `--emerald` |
| `high` | `.an-class-chip.high` | `--blue` |
| `medium` | `.an-class-chip.medium` | `--amber` |
| `low` | `.an-class-chip.low` | `--coral` |

Classification logic is server-side (in `GET /api/analytics/dora`); the SPA applies the chip class from the `classification` field verbatim.

### Aggregation Conventions (server-side)

- **Terminal-only.** Frequency and CFR count `success` / `failure`; non-terminal statuses (`pending`, `queued`, `waiting`, `cancelled`, `rejected`, `in-progress`) are excluded from those rates.
- **Duration.** Per `deployment_id`: `last(happened_at) − first(happened_at)` in minutes. Single-row deployments (no measurable span) are excluded from bins and percentiles.
- **Incident.** A `failure` in a `(service, environment)` slot followed by a later `success` in the same slot. An unresolved failure (no subsequent success in the window) has `restored_at: null` / `duration_minutes: null` and sorts first. `severity` is derived from `duration_minutes` (longer → higher; unresolved → `critical`).
- **All ordering** by `happened_at` (emitter-supplied), consistent with §8 of `api-guidelines.md`.
- **Window clamp.** The requested `window` is clamped server-side to `HISTORY_RETENTION_DAYS`; `window.clamped = true` when narrowed. The SPA surfaces the clamp.

---

## Presets Envelope

**Storage keys:**

| Key | Type | Purpose |
|---|---|---|
| `dd:presets` | JSON array | All saved preset envelopes. |
| `dd:presetActive` | string | Name of the last-applied preset. Absent when no preset has been applied, or after the active preset is deleted or all settings are reset. |

**Envelope shape:**

```json
{
  "version": 1,
  "name": "<user-supplied string, max 60 chars>",
  "settings": { ... }
}
```

**Version guard.** On load, envelopes with `version !== 1` are silently dropped. The `version` field is checked before any field access.

**Settings keys captured in `settings`:**

| Key | Type | Description |
|---|---|---|
| `theme` | `"dark" \| "light" \| "auto"` | Active theme token. |
| `notifEnabled` | `boolean` | Notification master switch state. |
| `notifStatuses` | `string[]` | Enabled notification statuses (subset of the 8). |
| `notifSvcMode` | `"exclude" \| "include"` | Notification service filter mode. |
| `notifSvcPatterns` | `string[]` | Notification service glob patterns. |
| `notifEnvMode` | `"exclude" \| "include"` | Notification environment filter mode. |
| `notifEnvPatterns` | `string[]` | Notification environment glob patterns. |
| `view` | `"matrix" \| "swimlanes" \| "feed" \| "analytics"` | Active view tab. Route-driven — applying restores the matching route (`withViewRealign`), not just an internal re-render. |
| `svcFilterMode` | `"exclude" \| "include"` | Services board glob filter mode. |
| `svcPatterns` | `string[]` | Services board glob patterns. |
| `failuresOnly` | `boolean` | Failures-only toggle state (Matrix). |
| `matFieldsOn` | `string[]` | Active Matrix field keys. |
| `visFieldsOn` | `string[]` | Active Swimlanes field keys. |
| `colOrder` | `string[]` | Environment column order (Matrix). |
| `colHidden` | `string[]` | Hidden environment names (Matrix). |
| `laneCollapsed` | `object` (`svc → boolean`) | Collapse state per service lane (Swimlanes). |
| `laneAutoScroll` | `boolean` | Auto-scroll-to-change state (Swimlanes). |
| `predicate` | `string` | Active correlation predicate key (Swimlanes). |
| `timeWindow` | `string` | Active correlation time-window value (Swimlanes). |
| `svcFilter` | `string` | Free-text service filter input value (Matrix + Swimlanes). Persisted under `dd:svcFilter`. |
| `feedGrouped` | `boolean` | Group-by-deployment toggle state, shared by the Feed view and the feed dock. Default `true`. |
| `feedDockOpen` | `boolean` | Feed dock open/closed preference. Default `false`. |

**Apply fallback.** Unknown or missing keys in `settings` are silently ignored; the corresponding live setting retains its current value. Unknown array entries for field keys are dropped; if the result is empty, all fields default ON.

**Export/import format.** Each exported file is a single envelope (not an array). Filename: `dd-preset-<slug>.json`. Import rejects array inputs (old bulk format) and requires `version === 1`.

---

## Derived Field Rendering

- The `ref` field renders as a branch name or PR number per its domain definition.
- The `happened_at` field renders as elapsed time on tiles and nodes, and as elapsed plus absolute UTC in drawer and inspector rows.
- The bottom-section fallback chain for split tiles: `version` → `sha` → `ref` → `run_number`.
