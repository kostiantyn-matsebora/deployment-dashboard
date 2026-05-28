# Data Model

## Deployment Event (11 visible fields)

| Field | Type | Required | UI Treatment |
|-------|------|----------|--------------|
| `component` | string | Yes | Row header (Matrix), lane header (Swimlanes). Implicit — not in field picker. |
| `environment` | string | Yes | Column header (Matrix), promoted identifier bottom-right (Swimlanes). Toggleable in Swimlanes picker. |
| `version` | string | No | Headline identifier (Matrix tile). Secondary top-left (Swimlane node). Up to 50 chars, never truncated. |
| `status` | enum | Yes | `in-progress` / `success` / `failure`. Drives box state and tile color. Implicit — not in field picker. |
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

## Derived Field Rendering

- The `ref` field renders as a branch name or PR number per its domain definition.
- The `happened_at` field renders as elapsed time on tiles and nodes, and as elapsed plus absolute UTC in drawer and inspector rows.
- The bottom-section fallback chain for split tiles: `version` → `sha` → `ref` → `run_number`.
