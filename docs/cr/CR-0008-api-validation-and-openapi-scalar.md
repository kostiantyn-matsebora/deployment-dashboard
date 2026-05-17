# CR-0008 — Standardised API validation, ProblemDetails errors, OpenAPI spec, and Scalar UI

- **Status:** accepted
- **Decided on:** 2026-05-17
- **Trigger:** root `TODO` Item 11 — *"Define more strict and standardized API, mandatory/optional fields, field types, length, etc, and implement validation of incoming data in backend, return proper error messages if data is not valid. ... Generate openapi spec and also add swagger or scalar to API app."*
- **Change:** scope narrowed by the user to **length-only validation, standardised error responses, and built-in OpenAPI + Scalar UI** — no format validation (no regex on `version`, `service`, `environment`, `sha`, `ref`, etc.), no new third-party validation libraries.
  - **3a — Validation contract (length-only).** All ingest fields validated for length and required-ness using `System.ComponentModel.DataAnnotations` (`[Required]`, `[StringLength]`) on the request DTO. Required string fields are validated as **non-null AND non-whitespace-empty** (use `[Required(AllowEmptyStrings = false)]` plus a custom guard for whitespace-only strings, or an equivalent Minimal API validation hook — choice of mechanism is implementation detail and owned by `backend-engineer`). Optional string fields are nullable; when present, `maxLength` is enforced. **No format / regex / character-set / pattern validation at this stage.** FluentValidation, AutoMapper, MediatR, and other banned libraries (see `CLAUDE.md` → "Do not introduce") are explicitly out of scope.
  - **3b — `ref` and `sha` caps (closes CR-0004 § Decision 10).** `ref` and `sha` gain explicit `maxLength` caps. Proposed values (open decisions — see "Open decisions" below): `ref: 200` (matches the other string caps for consistency), `sha: 64` (covers SHA-256 hex and typical CI commit-SHA forms; tighter than 200 because the field has a real upper bound in practice). The "no length cap or format check" wording in `docs/ci-cd-integration.md` (lines 96, 125-128) is superseded by the table in this CR's "SAD-level content owned by this CR — verbatim" block; `ci-cd-integration.md` is the consumer-facing companion and will be updated to point at this CR once accepted.
  - **3c — Standardised error response (RFC 7807).** All ingest validation failures return `application/problem+json` shaped as ASP.NET Core's built-in `ValidationProblemDetails` (RFC 7807, supported natively by .NET 10 — no new dependency). The `errors` map is keyed by request-field name (camelCase to match the JSON contract) and the value is a string array of one or more violation messages per field. Existing HTTP status codes from CR-0003 / CR-0004 / SAD §7 are preserved unchanged (`400`, `401`, `409`, `422`); only the response **body shape** is standardised. Non-ingest endpoints (Read API: `GET /api/deployments`, `/api/services`, `/api/environments`, `/api/config/topology`, `/health`, `/api/stream`) likewise return `application/problem+json` for any `4xx` they emit (e.g. `404 Not Found`, `400 Bad Request` for an unknown `correlationAttribute` value) — see "Open decisions" for confirmation.
  - **3d — OpenAPI generation.** The API host exposes a machine-readable **OpenAPI 3.x JSON document**, generated from Minimal API endpoint metadata + DTO annotations using **`Microsoft.AspNetCore.OpenApi`** (built-in to .NET 10 — no Swashbuckle, no NSwag). Proposed URL: `/openapi/v1.json` (the default convention emitted by the built-in package). The document is regenerated at build time; no hand-maintained spec file is checked in.
  - **3e — Scalar UI.** An interactive API explorer is mounted at a documented URL, reading the OpenAPI document above. Proposed URL: `/scalar` (or `/docs` — open decision). Available in **dev** by default; **prod** mounting is proposed-yes per NFR-04 (the API is internal-only / not publicly exposed, so the explorer poses no public-surface risk and gives ops a useful runtime tool). Hosted via the `Scalar.AspNetCore` NuGet package — the canonical Scalar integration for ASP.NET Core, no proprietary infrastructure binding, OCI-portable, no banned-stack conflict.
- **Impact:**
  - **§7 API Contract → POST `/api/deployments` request body** — every field row gains an explicit cap column (existing rows: `service`, `environment`, `version`, `actor`, `run_url`, `deployment_id`, `parent_deployments[i]`; CR-0004 rows: `ref`, `sha`). The new explicit caps for `ref` and `sha` close CR-0004 § Decision 10.
  - **§7 API Contract → "POST /api/deployments validation — failure modes"** — the failure-mode rows from the initial SAD, CR-0003, and CR-0004 keep their status codes; the response body for `400` / `409` / `422` is now standardised as `ValidationProblemDetails` (problem+json). See the verbatim block below for the canonical example.
  - **§7 API Contract → all Read endpoints** — `4xx` responses are also `application/problem+json` (subject to the "Open decisions" confirmation). Success-path response shapes are unchanged.
  - **§7 Components → API container** — new responsibility: serve `/openapi/v1.json` and `/scalar` (or `/docs`). These two routes are **read-side, unauthenticated** in line with NFR-04 (internal-only network).
  - **§7 App Gateway routing matrix** — two new rows: `GET /openapi/v1.json` and `GET /scalar` (or `/docs`) both route to `api:8080`. Both are read-side; no API-key gating. See "Open decisions" for the exact URLs once confirmed.
  - **`docs/ci-cd-integration.md` § "Length caps"** — the line `| `ref`, `sha` | none at this stage (deferred — CR-0004 § Decision 10) |` and the matching prose under the `ref` / `sha` bullets is superseded by the cap values in this CR. Update to be performed by `solution-architect` (companion doc, not SAD; SA owns it per `CLAUDE.md` → "Source of truth") once this CR is accepted.
  - **CR-0004 § Decision 10** — superseded by this CR for the cap question. CR-0004 itself remains accepted; only Decision 10's "deferred — additive-only for now" stance is closed out.
  - **No FR or NFR changes.** This CR adds wire-shape clarification + tooling; no functional requirement is added or removed. NFR-04 (internal-only) is **upheld**, not amended — the Scalar mount lives inside the same internal network surface as the rest of the API.
- **References:**
  - Root `TODO` Item 11.
  - [CR-0003](./CR-0003-tree-topology-and-layout-axis.md) — `deployment_id` required + `parent_deployments` optional (cap-200-per-element); failure-mode rows the new error body wraps.
  - [CR-0004](./CR-0004-ref-and-sha-optional-fields.md) — `ref` / `sha` optional fields and § Decision 10 (deferred cap, now closed by this CR).
  - `docs/ci-cd-integration.md` § "Length caps" (lines 86-96) and § "ref" / "sha" bullets (lines 123-130) — to be re-pointed to this CR.
  - SAD §7 "API Contract → POST `/api/deployments` request body".
  - SAD §7 "API Contract → POST /api/deployments validation — failure modes".
  - SAD §7 "App Gateway routing matrix".
  - SAD §5 NFR-04 (internal-only — informational; no amendment needed).

## SAD-level content owned by this CR — verbatim

### Validation rule table (full payload — supersedes per-row "Notes" wording from CR-0003 + CR-0004 + initial SAD on the cap question)

| Field | Type | Required | `maxLength` | Notes |
|---|---|---|---|---|
| `deployment_id` | string | **yes** | 200 | Non-null, non-whitespace-empty. Unique within `service` — duplicate `(service, deployment_id)` → `409 Conflict` (CR-0003). |
| `service` | string | **yes** | 200 | Non-null, non-whitespace-empty. Free-form identifier (SAD §7). |
| `environment` | string | **yes** | 200 | Non-null, non-whitespace-empty. Free-form identifier (SAD §7). |
| `version` | string | **yes** | 200 | Non-null, non-whitespace-empty. Free-form — the dashboard does not parse it (no format check). |
| `actor` | string | **yes** | 200 | Non-null, non-whitespace-empty. |
| `run_url` | string | **yes** | 2048 | Non-null, non-whitespace-empty. Must validate as a URL (existing rule — preserved). |
| `status` | enum string | **yes** | n/a | One of `success`, `failure`, `in-progress`. Length not applicable. |
| `run_number` | integer | **yes** | n/a | Non-negative integer; serialised as a JSON number, **not** a string. Length not applicable. |
| `ref` | string \| null | no | **200 (NEW — closes CR-0004 § Decision 10)** | Optional. When present, non-whitespace-empty AND ≤ 200 chars. Absent and `null` are equivalent. No format / regex / character-set check. |
| `sha` | string \| null | no | **64 (NEW — closes CR-0004 § Decision 10)** | Optional. When present, non-whitespace-empty AND ≤ 64 chars. Absent and `null` are equivalent. No hex check, no format / regex. 64 covers SHA-256 hex; SHA-1 hex (40) and short SHAs fit comfortably. |
| `parent_deployments[i]` | string | no (array optional) | 200 (per element) | Each element non-whitespace-empty AND ≤ 200 chars. Cross-service references → `400` (CR-0003). Cycles through resolved nodes → `400`. References to not-yet-ingested IDs → accepted as dangling (CR-0003 § Decision 9). |

**Universal rules (apply to all string fields above):**

- Required string fields rejected when `null`, empty (`""`), or whitespace-only (`"   "`) — all three forms produce a `422 Unprocessable Entity` with a `ValidationProblemDetails` body and a per-field message.
- Optional string fields: `null` and absent are equivalent; an empty string (`""`) is rejected with `422` (treat as "the caller meant to send a value and got it wrong" — explicit `null` is the canonical "no value" form).
- Length is measured in **Unicode code points** (`string.Length` in .NET — UTF-16 code units; acceptable for the practical cap values above). No normalisation pass.
- Length-cap violations: `422 Unprocessable Entity` with a per-field message.

### Standardised error response shape (RFC 7807 — `application/problem+json`)

All ingest validation failures and Read API `4xx` responses return `application/problem+json` with the ASP.NET Core `ValidationProblemDetails` shape (built-in to .NET 10 — no new dependency):

```json
{
  "type":     "https://tools.ietf.org/html/rfc9110#section-15.5.21",
  "title":    "One or more validation errors occurred.",
  "status":   422,
  "detail":   "The submitted deployment event failed validation. See 'errors' for per-field details.",
  "instance": "/api/deployments",
  "errors": {
    "service":           ["The 'service' field is required."],
    "version":           ["The 'version' field must not exceed 200 characters."],
    "ref":               ["The 'ref' field must not exceed 200 characters."],
    "parent_deployments": [
      "Element at index 2 must not exceed 200 characters.",
      "Element at index 3 must not be empty."
    ]
  }
}
```

Rules:

- `type` is a stable URI identifying the error class (RFC 7807 § 3.1). The example uses the canonical IETF reference for `422`; the API host MAY emit a project-local URI under a `https://<host>/errors/<slug>` namespace instead — choice of mechanism is implementation detail.
- `title` is a short, human-readable summary (RFC 7807 § 3.1) — stable per error class.
- `status` mirrors the HTTP response status.
- `detail` is a human-readable, request-specific explanation.
- `instance` is the request URI path (no query string, no host) — RFC 7807 § 3.1.
- `errors` is an object keyed by the **camelCase JSON field name** of the request body (e.g. `runUrl`, `parentDeployments`); each value is a non-empty `string[]` of one or more violation messages for that field.
  - For array fields (`parent_deployments`), per-element violations include the element index in the message; the array's key in `errors` is the field name (`parent_deployments`), not an indexed path.
  - For top-level structural failures (malformed JSON, missing body), `errors` MAY be omitted; `title` + `detail` carry the explanation.

Status-code mapping (preserved from CR-0003 / CR-0004 / initial SAD — only the body shape is standardised):

| Failure | Status | Body |
|---|---|---|
| Missing or whitespace-only required field | `422 Unprocessable Entity` | ValidationProblemDetails |
| String field over its `maxLength` cap | `422 Unprocessable Entity` | ValidationProblemDetails |
| Invalid `status` enum value | `422 Unprocessable Entity` | ValidationProblemDetails |
| Negative `run_number` | `422 Unprocessable Entity` | ValidationProblemDetails |
| Malformed JSON body | `400 Bad Request` | ProblemDetails (no `errors` map) |
| Missing or invalid `X-Api-Key` (write endpoints only) | `401 Unauthorized` | ProblemDetails |
| Duplicate `(service, deployment_id)` | `409 Conflict` | ProblemDetails |
| Cross-service `parent_deployments` reference | `400 Bad Request` | ProblemDetails |
| Cycle through resolved references | `400 Bad Request` | ProblemDetails |
| Read API: unknown `correlationAttribute` query value | `400 Bad Request` | ProblemDetails |
| Read API: not-found resource (e.g. unknown service slot) | `404 Not Found` | ProblemDetails |

### OpenAPI document — verbatim

| Aspect | Decision |
|---|---|
| Generator | `Microsoft.AspNetCore.OpenApi` (built-in, .NET 10). No Swashbuckle, no NSwag, no hand-maintained file. |
| Document URL | `/openapi/v1.json` (proposed — see Open decisions). |
| Versioning | OpenAPI 3.x (whatever the package emits by default in .NET 10 — currently 3.1). The path segment `v1` represents the **API** version, not the OpenAPI spec version. |
| Auth | Unauthenticated. Reads only — same surface posture as `GET /api/deployments`. NFR-04 (internal-only network) is the access control. |
| Build-time vs. runtime | Generated at runtime from endpoint metadata + DTO annotations. No build step writes the spec to disk. The spec is always in sync with the running code by construction. |
| Routing | Served by the API container; the App Gateway forwards `GET /openapi/v1.json` to `api:8080` with no auth gating. |

### Scalar UI — verbatim

| Aspect | Decision |
|---|---|
| Package | `Scalar.AspNetCore` NuGet package. Pure ASP.NET Core integration — no proprietary infrastructure binding, OCI-portable. |
| Mount URL | `/scalar` (proposed — alternative `/docs`; see Open decisions). |
| Reads | The OpenAPI document at `/openapi/v1.json`. |
| Dev environment | Mounted. |
| Prod environment | Mounted (proposed — see Open decisions). The API is internal-only per NFR-04; Scalar in prod gives ops a runtime explorer without violating the public-exposure constraint. |
| Auth | Unauthenticated (same posture as the OpenAPI doc and the Read API). |
| Routing | Served by the API container; the App Gateway forwards `GET /scalar` (and any sub-paths required by Scalar's static assets) to `api:8080` with no auth gating. |

### `docs/ci-cd-integration.md` § "Length caps" — superseded rows (informational)

The following rows in `docs/ci-cd-integration.md` are superseded by the table above and should be re-pointed at this CR after acceptance (companion-doc edit, owned by `solution-architect`):

| Line | Old text | New text |
|---|---|---|
| 96 | `\| `ref`, `sha` \| none at this stage (deferred — CR-0004 § Decision 10) \|` | `\| `ref` \| 200 \|` / `\| `sha` \| 64 \|` (per CR-0008). |
| 123-126 | "Free-form string. Omit, send `null`, or send a string. No length cap or format check at this stage (deferred — CR-0004 § Decision 10)." | "Free-form string. Omit, send `null`, or send a string. Length cap 200 chars (CR-0008). No format check." |
| 127-130 | "Free-form string at this stage (no hex check, no length cap). Omit, send `null`, or send a string. Deferred — CR-0004 § Decision 10." | "Free-form string. Omit, send `null`, or send a string. Length cap 64 chars (CR-0008). No hex check, no format check." |

## Decisions locked (Phase 3 user review)

User confirmed all six decisions at the recommended default on 2026-05-17.

| # | Question | Locked decision | Alternatives considered |
|---|---|---|---|
| 1 | `ref` cap value | **200** (consistent with the other string caps) | 256 (some VCSs allow longer branch names; rarely seen in practice) |
| 2 | `sha` cap value | **64** (covers SHA-256 hex; SHA-1 / short SHAs fit easily) | 100 (looser, accommodates non-hex CI identifiers labelled "sha"); 40 (strict SHA-1 hex only — likely too tight given SHA-256 adoption) |
| 3 | OpenAPI document URL | **`/openapi/v1.json`** (matches `Microsoft.AspNetCore.OpenApi` default convention) | `/openapi.json` (no version segment — simpler but less future-proof) |
| 4 | Scalar UI URL | **`/scalar`** (matches the `Scalar.AspNetCore` package default; explicit branding) | `/docs` (more generic / discoverable; convention-neutral) |
| 5 | Mount Scalar in **prod** environment? | **Yes** — internal-only network per NFR-04; useful runtime tool for ops; no public-exposure risk. | No (dev-only) — tighter blast radius if a future change accidentally exposes the network. |
| 6 | Apply `ProblemDetails` to non-ingest endpoints' `4xx` responses (Read API: `404`, `400` on bad `correlationAttribute`, etc.)? | **Yes** — single consistent error contract across the whole API surface; matches RFC 7807's intent. | No (ingest-only) — narrower change but creates a split error-body contract across the API. |

## Hard-rule checks (per CLAUDE.md)

- No banned-stack additions. FluentValidation, AutoMapper, MediatR, Swashbuckle, NSwag, SignalR, Redis, MediatR, Material/PrimeNG/Bootstrap, Sass/Less, Azure Functions: **not introduced**. Only `Microsoft.AspNetCore.OpenApi` (built-in) and `Scalar.AspNetCore` (single-purpose, OCI-portable, no proprietary cloud binding) are added.
- NFR-01 (Azure-only hosting): unchanged.
- NFR-02 (≤ $30/month cost): unchanged — no new infrastructure.
- NFR-03 (5 s live update): unchanged — validation is in-request, no fan-out impact.
- NFR-04 (internal-only): **upheld** — Scalar and OpenAPI mount inside the internal-only network surface.
- NFR-05 (stateless backend): unchanged — validation is per-request, no session state.
- NFR-06 (Terraform IaC): unchanged.
- NFR-07 (≥ 90 days history): unchanged.
- NFR-08 (no client build step): unchanged — Scalar is server-rendered.
- §6 platform agnosticism: **upheld** — built-in OpenAPI + Scalar are OCI-portable.
