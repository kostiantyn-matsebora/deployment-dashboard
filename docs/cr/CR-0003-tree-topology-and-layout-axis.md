# CR-0003 — Tree-shaped deployment topology and three-layout axis (Matrix / Swim-lane / Workflow-rows)

- **Status:** accepted
- **Trigger:** `TODO` line 5 — "UX: Usually deployment workflow for a service looks more like a tree, for instance dev could be deployed to qa-1 and qa-2, qa-2 can be deployed on uat 2 and qa-1 can be deployed on uat-1 etc.".
- **Change:**
  1. The deployment workflow for a service is a **DAG of environment edges** (not a single linear chain). Real workflows fork (`dev → qa-1`, `dev → qa-2`) and merge / promote along distinct paths (`qa-1 → uat-1`, `qa-2 → uat-2`).
  2. The data model gains two payload fields — `deployment_id` (required, CI/CD-side identifier; unique within a service) and `parent_deployments` (optional list of `deployment_id` references inside the same service) — that allow CI/CD callers to express the topology explicitly. When the explicit list is absent, the server falls back to a per-service correlation rule (see ADR-0001).
  3. The SPA gains a **Layout axis** (FR-13) — three layouts: `Matrix` (legacy services × envs grid), `Swim-lane` (one horizontal lane per service), `Workflow-rows` (one DAG per service drawn with envs as rows). Layout is orthogonal to view (FR-12); all 4 × 3 = 12 (view, layout) combinations are supported.
  4. The matrix wire shape gains a sibling `topology.edges` per service alongside the existing `envs` map; the topology object is always present (possibly empty) per service.
  5. A new `correlationAttribute` picker (server-side default + per-service override + per-user picker via `localStorage` + `?correlationAttribute=…` query parameter) lets ops and users pick which attribute is used for the correlation fallback. Allowed values: `version`, `ref`, `sha`, `actor`, `run`, `ago`.
- **Impact:**
  - **New FR-13** added (Layouts axis — Matrix / Swim-lane / Workflow-rows; persisted in `localStorage.dashboard.layout`).
  - **NFR-09** amended to extend the responsiveness invariant across all three layouts.
  - **§7 Components → API container** — new responsibility: derive per-service topology on every matrix read; expose `GET /api/config/topology` and `PATCH /api/config/topology`.
  - **§7 Components → Dashboard Frontend** — interaction list extended: layout switcher (FR-13), correlation-attribute picker, persisted `dashboard.layout` and `dashboard.correlationAttribute` keys.
  - **§7 Visual layout** (CR-0002) extended with: **Layout axis (FR-13)** table, **Glance exception under FR-13**, **Focus per-layout granularity (FR-13)**.
  - **§7 Configuration — Read API topology** — `appsettings.json` bootstrap, `Topology.CorrelationAttribute`, `Topology.PerServiceOverrides`, precedence rule, rationale.
  - **§7 App Gateway routing matrix** — new rows for `GET /api/config/topology` (no auth) and `PATCH /api/config/topology` (auth-gated).
  - **§7 Data Model → `deployments` table** — `deployment_id`, `parent_deployments` columns; new indexes; topology constraints enforced at ingest by the Write API.
  - **§7 Data Model → Topology Derivation** — inputs, the five-pass algorithm, cycle handling at read time, output shape. **The algorithm itself is captured as ADR-0001** (this CR records the requirement; ADR-0001 records the algorithm decision).
  - **§7 API Contract** — new endpoints `GET /api/config/topology` and `PATCH /api/config/topology`; new `correlationAttribute` query parameter on `GET /api/deployments` and slot endpoints; `POST /api/deployments` validation failure modes for `deployment_id` and `parent_deployments`; matrix response shape extended with `topology.edges`; SSE topology semantics — "topology not carried on the SSE wire; fetched via follow-up GET" (Decision 8 in the initial SAD has been moved into this CR — see "Removed SAD content" below).
  - **§10 Decisions 7, 8, 9** moved out of the initial SAD into this CR (see verbatim text below).
- **References:**
  - SAD §4 FR-13 (new), FR-05 (informational — see CR-0004).
  - SAD §5 NFR-09 (amended — three layouts).
  - SAD §7 "Visual layout" — extensions to CR-0002.
  - SAD §7 "Topology Derivation" — derivation responsibility.
  - SAD §7 API Contract — extended endpoints, parameters, status codes, wire shape.
  - **ADR-0001 — Per-service topology derivation — five-pass algorithm on the read side** (paired).
  - `docs/ui-tree-topology-options.md` — UX design rationale for the layout axis (per-service tree, swim-lane, workflow-rows).
  - Mockup `docs/deployment-dashboard.html` — canonical visual contract for all three layouts.

## Removed SAD content (verbatim) — captured here

### FR-13 — added

> The SPA shall offer three layouts — **Matrix**, **Swim-lane**, **Workflow-rows** — selectable from a top-bar segmented control. Layout selection is orthogonal to view (FR-12): all 4 × 3 = 12 (view, layout) combinations are supported. Layout selection persists client-side in `localStorage` under key `dashboard.layout`. Default: `Matrix` (preserves canonical first paint). Swim-lane and Workflow-rows render per-service topology (§5 "Topology derivation" / §7 "Topology in the wire shape"); when a service has no topology (no explicit `parent_deployments` and the correlation fallback yields no edges), that service renders as a single root chain in those layouts. The mockup (`docs/deployment-dashboard.html`) is the visual contract; the responsiveness invariant in NFR-09 already covers all three layouts.

### NFR-09 — amended (verbatim post-amendment text)

> **UX-RESPONSIVENESS INVARIANT.** The dashboard layout shall reflow correctly under any combination of: service count (1..N), environment count per service (1..N), env-name length (1..32 chars), version-string length (1..50 chars), viewport width (≥ 1024 px), view (Detailed / Compact / Glance / Focus), and layout (Matrix / Swim-lane / Workflow-rows). Under no combination may visual elements overlap such that information is clipped, occluded, or rendered illegible. This includes env labels, deployment boxes, version strings, status badges, connector lines, arrowheads, and fork trunks. Enforced by construction: env-tag + box pairs use CSS Grid (`auto` env-tag column, fixed leaf-width box column); connector geometry is anchored to live `getBoundingClientRect()` measurements re-evaluated via a `ResizeObserver` and a window-resize listener. **Exception (Glance view only):** the env label is rendered INSIDE the deployment rectangle. This is the single allowed overlap of env-tag and box, and is permitted because the Glance pill's vertical extent forces the connector y to cross the env-tag y in any left-of-box layout. The env label remains visible (not clipped) and the connector terminates at the pill's left edge as in other views. **Sibling invariant — service-name single-line auto-width:** the service-name label renders on a single line at its intrinsic width in every View × Layout × Theme combination — no truncation, no ellipsis, no wrap. The service-name container auto-sizes to fit the widest service name in the matrix (same CSS Grid `auto`-track precedent as the env-tag column above). **Sibling invariant — env-header column alignment under expand:** in Matrix layout, the env-header row stays column-aligned with the deployment-row columns under any combination of expanded / collapsed Focus rows. Column widths cannot diverge between header and rows; the header and the body MUST share the same CSS Grid track definition so a Focus row expanding to `--leaf-width-expanded` widens the corresponding header column in lockstep. The same invariant (including both sibling invariants) is mirrored verbatim at the top of `docs/deployment-dashboard.html` (the mockup is the visual contract).

### §7 "Layout axis (FR-13)" — verbatim

> Orthogonal to the four views above, the SPA offers three **layouts**. The user switches between them via a second segmented control in the header (independent of the view switcher); the active layout is persisted in `localStorage` (`dashboard.layout`). All 4 × 3 = 12 (view, layout) combinations are supported.
>
> | Layout | Intent | Topology data required | Render shape |
> |---|---|---|---|
> | **Matrix** | Default first paint — canonical pipeline-matrix layout. Equivalent to the pre-FR-13 contract. | No — environments are columns; each service is a row. | Services × environments grid. |
> | **Swim-lane** | One horizontal lane per service; envs laid out left-to-right along the per-service env DAG (parents to the left of children). | Yes — uses `topology.edges` from the matrix response (§"API Contract"). When a service has no edges, it renders as a single root chain (one node per env, ordered by `deployed_at` of `current`). | Per-service horizontal lane; connectors anchored to `getBoundingClientRect()` per NFR-09. |
> | **Workflow-rows** | One DAG drawn per service with envs as rows; promotes the topology to a first-class visual element. | Yes — same `topology.edges` source. Empty-topology services render as a single root chain (same fallback as Swim-lane). | Per-service vertical DAG; rows are envs, columns are DAG levels. |
>
> Default for first-time visitors: **Matrix** (preserves the canonical first-paint contract).
>
> Layout is **orthogonal** to view (FR-12): the chosen view's attribute picker, density, and 6-box-state rendering remain identical across layouts. Only the spatial arrangement of envs within a service changes.

### §7 "Null-render invariant for nullable attributes" — verbatim

> `ref` and `sha` are the two FR-02 attributes that may legitimately be `null` or absent on a wire payload (per §"deployments table" and §"Matrix response shape — per service" → field rules). When the user selects one of these as a Display attribute and the slot's `current.<attr>` (or `lastSuccessful.<attr>`) value is null or absent:
>
> - The attribute slot in the box body renders empty — no text, no placeholder, no the literal string `"null"` / `"undefined"`.
> - The slot's other selected attributes render normally.
> - The 6-box-state determination is unaffected — `ref`/`sha` are display-only and do not feed state derivation (§7 "6 box states", §7 line referenced for matrix-state derivation).
> - The Topology correlation pass (§"Topology Derivation" pass 3) already excludes deployments whose chosen correlation attribute is null on either side (`P.<correlation-attribute>` equals `D.<correlation-attribute>` is `false` when either operand is null) — no additional handling needed.
>
> This invariant generalises the existing "empty array (`[]`) is a legitimate user choice — render the slot body empty" rule (§7 "Load-time hardening rules") from per-view to per-attribute.

### §7 "Glance exception under FR-13" — verbatim

> The Glance view's "env-tag-inside-pill" rendering (NFR-09 Glance exception) applies in all three layouts. In Matrix layout the pills are inline along the row. In Swim-lane and Workflow-rows, the same pill rendering is used at each node in the DAG, with the env label inside the coloured pill rather than to its left. The mockup (`docs/deployment-dashboard.html`) is the visual contract for this; the responsiveness invariant in NFR-09 is the geometric guarantee.

### §7 "Focus per-layout granularity (FR-13)" — verbatim

> The Focus view's row-gutter affordances (chevron + pin) apply across **all three layouts**. Granularity is layout-specific and codified in `docs/ui-compact-options.md` "Focus view specifics" — Matrix is per service-row, Swim-lane is per service-lane, Workflow-rows is per service-header (one chevron + pin per service expands all of that service's root-to-leaf path rows; path-row-level affordances are out of contract).
>
> - **Pin survives layout switch.** `state.pinned[id]` is layout-agnostic; switching layout while a service is pinned keeps the pin. The expansion semantics adapt to the new layout's granularity but the pinned set itself does not reset.
> - **Focus toolbar hint** renders above all three layouts when View=Focus (not Matrix-only).
>
> The mockup (`docs/deployment-dashboard.html`) is the visual contract; the responsiveness invariant in NFR-09 (including the two sibling invariants in §5) is the geometric guarantee under any expand/collapse state in any layout.

### §7 "Configuration — Read API topology" — verbatim

> Topology is a read-side concern (the Write API surface has no knowledge of correlation). The Read API surface holds the **server-side** configuration and reloads it on every read. Server-side config is mutated only by admin / CI / ops tooling via `PATCH /api/config/topology` (§"API Contract") — the SPA never invokes PATCH. End-user picker preferences live in browser `localStorage` and reach the server as a per-request `correlationAttribute` query parameter on read endpoints (no auth required; reads are unauthenticated). Default values are bootstrapped from the API host's `appsettings.json` on first run and persisted to a single config row in the database thereafter.
>
> ```yaml
> # backend/api/appsettings.json (bootstrap defaults — Read surface)
> Topology:
>   CorrelationAttribute: "version"     # server-side global default; one of: version, ref, sha, actor, run, ago
>   PerServiceOverrides: {}             # service -> attribute; ops-managed; empty by default; updated via PATCH
> ```
>
> | Setting | Type | Default | Notes |
> |---|---|---|---|
> | `Topology.CorrelationAttribute` | string | `"version"` | Server-side global fallback used when the request carries no `correlationAttribute` query parameter and no per-service override applies. Allowed values: `version`, `ref`, `sha`, `actor`, `run`, `ago`. **`id` is explicitly disallowed** — `deployment_id` is the *explicit* key (the referent for `parent_deployments`); using it as a correlation attribute would degenerate to "explicit only" and is a contract violation. |
> | `Topology.PerServiceOverrides` | dict<string, string> | `{}` | Service-name → correlation attribute. Ops-managed; overrides both the server default and any user-supplied `correlationAttribute` query parameter for that service only. Persisted in the database; updated at runtime via `PATCH /api/config/topology`. Setting a service's override to `null` via PATCH removes it. |
>
> **Precedence (per request, per service):** `Topology.PerServiceOverrides[service]` > request `correlationAttribute` query parameter > `Topology.CorrelationAttribute` (server-side default).
>
> Rationale: per-service overrides are an ops-managed contract (e.g. service-b is known to deploy by `sha`, not `version`) — they must not be silently broken by a user picker. The user picker is a *global* hint for services that have no ops override.
>
> The setting is explicitly not surfaced to the Write API: ingest does not depend on the active correlation attribute.

### §7 App Gateway — additional routing-matrix rows

| Method + Path | Upstream | Surface (logical) |
|---|---|---|
| `GET /api/config/topology` | `api:8080/api/config/topology` (read-only mirror of server-side defaults; SPA-readable, no auth) | Read. |
| `PATCH /api/config/topology` | `api:8080/api/config/topology` (auth-gated by `X-Api-Key` at the host; **admin / CI / ops tooling only — not invoked by the SPA**; see §"API Contract") | Write (admin). |

### §7 Data Model → `deployments` table — added columns

| Column | Type | Description |
|---|---|---|
| `deployment_id` | TEXT | **CI/CD-side identifier** for this deployment event (e.g. run id, build number, guid). Required. Unique within `service`. Used as the referent for `parent_deployments`. Distinct from the internal `id` surrogate. |
| `parent_deployments` | TEXT[] (PostgreSQL) / JSON-encoded array (SQLite) | **Explicit topology references.** Zero or more `deployment_id` values of parent deployments. Nullable; an empty array (or NULL) means "no explicit parents — fall back to correlation". Each element must reference an existing or future deployment within the same `service`. |

Added indexes:

| Index | Purpose |
|---|---|
| `UNIQUE (service, deployment_id)` | Enforces `deployment_id` uniqueness within a service; required so `parent_deployments` references resolve unambiguously. |
| `(service, deployment_id)` | Lookup hot path for the topology builder when resolving explicit parents. |

Topology constraints (enforced at ingest by the Write API):

> - `deployment_id` is required and non-empty.
> - `(service, deployment_id)` must be unique — duplicate POSTs are rejected with `409 Conflict`.
> - Every entry in `parent_deployments` must be a non-empty string referencing a `deployment_id` *within the same `service`*. References to a different service are rejected with `400 Bad Request`.
> - A reference to a `deployment_id` that has not yet been ingested is **accepted** and stored verbatim. The topology builder treats it as "dangling" until the missing source lands; reconciliation is automatic on the next read.
> - Cycle prevention: a POST whose `parent_deployments` would, combined with already-ingested references, form a directed cycle is rejected with `400 Bad Request`. Dangling references are excluded from the cycle check (cannot prove a cycle through an unresolved node).

### §7 API Contract — added rows in the methods/paths table

| Method | Path | Success | Description |
|---|---|---|---|
| `GET` | `/api/config/topology` | `200 OK` | **SPA-readable.** Return the server-side topology configuration — global `correlationAttribute` plus the `perServiceOverrides` map. Used by the SPA to display the system default in the picker so users can distinguish "system default" from their personal override. No auth. |
| `PATCH` | `/api/config/topology` | `200 / 400 / 401` | **Admin / CI / ops tooling only — not invoked by the SPA.** Update the server-side topology correlation attribute. Auth-gated by the same `X-Api-Key` middleware as `POST /api/deployments`. The SPA expresses per-user picker preferences via the `correlationAttribute` query parameter on read endpoints, not by writing to this endpoint. |

The "POST /api/deployments validation — failure modes" table gained these rows:

| Condition | Status |
|---|---|
| Missing or empty `deployment_id` | `422 Unprocessable Entity` |
| Duplicate `(service, deployment_id)` — an event with this id already exists | `409 Conflict` |
| `parent_deployments[i]` references a `deployment_id` that exists but belongs to a different `service` | `400 Bad Request` |
| `parent_deployments[i]` references a `deployment_id` that, together with already-stored references, would form a directed cycle through resolved nodes | `400 Bad Request` |
| `parent_deployments[i]` references a `deployment_id` that does not yet exist | **accepted** (`201 Created`); the reference is recorded as dangling and resolved on the next read after the missing source lands |

The POST body gained two required-or-optional fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `deployment_id` | string | **yes (new)** | CI/CD-side identifier (run id, build number, guid). Non-empty. Unique within `service`. |
| `parent_deployments` | string[] | no (new) | Zero or more `deployment_id` values of parent deployments in the same `service`. Omit or send `[]` to fall back to the correlation-based topology derivation. Each entry must reference an existing or future deployment in the same service. |

### §7 PATCH `/api/config/topology` — verbatim

> Either or both of the following fields may be set in a single request. Unset fields are left unchanged.
>
> ```json
> {
>   "correlationAttribute": "ref",
>   "perServiceOverrides": {
>     "service-x": "sha",
>     "service-y": null
>   }
> }
> ```
>
> | Field | Type | Notes |
> |---|---|---|
> | `correlationAttribute` | string | One of `version`, `ref`, `sha`, `actor`, `run`, `ago`. Replaces the global default. Rejected with `400` if not in this set or if `id` is supplied (the explicit key is not a correlation attribute). |
> | `perServiceOverrides` | dict<string, string \| null> | Dictionary keyed by service name. A string value sets/replaces the override for that service. `null` removes the override for that service. Keys not present in the request are left unchanged (PATCH semantics, not PUT). |
>
> Response: `200 OK` with the full active config (same shape as `GET /api/config/topology`). The new setting takes effect on the next matrix read — no client reconnect or service restart is required (NFR-03's 5 s budget still applies).
>
> Audience: **admin / CI / ops tooling only — the SPA does not invoke this endpoint.** PATCH is auth-gated by the same `X-Api-Key` middleware as `POST /api/deployments` (FR-10). It changes the **server-side** default + per-service overrides — settings that affect every viewer. End-user picker preferences are per-user, ephemeral, and travel as a `correlationAttribute` query parameter on read endpoints (see below). This keeps the API key out of the SPA bundle entirely (NFR-04).

### §7 GET `/api/deployments` — `correlationAttribute` query parameter

> | Parameter | Type | Required | Notes |
> |---|---|---|---|
> | `correlationAttribute` | string | no | Per-request hint for the correlation-fallback pass of the topology builder (§"Topology Derivation"). Allowed values: `version`, `ref`, `sha`, `actor`, `run`, `ago`. **`id` is disallowed.** Invalid value → `400 Bad Request`. Omitted → falls back to the server-side default (`Topology.CorrelationAttribute`). |
>
> Behaviour:
> - The query parameter affects **only** the correlation fallback pass. Explicit `parent_deployments` edges (pass 2 of the derivation algorithm) are unaffected.
> - Per-service overrides win regardless: if `Topology.PerServiceOverrides[service]` is set (ops-managed, server-side), that attribute is used for `service` even when the request supplies a different `correlationAttribute`. Precedence (per request, per service): `PerServiceOverrides[svc] > query-param > server default`.
> - The parameter is a **hint**, not server state. Two simultaneous requests with different `correlationAttribute` values see different topologies; this is by design — the user picker is a personal preference, not a system change.
> - The endpoint remains unauthenticated. The `X-Api-Key` is for writes only.
>
> The same `correlationAttribute` query parameter is accepted on:
> - `GET /api/deployments` (matrix)
> - `GET /api/deployments/{service}/{environment}` and `.../history` accept it but ignore it — these endpoints do not return topology.
>
> The query parameter is **not** accepted on `GET /api/stream`. SSE topology semantics are documented below.

### §7 Matrix response shape — per-service `topology` block

> The top-level response is a dictionary keyed by service. Each service entry contains two siblings: `envs` (the existing per-slot map) and `topology` (the new per-service env DAG; FR-13). The per-slot shape inside `envs` is unchanged.
>
> ```json
> {
>   "service-a": {
>     "envs": { … },
>     "topology": {
>       "edges": [
>         { "from": "dev",  "to": "qa-1", "source": "explicit" },
>         { "from": "qa-1", "to": "uat",  "source": "correlated" }
>       ]
>     }
>   }
> }
> ```
>
> Field rules (added by this CR):
>
> - `current.deployment_id` and `current.parent_deployments` are surfaced on the wire so the SPA can render explicit parent links and so the history drawer can display the explicit lineage. `lastSuccessful.deployment_id` is included for symmetry; `lastSuccessful.parent_deployments` is included for completeness but the SPA renders edges from the matrix `topology` block, not by walking these arrays client-side.
> - `topology.edges` is always present (possibly empty) per service. `from` and `to` are env names already present in this service's `envs` map. `source` is `"explicit"` or `"correlated"` per the derivation merge rules (see ADR-0001).

### §7 SSE topology semantics — verbatim

> The SSE event carries the slot update only. The SPA refreshes per-service topology by issuing `GET /api/deployments?correlationAttribute=<user's-preference>` after each slot-update event (or after `Last-Event-ID` replay on reconnect). Topology is therefore *always* derived with the user's current picker preference; the SSE wire shape never has to encode it.
>
> Rationale:
> - **One source of truth for topology — the matrix GET endpoint.** SSE and GET cannot disagree because SSE no longer claims to know the topology.
> - **No per-user fan-out on the server.** The server emits one slot-update payload for every viewer; user preference enters the picture only on the subsequent GET.
> - **Reconnect correctness is trivial.** `Last-Event-ID` replay continues to deliver slot updates; the SPA re-fetches topology after the replay catches up. No "which topology to trust" reasoning on the client.
> - **Cost is negligible.** The SPA already issues an HTTP request per SSE event in the original design (to fetch `/history` on drawer open); one extra GET per event is a microsecond on a same-cluster call and falls inside NFR-03's 5 s budget by orders of magnitude.
>
> The SPA's refresh policy:
> 1. Receive SSE `slot-update` → apply `state` to the matrix store immediately (so status / version / actor update without waiting on a round trip).
> 2. Issue `GET /api/deployments?correlationAttribute=<picker-value>` — replace topology wholesale per service in the store.
> 3. On reconnect after disconnect: SSE `Last-Event-ID` replays missed slot updates, then a single GET refreshes topology.
>
> Topology can be coalesced if multiple slot-update events arrive within a short window (≤ 250 ms) — issue one GET, not N — but this is an implementation detail; the contract is "topology in the store is eventually consistent with the user's picker preference within NFR-03's budget".

### §10 Decisions 7, 8, 9 — verbatim (moved out of the initial SAD)

| # | Question | Decision |
|---|---|---|
| 7 | Scope of the topology correlation-attribute override (per-user / per-service / global)? | **Three-tier with split persistence.** (1) **Server-side global default** (`Topology.CorrelationAttribute`) — bootstrap default `version`. (2) **Server-side per-service override** (`Topology.PerServiceOverrides[service]`) — ops-managed; necessary because real environments use different correlation attributes for different services (e.g. service-a deploys by `version`, service-b by `sha`). (3) **Per-user picker preference** — stored client-side in `localStorage` only; sent as `correlationAttribute` query parameter on read endpoints. Precedence: `PerServiceOverrides[svc] > query-param > server default`. Rationale for split persistence: keeping the per-user preference out of server state preserves NFR-04 (the SPA is read-only against the API and never carries the `X-Api-Key`); ops still get a shared lever (PATCH) for environments where topology must be governed centrally. |
| 8 | Topology delivery — SSE wire vs. follow-up GET? | **Slot updates over SSE; topology fetched via `GET /api/deployments?correlationAttribute=…` after each event.** Rationale: with a per-user `correlationAttribute` query parameter (Decision #7), SSE cannot carry "the" topology — every connected viewer might have a different picker preference, and a single broadcast payload cannot satisfy them all. The simplest correct contract is **one source of truth — the GET endpoint** — and a refresh-on-event policy on the SPA. Cost: one extra HTTP call per SSE event on a same-cluster connection; well inside NFR-03's 5 s budget. Eliminates "which topology to trust" reasoning on the client and makes `Last-Event-ID` replay trivially correct. |
| 9 | Explicit `parent_deployments` references that point to a not-yet-ingested deployment — reject or accept? | **Accept and hold as dangling.** Rationale: out-of-order ingest is normal in distributed CI/CD (different pipelines, different runners, network delays); rejecting forces callers to retry-with-backoff and ties topology correctness to ingest ordering. Dangling references contribute no edge until the missing source lands; the next read after that reconciles them automatically. Cross-service references and cycles are still hard rejections (`400`). |

### `localStorage` keys added by this CR

| Key | Value shape | Example | Cap |
|---|---|---|---|
| `dashboard.layout` | one of `'matrix'`, `'swim-lane'`, `'workflow-rows'` (string) | `"matrix"` | n/a |
| `dashboard.correlationAttribute` | one of `'version'`, `'ref'`, `'sha'`, `'actor'`, `'run'`, `'ago'`, or absent (string \| missing) | `"sha"` | n/a |

Load-time hardening additions (in addition to CR-0002 rules):

> - For `dashboard.layout`: if the persisted string is not in the allowed set, fall back to the default (`matrix`). No throw — `localStorage.getItem` returns a string or `null`.
> - For `dashboard.correlationAttribute`: if the persisted string is not in the allowed set, treat as absent — the SPA then omits the `correlationAttribute` query parameter, falling back to the server-side default. Absence is the canonical "follow the system default" state and is not an error.
