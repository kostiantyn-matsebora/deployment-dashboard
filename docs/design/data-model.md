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

KPI counts derive purely from the whitelisted fields — no invented metrics.

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
| **Lead Time for Changes** | Approximated time from first event in a `parent_deployments` chain to a `prod` `success` event | `hours` | **true** |
| **Change Failure Rate** | `failure / (success + failure)` over terminal events in the window | `ratio` (0–1) | false |
| **Time to Restore** | Median `restored_at − failed_at` across incidents in the window | `minutes` | false |

**Lead-time approximation (binding).** True DORA lead time (commit → prod) is NOT in the event log — the store carries deployment-state events, not commit timestamps. Lead time is approximated via `parent_deployments` promotion chains that reach a `prod` environment. The API flags this with `approximated: true`; the SPA MUST surface the label.

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

## Derived Field Rendering

- The `ref` field renders as a branch name or PR number per its domain definition.
- The `happened_at` field renders as elapsed time on tiles and nodes, and as elapsed plus absolute UTC in drawer and inspector rows.
- The bottom-section fallback chain for split tiles: `version` → `sha` → `ref` → `run_number`.
