# Configuration — API

API server variables: the write-key, gateway port, CORS, history retention, analytics tuning, and the deployment-wide service exclude filter.

## :material-key-variant: API { #api }

| Var | Required | Default | Purpose |
|---|---|---|---|
| `API_KEY` | **yes** | — | Write-endpoint shared secret (`X-Api-Key` header). Every write is `401` without it. |
| `CONTROL_API_KEY` | no | unset | Control-surface secret (`X-Control-API-Key`). **Unset hides `POST /api/control/reset` (returns 404).** When set, keep it **distinct** from `API_KEY` (least-privilege: write creds must not trigger a destructive reset). |
| `GATEWAY_PORT` | no | `8080` | Host port the gateway (the single public surface) binds to. |
| `CORS_ALLOWED_ORIGINS` | no | empty (off) | Comma-separated allowed origins. Empty (default) disables CORS — use when the App Gateway fronts the API on the same origin. Set only for split-domain deployments. |
| `HISTORY_RETENTION_DAYS` | no | `365` | Deployment history retention window. **Minimum 90.** Pruned daily by a background job. |
| `ANALYTICS_WINDOW_GRANULARITY` | no | `day` | Granularity to which the analytics `window.to` boundary is truncated: `day` (start of UTC day) or `hour` (start of UTC hour). Controls ETag stability — `day` keeps the ETag stable for the whole UTC day (today's deploys appear in DORA trends at the next UTC day boundary); `hour` yields fresher data, stable within the hour. Matrix / Swimlanes are unaffected (always real-time). |
| `ANALYTICS_FUNNEL_ENVIRONMENTS` | no | `dev,staging,qa,preprod,prod` | Comma-separated, ordered list of environments forming the promotion-funnel ladder (per-stage counts + conversion chart). The **last** entry is the production terminal that the DORA lead-time metric measures promotion chains to. Values are matched **case-insensitively** against the deployment `environment` field. Environments outside this list are excluded from funnel stages. Lets projects with non-standard stage names or fewer stages shape the funnel. |
| `RESET_ACK_TIMEOUT_SECONDS` | no | `10` | Max seconds to await component acks before forcing drain (D13). |
| `RESET_GATE_MAX_TTL_SECONDS` | no | `60` | Hard wall-clock ceiling on a reset cycle (D12). |
| `RESET_EXPECTED_COMPONENTS` | no | `dashboard-fetcher,demo-driver` | CSV of component ids whose acks are awaited during reset (D13). |

## :material-filter-outline: API: service exclude { #service-scope-filter }

Deployment-wide filter that hides a subset of services across **all** API read and write surfaces. Configured on the API container only — the fetcher does not use this var.

**`SERVICE_EXCLUDE`.** A CSV of glob patterns matched against the event's opaque `namespace/service` identity. `namespace` is emitter-supplied and adopter-defined; the identity may itself contain `/`. Glob semantics match the Matrix `service` filter:

| Pattern form | Matches |
|---|---|
| Without `/` (e.g. `canary`) | `service` segment across all namespaces |
| With `/` (e.g. `acme/*`, `*/canary`) | full `namespace/service` composite; `*` spans `/` |

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SERVICE_EXCLUDE` | no | *(empty — exclude nothing)* | CSV of `namespace/service` glob patterns. Empty = exclude nothing. |

**API write effect.** `POST /api/deployments` **rejects** a matching event with `403` (problem+json).

**API read effect.** Matching events are filtered from `/api/services`, `/api/matrix`, `/api/deployments`, the SSE stream (live + replay), and `/api/analytics/*` (excluded services contribute to no analytics aggregate). By-id (`/api/deployments/{id}`) returns `404`. Already-stored events for a now-excluded service remain in storage but are never surfaced; storage-clearing (reset / backfill) semantics are unchanged.
