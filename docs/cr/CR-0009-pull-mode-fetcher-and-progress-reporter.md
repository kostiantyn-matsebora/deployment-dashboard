# CR-0009 — Optional pull-mode fetcher (`Dashboard.Fetcher`) and universal `X-Progress-Reporter` event-attribution header

- **Status:** proposed
- **Decided on:** 2026-05-18
- **Trigger:** root `TODO` Item 13 — *"What if there is no ability to call write API from CI/CD pipeline? Then I would add another component (with separate container) that will be responsible for fetching deployment data from CI/CD tool (for instance by calling its API) and pushing it to our backend ... Write API should provide API for storing and retrieving cursor or any other state of this fetcher."* User redirected the design at Phase 3 from a fetcher-specific adapter-id concept to a **universal pusher-attribution header** so every push caller (the new fetcher, the inline `curl` snippet, the GHA composite, any future SDK or webhook receiver) can self-identify with a single concept.
- **Change.** Two co-introduced amendments and three framing decisions:
  - **3a — Universal `X-Progress-Reporter` event-attribution header.** A new request header `X-Progress-Reporter` is introduced on `POST /api/deployments`. Optional on push. When present, the value is persisted on the event row as a new nullable column `progress_reporter VARCHAR(64) NULL` on the events / deployments table and surfaced on every Read API surface that already exposes per-event attributes (history endpoint + matrix `current` / `lastSuccessful` + SSE `slot-update.state`). Validation reuses CR-0008's length-and-non-whitespace pattern: cap **64 chars**, non-whitespace-empty when present; violations return `422 Unprocessable Entity` with the `ValidationProblemDetails` body shape from CR-0008. The header is namespace-by-convention only — no enum, no central registration, no per-component permissioning. Recommended namespacing form (per Open trade-off (ii) below): `<source-component>/<adapter-or-context>` (e.g. `dashboard-fetcher/github-actions`, `ci-pipeline/gha-composite`, `manual/<operator-name>`); free-form is permitted; convention is documented in `docs/ci-cd-integration.md`. Applicable to **every push caller** — the inline-curl snippet, the GitHub Actions composite action, any future SDK or webhook receiver, and the new fetcher. The same header is **required** on the new fetcher-state endpoints (3b) to identify which pusher's cursor is being read or written.

    **Validation-error key convention for header-bound rules.** Header validation failures use the **wire-literal header name** as the `errors` map key in the `ValidationProblemDetails` body — for `X-Progress-Reporter` violations the key is the verbatim string `"X-Progress-Reporter"` (hyphenated, mixed-case). This differs from body-field rules, which use the JSON property name (camelCase / snake_case per the field's `[JsonPropertyName]`). Rationale: an operator reading a 422 response can grep the response key against the request header name they sent without translating to a binding-side identifier. CR-0008 established the body-field convention; this CR establishes the header convention as wire-literal so future header-bound CRs follow the same shape.
  - **3b — Optional pull-mode adapter.** The backend ingest model — until now push-only — is amended to **push-by-default plus optional pull-mode adapter**. A new out-of-process component `Dashboard.Fetcher` (separate container, opt-in deployment) polls a CI/CD tool's API and pushes events to the **same** Write API any other pusher would use, with the **same** `X-Api-Key`. No multi-token middleware; no per-adapter auth surface. The fetcher always sets `X-Progress-Reporter` on every event it pushes (recommended value `dashboard-fetcher/<adapter-id>`, e.g. `dashboard-fetcher/github-actions`). To support out-of-order ingest restart, the backend exposes a small fetcher-state sub-surface on the Write group:
    - `GET /api/fetcher/state/{source-id}` — return the persisted opaque cursor for `(progress_reporter, source-id)`, or `404` if no state exists yet. `X-Progress-Reporter` **required**.
    - `PUT /api/fetcher/state/{source-id}` — upsert the opaque cursor for `(progress_reporter, source-id)`. `X-Progress-Reporter` **required**. Body shape `{ "cursor": "<opaque string ≤ 4096>" }`. Returns `200 OK`.

    Both endpoints are API-key-gated by the same `X-Api-Key` middleware that protects `POST /api/deployments` (FR-10). The backend never parses the opaque cursor beyond length; it treats it as a length-capped `VARCHAR(4096) NOT NULL` blob keyed by `(progress_reporter, source_id)`. Each adapter owns its cursor shape (deployment ids, timestamps, watermark tuples, etc.) — see paired **ADR-0004** for the rationale.

    **Routing-template note.** The on-the-wire URL stays `/api/fetcher/state/{source-id}` as documented above. The route template is registered as a catch-all (`{**sourceId}` in ASP.NET Minimal-API syntax) rather than a single-segment template so adapter `source-id` values that legitimately contain forward slashes — GitHub `owner/repo` (`acme/widget`), ADO project paths, Jenkins job paths — bind correctly without per-caller URL-encoding. The catch-all is an implementation choice; the wire contract (path shape, length cap on the resulting `source-id` value, persistence keying) is unchanged. The handler still enforces the documented `source-id` length cap (200 chars) and non-whitespace rule.
  - **3c — Framing: pull-mode is a strict subset of push-mode.** The fetcher is "a particular kind of pusher that always sets `X-Progress-Reporter`" — not a second ingest concept. This intentionally collapses the conceptual surface: there is one ingest path (`POST /api/deployments`), one auth model (`X-Api-Key`), one attribution mechanism (`X-Progress-Reporter`), and one universal header that means the same thing whether the caller is a CI/CD pipeline, a manual `curl`, or the fetcher.
  - **3d — MVP scope.**
    - **IN:** GitHub Actions adapter only (`/repos/{owner}/{repo}/deployments` + `/repos/{owner}/{repo}/deployments/{id}/statuses`; cursor = highest seen `deployment.id`); cursor endpoints (`GET`/`PUT /api/fetcher/state/{source-id}`); fetcher host (ASP.NET Core Worker on `Microsoft.NET.Sdk.Worker`); Dockerfile; opt-in `docker-compose.local.yml --profile fetcher` entry; ACR image build; `X-Progress-Reporter` on `POST /api/deployments` plus persistence to the new `progress_reporter` column plus surfacing on the existing event-attribute Read responses; first-fetch cap (`INITIAL_FETCH_LIMIT` default 50, ceiling 500).
    - **OUT:** Other CI/CD adapters (ADO / Jenkins / GitLab / CircleCI); Azure Container Apps + Terraform wiring for the fetcher (deferred); GitHub App auth (PAT-only for MVP); Key Vault wiring for the fetcher (env-var-only for MVP); Control API integration (TODO line 12 — when it lands, the fetcher will future-integrate; MVP fetcher is autonomous).
  - **3e — Naming.** Library project `Dashboard.Fetcher`; host project `Dashboard.Fetcher.Host`; container image `deployment-dashboard-fetcher`. Both projects live under a new `backend/fetcher/` and `backend/fetcher-host/` directory tree; Dockerfile under `backend/fetcher-host/`.

- **Impact.**
  - **Amends [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md) — verbatim.** The Validation rule table (CR-0008 § "SAD-level content owned by this CR — verbatim") is extended with a new row covering the request **header** `X-Progress-Reporter`. Header-vs-body is captured in the row's "Type" cell so the implementer wires the same DataAnnotations-style validation on the header binding. The CR-0008 ProblemDetails contract is reused as-is — no second error shape. Verbatim addition:

    | Field | Type | Required | `maxLength` | Notes |
    |---|---|---|---|---|
    | `X-Progress-Reporter` (request **header**, not body) | string | no (on `POST /api/deployments`); **yes (on `GET`/`PUT /api/fetcher/state/{source-id}`)** | **64 (NEW — introduced by CR-0009)** | Optional on push; required on fetcher-state endpoints. When present, non-null AND non-whitespace-empty AND ≤ 64 chars. Violations → `422 Unprocessable Entity` with `ValidationProblemDetails` body (CR-0008 § "Standardised error response"). Namespace-by-convention; no enum / no registration. Header binds with `[FromHeader(Name = "X-Progress-Reporter")]` (or equivalent Minimal API binding) and validates via the same `[StringLength(64)]` + non-whitespace guard pattern. |

    Note: CR-0008 was the **last** authority on the canonical wire-shape table for `POST /api/deployments`. CR-0009 amends that table additively. CR-0008 itself remains `accepted`; only the table's row set grows.

  - **Amends [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) — wire-shape note.** CR-0003 owns the per-event `deployment_id` + `parent_deployments` surface on `POST /api/deployments`. CR-0009 adds the optional `X-Progress-Reporter` header alongside; the request-body rows from CR-0003 are unchanged. The new header is the only addition to the POST contract surface — body shape from CR-0003 + CR-0004 + CR-0008 is otherwise frozen.

  - **SAD §3 Non-Goal #2 — verbatim replacement.** The current text reads: *"Acting as a CI/CD engine — the system only tracks deployment state pushed to it; it does not query any CI/CD tool"*. Amended verbatim text:

    > Acting as a CI/CD engine — the **backend** only tracks deployment state pushed to it; it does not query any CI/CD tool. An **optional, separately-deployed `Dashboard.Fetcher` component** (see §7 "Dashboard.Fetcher (optional pull-mode adapter)") MAY translate pull → push by polling a CI/CD tool's API and posting events to `POST /api/deployments` like any other pusher; the backend's tool-agnostic contract is preserved because the fetcher reuses the same push endpoint and the same `X-Api-Key`. The backend is never extended with CI/CD-specific SDKs (see also `bindings.md` → "Do not introduce").

  - **SAD §7 Components Summary table — new row C8 (verbatim).**

    | Component | Description | Technologies |
    |---|---|---|
    | **Dashboard.Fetcher (optional, MVP: GitHub Actions adapter)** | Out-of-process pull-mode adapter. Polls a CI/CD tool's API on a configurable interval (default 30 s), translates pulled events into the `POST /api/deployments` wire shape, and pushes them to the backend like any other CI/CD pusher — using the same `X-Api-Key` and setting `X-Progress-Reporter` to `dashboard-fetcher/<adapter-id>`. Stores its opaque cursor on the backend via `GET`/`PUT /api/fetcher/state/{source-id}` so restart-safety does not depend on local container storage (NFR-05). Plug-in adapter shape: each CI/CD tool is one `ICiCdAdapter` implementation; host owns scheduler + retry + rate-limit back-off + Write-API client. **Opt-in deployment** — the backend functions identically whether or not the fetcher is running. | C# / .NET 10 (`Microsoft.NET.Sdk.Worker`), Polly (retry), HttpClient, `Dashboard.Shared` (DTO reuse) |

  - **SAD §7 ASCII ingest topology — verbatim delta.** The existing High-Level Overview's "Notify Step → POST" edge stays. Append below the existing `GitHub` block (after the "Notify Step" box, before the gateway arrow), inside the same outer frame style:

    ```
    ┌──────────────────────────────────────────────────────────────────────┐
    │  Optional — when push-mode integration is not available              │
    │                                                                      │
    │  ┌────────────────────┐      poll CI/CD API on interval             │
    │  │  CI/CD Tool API     │ ◄─────────────────────────────────────┐    │
    │  │  (e.g. GitHub)      │                                       │    │
    │  └────────────────────┘                                       │    │
    │                                                               │    │
    │           ┌───────────────────────────────────────────────────┘    │
    │           ▼                                                        │
    │  ┌────────────────────────────────┐                                │
    │  │  Dashboard.Fetcher.Host         │                               │
    │  │  (separate container, opt-in)   │                               │
    │  │                                 │                               │
    │  │   • Polls CI/CD API             │                               │
    │  │   • POSTs /api/deployments      │ ── same X-Api-Key ──────► gw  │
    │  │     with X-Progress-Reporter:   │                               │
    │  │     dashboard-fetcher/<adapter> │                               │
    │  │   • GET/PUT /api/fetcher/state  │ ── for opaque cursor ──► gw   │
    │  └────────────────────────────────┘                                │
    └──────────────────────────────────────────────────────────────────────┘
    ```

    Rationale: makes the optionality visible without changing the existing push-mode diagram. The "→ App Gateway" arrow from this block resolves to the same single public surface; the fetcher is just another caller from the gateway's perspective.

  - **SAD §7 API Contract table — verbatim row additions / amendments.**
    - The existing `POST /api/deployments` row's "Description" cell is amended to append: *"Accepts optional request header `X-Progress-Reporter` (≤ 64 chars, non-whitespace) — per CR-0009; when present, persisted on the event row and surfaced on Read responses."* The success code and auth-gate are unchanged.
    - Two new Write-group rows:

      | Method | Path | Success | Description |
      |---|---|---|---|
      | `GET` | `/api/fetcher/state/{source-id}` | `200 / 404` | **Write group — pull-mode adapter only.** Auth-gated by `X-Api-Key`. **Requires** request header `X-Progress-Reporter` (≤ 64, non-whitespace) — identifies which pusher's cursor to read. Returns the opaque cursor blob for `(progress_reporter, source-id)`, or `404 Not Found` if no state exists yet. Response body shape: `{ "cursor": "<string>", "updated_at": "<iso-8601 UTC>" }`. |
      | `PUT` | `/api/fetcher/state/{source-id}` | `200 / 422` | **Write group — pull-mode adapter only.** Auth-gated by `X-Api-Key`. **Requires** request header `X-Progress-Reporter` (≤ 64, non-whitespace). Upserts the opaque cursor for `(progress_reporter, source-id)`. Body: `{ "cursor": "<string, ≤ 4096>" }`. `422` on missing / over-cap cursor or missing / over-cap header. Returns the canonical response shape of the GET. |

    Both new endpoints inherit CR-0008's `ProblemDetails` error contract — no second error shape.

  - **SAD §7 — new sub-section "Dashboard.Fetcher (optional pull-mode adapter)" — verbatim.** Insert immediately after the existing `#### Notification Client (v2.0)` sub-section.

    > #### Dashboard.Fetcher (optional pull-mode adapter)
    >
    > Out-of-process component that translates pull → push for environments where a CI/CD pipeline cannot directly invoke `POST /api/deployments` (no network reachability, no scripting hook, tool-managed deploys without notify-step support, etc.). The component is **opt-in**: backend operation is unchanged whether the fetcher is deployed or not. MVP ships the GitHub Actions adapter only.
    >
    > | Attribute | Value |
    > |---|---|
    > | Library project | `backend/fetcher/Dashboard.Fetcher/` — `ICiCdAdapter` interface + per-tool adapter implementations + scheduler + Polly retry + Write API client |
    > | Host project | `backend/fetcher-host/Dashboard.Fetcher.Host/` — ASP.NET Core Worker (`Microsoft.NET.Sdk.Worker`); composition root; env-var configuration |
    > | Container image | `deployment-dashboard-fetcher` (multi-stage Dockerfile under `backend/fetcher-host/Dockerfile`; mirrors `backend/api/Dockerfile` posture) |
    > | Deployment | Separate container, never co-hosted with the API. Local dev: opt-in `docker compose --profile fetcher up`. Azure: ACR image is built and published; ACA wiring deferred (out of MVP scope per CR-0009 § 3d). |
    > | Auth to backend | Same `X-Api-Key` any other pusher uses. No multi-token middleware. |
    > | Event attribution | Always sets `X-Progress-Reporter: dashboard-fetcher/<adapter-id>` on every `POST /api/deployments` and on every `GET`/`PUT /api/fetcher/state/{source-id}`. |
    > | State / restart-safety | Opaque cursor blob persisted on the backend via `GET`/`PUT /api/fetcher/state/{source-id}` (keyed by `(progress_reporter, source-id)`). The fetcher container holds no durable state. NFR-05 preserved — running multiple fetcher replicas is undefined behaviour for MVP and is **not** supported (would cause N× CI/CD API calls); ACA deployment is configured as `minReplicas: 1, maxReplicas: 1` when the fetcher is enabled. |
    > | Plug-in shape | `interface ICiCdAdapter { string AdapterId { get; } Task<FetchPage> FetchPageAsync(string sourceId, string? opaqueCursor, int pageSize, CancellationToken ct); }` returning `(events, newCursor, hasMore)`. The host owns scheduler, retry, rate-limit back-off, Write-API dispatch. Backend remains adapter-agnostic. See **ADR-0004** Decision 4 for the rationale. |
    > | MVP adapter | GitHub Actions — `GET /repos/{owner}/{repo}/deployments` + `GET /repos/{owner}/{repo}/deployments/{id}/statuses`; cursor = highest seen `deployment.id`; first-fetch cap `INITIAL_FETCH_LIMIT` (default 50, ceiling 500). PAT auth (env-var); GitHub App auth deferred. |
    > | Failure isolation | Fetcher crashes / restarts do not affect API availability; reverse also true. Network failures back off per Polly policy; the backend stays cold to any pull-mode failure mode. |
    >
    > **Why a separate process, not an in-process `BackgroundService`?** See ADR-0004 Decision 3 — running N pollers inside N API replicas would multiply CI/CD API call volume; opt-in deployment is cleaner as a separate image; credential isolation (CI/CD PATs never enter the API host).

  - **SAD §9 Phasing — verbatim append row under "CI/CD Integration".** Append below the existing "Webhook receiver" row in the CI/CD Integration phase table:

    | Item | Scope |
    |---|---|
    | **Pull-mode fetcher (optional, CR-0009)** | `Dashboard.Fetcher` library + `Dashboard.Fetcher.Host` Worker + GitHub Actions adapter + Dockerfile + opt-in `docker-compose.local.yml --profile fetcher` entry + `X-Progress-Reporter` header on `POST /api/deployments` (also additively available to every other pusher) + `GET`/`PUT /api/fetcher/state/{source-id}` cursor endpoints + ACR image publish. ACA + Terraform wiring deferred — see CR-0009 § 3d. |

  - **SAD §10 Decision 6 — verbatim replacement.** Current text reads: *"6 | Push vs pull data model? | **Push** — the system exposes an ingest API; it does not query GitHub or any CI/CD tool. Callers are responsible for sending a correctly shaped payload. How deployments are triggered, structured, or named in the source is irrelevant to the system."*. Amended verbatim text:

    > | 6 | Push vs pull data model? | **Push-by-default with optional pull-mode adapter (CR-0009).** The backend itself remains push-only — it exposes `POST /api/deployments` and never queries any CI/CD tool's API. Callers are responsible for sending a correctly shaped payload. For environments where the CI/CD pipeline cannot invoke the ingest endpoint directly (no network reachability, no scripting hook, tool-managed deploys, etc.), an **optional, out-of-process `Dashboard.Fetcher` component** (separate container, opt-in deployment) MAY poll the CI/CD tool's API and push events to the same ingest endpoint like any other pusher — using the same `X-Api-Key` and setting `X-Progress-Reporter: dashboard-fetcher/<adapter-id>` for attribution. The backend's tool-agnostic contract is preserved because the fetcher reuses the push endpoint and the universal pusher-attribution header; no CI/CD-specific SDK is ever added to the backend. See SAD §7 "Dashboard.Fetcher (optional pull-mode adapter)" + ADR-0004 (cursor + adapter shape decisions). |

  - **`docs/WBS.md` — new §1.5 (10 items).** Inserted between §1.4 and §2. SA-authored item (1.5.1) covers the doc-amendment work; the remaining nine are wave-2 backend / devops / qa items implementing the contract this CR freezes. See `WBS.md` §1.5 for the full table.

  - **`docs/ci-cd-integration.md` — two new H2 sections.**
    - **"Event attribution — `X-Progress-Reporter` header"** — push-mode addition. Explains the optional header, why callers may want to set it (filtering, debugging, attribution across N pushers), recommended namespace-by-convention form (per Open trade-off (ii)), and a one-line `curl` example. The section is **not fetcher-specific** — every pusher (inline `curl`, GHA composite, future SDKs) is the audience.
    - **"Pull-mode alternative (optional)"** — when to use, component overview (pointer to SAD §7 C8 + CR-0009), required env vars for the GHA adapter, cursor model (pointer to ADR-0004 Decision 2), first-fetch behaviour (`INITIAL_FETCH_LIMIT`), failure / retry posture, local-dev opt-in (`docker compose --profile fetcher up`). Notes that the fetcher always sets `X-Progress-Reporter` to `dashboard-fetcher/<adapter-id>` so its events are distinguishable in the dashboard from any push-mode events for the same service.

  - **Paired ADR-0004** — *Opaque per-progress-reporter cursor; backend-held; out-of-process fetcher; plug-in adapter shape.* Records the four cross-cutting technical decisions so future adapter authors don't relitigate them.

  - **Backend (Wave 2 — backend-engineer).** EF Core migration: new nullable column `progress_reporter VARCHAR(64) NULL` on the events / deployments table + new `fetcher_state` table (PK = `(progress_reporter, source_id)`; `cursor VARCHAR(4096) NOT NULL`; `updated_at TIMESTAMPTZ NOT NULL`). Packaging recommendation per Open trade-off (i) below. New endpoint handlers for `GET`/`PUT /api/fetcher/state/{source-id}` (on the existing Write endpoint group; reuse the same `X-Api-Key` middleware). Read DTO additions: a nullable `progress_reporter` string property on `DeploymentEventResponse`, `CurrentDeployment`, and `LastSuccessfulDeployment` (so every existing event-attribute surface — history + matrix `current` / `lastSuccessful` + SSE `slot-update.state` — exposes the new attribute). No backfill on the existing rows.

  - **No FR or NFR amendments.** CR-0009 introduces no new FR and no new NFR. The optional pull-mode shape is an architectural amendment (Decision 6 above) that adds a new optional component without changing what the system must do or how well. NFR-04 (internal-only): the fetcher is a private-network outbound caller; the backend's public-surface posture is unchanged. NFR-05 (stateless backend): the new `fetcher_state` table is **stored** state for the fetcher, not in-memory state on the backend — the backend remains replica-fungible (any API instance can serve `GET`/`PUT /api/fetcher/state/...`); the fetcher itself is run as `minReplicas == maxReplicas == 1` when enabled (see SAD §7 sub-section above). NFR-06 (Terraform IaC): ACA wiring deferred — when it lands it follows the same Terraform module pattern as the other ACA apps. NFR-02 (≤ $30/month): one additional Consumption-plan ACA app when enabled; opt-in, so adopters who don't deploy the fetcher pay nothing extra.

## Open trade-offs — recommendations (awaiting user sign-off before Wave 2)

### (i) Migration packaging — one migration or two?

**Context.** Two distinct schema concerns land together: (a) a new nullable column `progress_reporter` on the existing `deployments` table, and (b) a brand-new `fetcher_state` table. They could ship as one migration (e.g. `AddProgressReporterAndFetcherState`) or as two (`AddProgressReporterColumn` + `AddFetcherStateTable`).

**Evidence from the existing migrations corpus** (`backend/shared/Dashboard.Shared/Migrations/`):
- `20260514154415_CreateDeploymentsTable.cs` — initial schema (one migration, one concept).
- `20260515120000_AddTopologyColumnsAndConfig.cs` — **packages two distinct concepts in one migration**: (i) new columns `deployment_id` + `parent_deployments` on `deployments`, (ii) a brand-new `topology_config` table. This precisely matches the shape CR-0009 needs.
- `20260515160000_AddRefAndShaColumns.cs` — single concept, single migration.

The prevailing convention is **"one migration per CR / cohesive concept"**, not "one migration per table". The closest analogue (`AddTopologyColumnsAndConfig`) bundles a column-on-existing-table + a new-table in the same file with no observed downside — both go together because they're one architectural change.

**Recommendation: one migration — `AddProgressReporterAndFetcherState`.** The two schema items are introduced together by CR-0009; they will always be deployed together; rollback semantics are clean as a single unit (drop the table, drop the column, in reverse order). Splitting into two would invent precedent for "one migration per table" that does not exist in the corpus, and would require a meaningful migration order story (which-first?) for zero operational benefit.

### (ii) `X-Progress-Reporter` namespacing convention

**Context.** The header is free-form (cap 64, non-whitespace). With no convention, operators will collide ("fetcher" from two different teams), and dashboard logs will be a wash of single-token values with no provenance. With a heavyweight convention (enum / central registration), we lose the namespace-by-convention spirit and add a coordination cost that defeats the "every pusher can set this" framing.

**Recommendation: slash-namespaced `<source-component>/<adapter-or-context>` — documented convention, not enforced rule.** Examples to document in `ci-cd-integration.md`:

| Caller | Recommended `X-Progress-Reporter` value |
|---|---|
| `Dashboard.Fetcher` GitHub Actions adapter | `dashboard-fetcher/github-actions` |
| GHA composite action (`.github/actions/notify`) | `ci-pipeline/gha-composite` |
| Inline `curl` from a generic pipeline | `ci-pipeline/<tool-slug>` (e.g. `ci-pipeline/jenkins`, `ci-pipeline/azure-devops`) |
| Manual operator using `curl` for backfill / fix-up | `manual/<operator-name>` |
| Future webhook receiver | `webhook-receiver/<source>` (e.g. `webhook-receiver/github-deployment-status`) |

Rationale: gives operators a debuggable namespace without enforcement cost. The convention parses cleanly in dashboard log search ("show me everything from `dashboard-fetcher/*`"), is self-documenting, and is permissive — the backend continues to accept any non-whitespace string ≤ 64 chars, so a future caller that wants a different shape (e.g. flat token) is not blocked. **Hard rule** stays "free-form, length-capped"; the slash convention is a `ci-cd-integration.md` recommendation only.

### (iii) Read API surface for `progress_reporter`

**Context.** Where should the new attribute appear on Read responses? Three options: (a) include on every Read surface that surfaces event attributes (history + matrix + SSE); (b) detail-only (history endpoint only — keeps matrix payload lean); (c) matrix-only (skip history for parity with newest-state-only thinking).

**Evidence from the existing Read API surface** — every per-event attribute is currently surfaced in the same set of three places:
- `DeploymentEventResponse` (history endpoint + POST 201 echo) — `backend/shared/Dashboard.Shared/Dto/DeploymentEventResponse.cs` lines 17-116. All event attributes including the most recently added optional ones (`ref` on line 83, `sha` on line 90) appear here.
- `CurrentDeployment` (matrix `current` + slot endpoint + SSE `slot-update.state.current`) — `backend/shared/Dashboard.Shared/Dto/MatrixSlot.cs` lines 62-130. `ref` (line 98) and `sha` (line 105) are surfaced here.
- `LastSuccessfulDeployment` (matrix `lastSuccessful` + SSE `slot-update.state.lastSuccessful`) — `backend/shared/Dashboard.Shared/Dto/MatrixSlot.cs` lines 137-199. `ref` (line 169) and `sha` (line 177) are surfaced here.

The prevailing convention is **"every event-attribute surface that exposes `ref`/`sha` also exposes the next event-attribute"** — no per-attribute splitting; one consistent shape across history + matrix + SSE.

**Recommendation: option (a) — include `progress_reporter` on every Read surface that already surfaces per-event attributes (`DeploymentEventResponse` + `CurrentDeployment` + `LastSuccessfulDeployment`).** Always present in the JSON output; value `null` when the persisted column is `NULL`; same JSON-property convention as `ref` / `sha` (lowercase snake-case `"progress_reporter"`). Rationale: mirrors the CR-0004 precedent exactly; SPA + future consumers see one consistent event-shape across history + matrix + SSE; no special-casing for attribution. Cost: a single nullable string per per-event payload — negligible. The new field is **not** added to `topology.edges`; topology is a per-service derived structure that does not currently carry per-event attributes (per CR-0003 / ADR-0001) and `progress_reporter` is a per-event attribute, not a per-service one.

---

**All three trade-offs above are recommendations; awaiting user sign-off before Wave 2 backend implementation begins.** Once signed off, the recommendations move into the body of this CR (locked) and Wave 2 implements against them.

## References

- Root `TODO` Item 13.
- [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) — last canonical authority on `POST /api/deployments` body shape (with CR-0004 + CR-0008 amendments).
- [CR-0004](./CR-0004-ref-and-sha-optional-fields.md) — precedent for optional-attribute-surfaced-on-all-event-DTOs.
- [CR-0008](./CR-0008-api-validation-and-openapi-scalar.md) — length-validation + ProblemDetails contract reused verbatim for the new header.
- **ADR-0004 (paired)** — opaque per-progress-reporter cursor; backend-held; out-of-process fetcher; plug-in adapter shape.
- [ADR-0006](../adr/ADR-0006-microservices-architecture-with-container-co-location.md) (supersedes [ADR-0002](../adr/ADR-0002-modular-monolith-consolidation.md) on framing; ADR-0002 retains the co-location mechanics) — microservices architecture with the Write + Read API services co-located in `deployment-dashboard-api`. The Fetcher is its own microservice in its own image (`deployment-dashboard-fetcher`); it is **not** absorbed into the co-located API host. The new fetcher-state endpoints land in the existing Write endpoint group (same API-key middleware), not in a new host.
- SAD §3 Non-Goals; SAD §7 Components Summary / API Contract / Components sub-sections; SAD §9 Phasing; SAD §10 Decision 6.
- `docs/ci-cd-integration.md` — new H2 sections for the universal header + the optional pull-mode alternative.
