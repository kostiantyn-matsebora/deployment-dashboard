# Extension Specification — `@deployment-dashboard/extension`

**Status:** MVP · **Issue:** [#301](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/301) · **Date:** 2026-06-09

Thin, read-only cross-browser WebExtensions MV3 client for an existing dashboard instance. No backend changes — consumes the existing read API and SSE contract as-is.

## Sources of truth

| Source | Owns |
|---|---|
| [`docs/API_SPECIFICATION.md`](API_SPECIFICATION.md) | Consumed endpoint contracts, SSE channel spec, data model. |
| [`docs/api/openapi.yaml`](api/openapi.yaml) | Wire shapes — authoritative schema for all consumed endpoints. |
| [`docs/design/views.md` §Extension View Layout](design/views.md#extension-view-layout) | Popup and config panel visual layout. |
| [`docs/design/components.md` §Extension Components](design/components.md) | Toolbar badge, popup panel, config components. |

---

## 1. Role

| Aspect | Value |
|---|---|
| Type | Browser extension — WebExtensions MV3 |
| Browsers | Chrome, Edge, Firefox |
| Access mode | Read-only — no writes to the dashboard backend |
| Backend dependency | Existing dashboard instance (URL configured by user) |
| Backend changes | None |
| MVP scope | Issue #301 |
| v2 scope (deferred) | Live services×environments matrix popup — issue [#302](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/302) |

---

## 2. Stack

| Aspect | Value |
|---|---|
| Language | TypeScript |
| Bundler | Vite multi-entry |
| Unit tests | Vitest |
| Test command | `npm test` |
| Build command | `npm run build` |
| Location | `frontend/extension/` |
| Packaging | Per-browser zip via `scripts/package_extension.py` |
| CI | `.github/workflows/extension.yml`, gated through `_ci-green` |

---

## 3. Consumed API contract

All endpoints are unauthenticated reads. The full wire schema is in [`docs/api/openapi.yaml`](api/openapi.yaml) — do not duplicate it here.

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /api/events/stream` | Live deployment events | SSE; `event: deployment`; `id:` = row id; `Last-Event-ID` replay |
| `GET /api/matrix` | Badge seed | `current` per slot — effective status at startup |
| `GET /api/services` | Config lists | Populate include/exclude filter checkboxes |
| `GET /api/environments` | Config lists | Populate include/exclude filter checkboxes |
| `GET /api/deployments` | Popup list | Newest-first `{items}`; re-fetched on popup open and on storage change |

### Key wire fields (from `deployment_events`)

| Field | Wire name | Notes |
|---|---|---|
| Service identifier | `service` | Shown in popup header; used for filter matching |
| Environment | `environment` | Shown in popup; used for filter matching |
| Version | `version` | Shown in popup |
| Status | `status` | Values: `pending` \| `queued` \| `waiting` \| `in-progress` \| `success` \| `failure` \| `cancelled` \| `rejected` |
| Timestamp | `happened_at` | Emitter-supplied; used for relative elapsed + absolute UTC |
| Actor | `actor` | Shown with `@` prefix |
| CI run URL | `run_url` | Toast link + popup "Open run" |
| CI run number | `run_number` | Shown as "Open run #NNN" |

---

## 4. Surfaces

Four independent surfaces — no persistent canvas.

### 4.1 Toolbar badge

Always-visible toolbar icon reflecting overall deployment health within watch scope.

| State | Visual | Trigger |
|---|---|---|
| Idle | Base product logo mark, no overlay | No in-flight or failed deployments in watch scope |
| In-flight | Amber badge overlay with count | ≥ 1 `in-progress` slot (status filter enabled) |
| Failed | Coral badge overlay with count | ≥ 1 `failure` slot (status filter enabled) |

- **Base icon:** product logo mark (same mark as SPA brand region).
- **Count:** per-(service×environment)-slot count of matching `failure` / `in-progress` events; integer top-right; hidden when 0.
- **Priority:** `failure` takes precedence over `in-progress` when both are non-zero.
- **Status filter gate:** disabling `failure` in the status filter removes the coral state; disabling `in-progress` removes amber.

### 4.2 Deployment list popup (~360px)

Opened on toolbar icon click. Shows the last N in-scope deployment events (raw event rows, newest-first); N = `popupCount` (default 5).

**Data source:** `GET /api/deployments` (newest-first `{items}`), filtered by the service+environment watch filter and the status filter, capped at `popupCount`. Stateless — re-fetches on open and on storage change. No `latestChange` cache.

**States:**

| State | Shown when |
|---|---|
| Loading | Fetch in progress |
| Unconfigured | No `dashboardUrl` set |
| Paused | Master Watching switch is OFF |
| Empty | Fetch succeeded; no events match filters |
| List | ≥ 1 matching event |

**Per-row fields:**

| Field | Wire field | Rendering |
|---|---|---|
| Service | `service` | Plain text header |
| Environment | `environment` | Plain text |
| Version | `version` | Headline identifier |
| Status | `status` | `status-chip` (reuses SPA token/class) |
| Actor | `actor` | `@` prefix |
| Elapsed | `happened_at` | Relative elapsed ("3h ago") |
| Timestamp | `happened_at` | Absolute UTC below elapsed |
| Run link | `run_url` / `run_number` | `hist-link` styled "Open run #NNN" (reuses SPA class) |

- "Open dashboard" link shown whenever a `dashboardUrl` is configured.
- Fixed width ~360px; height content-driven.
- Uses the same glass-surface tokens as the SPA (`.glass-base`, ink tokens, status palette).

### 4.3 Notification toasts

Browser notifications fired by the background service worker on SSE events within watch scope.

- **Trigger:** any new SSE `event: deployment` whose `(service, environment)` matches the watch filter AND whose `status` is enabled in `statuses` config.
- **Default behavior:** all 8 statuses enabled → notification fires on every status transition.
- **User control:** narrow via the status filter (e.g. enable only `failure` + `success` to reduce noise).
- Toast links to the CI run URL (`run_url`); body shows service, environment, version, status.

### 4.4 Options/config page

Full options page (or popup settings tab).

| Control | Description |
|---|---|
| Dashboard URL | Text input — base URL of the dashboard instance |
| Master Watching switch | Prominent ON/OFF toggle — gates all extension activity |
| Mode segmented control | **"Watch all except"** (default) / **"Watch only"** |
| Services list | Checkbox list populated from `GET /api/services` |
| Environments list | Checkbox list populated from `GET /api/environments` |
| Status filter | Per-status enable/disable checkboxes; all 8 statuses enabled by default |
| Show last N events | Integer picker (1–50); default 5 — controls popup list depth |

**Filter semantics:**
- **"Watch all except"** (default): all services/environments active; checked items excluded.
- **"Watch only"**: only checked items active; unchecked items excluded.
- Filter controls visually dimmed and non-interactive when master switch is OFF.
- Status filter gates the popup list, notifications, and the badge (e.g. disabling `failure` removes coral badge).

---

## 5. MV3 SSE survival strategy

Service workers in MV3 are ephemeral — they can be torn down at any time.

| Mechanism | Purpose |
|---|---|
| Service worker + `EventSource` | Primary SSE connection |
| `Last-Event-ID` persisted to `storage.local` | Gap-free replay across SW teardown/restart |
| `alarms` API (~30 s interval) | Keepalive and reconnect trigger |
| Serialized promise queue | Prevents slot-status map corruption from rapid successive SSE events |
| Offscreen document (v2 hardening option) | Persistent `EventSource` host — documented option, out of MVP scope |

On SW restart: read `lastEventId` from `storage.local`, reconnect with `Last-Event-ID` header → server replays missed events in insert order.

---

## 6. Badge reducer

Derives toolbar badge state from the slot-status cache.

1. **Seed:** call `GET /api/matrix` at startup; read `current.status` for each `(service, environment)` slot within watch scope; populate `slotStatus` cache.
2. **Live delta:** each SSE `event: deployment` message is processed through a **serialized promise queue** (prevents race conditions from rapid successive events); updates the `slotStatus` cache entry for the `(service, environment)` slot.
3. **Status filter gate:** only count slots whose status is enabled in the `statuses` config.
4. **Reduce:** count `in-progress` slots → amber badge with count; count `failure` slots → coral badge with count; `failure` takes precedence when both non-zero; both zero → idle (no overlay).

---

## 7. Storage schema

### `chrome.storage.sync` — user settings (synced across devices)

| Key | Type | Default | Description |
|---|---|---|---|
| `dashboardUrl` | `string` | `""` | Base URL of the dashboard instance |
| `watching` | `boolean` | `true` | Master Watching switch state |
| `filterMode` | `"exclude"` \| `"include"` | `"exclude"` | "Watch all except" = `exclude`; "Watch only" = `include` |
| `services` | `string[]` | `[]` | Selected service identifiers for the active filter mode |
| `environments` | `string[]` | `[]` | Selected environment identifiers for the active filter mode |
| `statuses` | `string[]` | all 8 enabled | Enabled statuses: `pending`, `queued`, `waiting`, `in-progress`, `success`, `failure`, `cancelled`, `rejected`; gates popup list, notifications, and badge |
| `popupCount` | `number` | `5` | Number of events to show in the popup list (1–50) |

### `chrome.storage.local` — runtime state (device-local)

| Key | Type | Description |
|---|---|---|
| `lastEventId` | `string \| null` | SSE cursor — last received `id:` value; used for `Last-Event-ID` reconnect |
| `slotStatus` | `Record<string, string>` | Badge cache — keyed `"service|environment"` (pipe) → latest effective `status` |

Note: `latestChange` has been removed. The popup is stateless and re-fetches `GET /api/deployments` on each open.

---

## 8. Build and package

| Step | Command / artifact |
|---|---|
| Unit tests | `npm test` (Vitest) |
| Production build | `npm run build` |
| Per-browser zip | `scripts/package_extension.py` — outputs to `frontend/extension/dist-zips/`: `chrome.zip`, `edge.zip`, `firefox.zip` |
| CI workflow | `.github/workflows/extension.yml` — test → build → package; gated through `_ci-green` branch protection |

---

## 9. Out of scope (MVP)

| Item | Notes |
|---|---|
| Offscreen document for persistent SSE | Documented v2 hardening option; not in MVP |
| Services×environments matrix popup | v2 — issue [#302](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/302) |
| Backend changes | None required |
| Write operations | Extension is read-only |
