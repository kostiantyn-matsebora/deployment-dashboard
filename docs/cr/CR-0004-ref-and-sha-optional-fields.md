# CR-0004 — Optional `ref` and `sha` fields on deployment payload

- **Status:** accepted
- **Trigger:** `TODO` line 6 — "Add another two attributes to deployment: ref (name of branch/number of pr or commit) and sha (sha of commit), both of them are optional, we will use them later on UI".
- **Change:** The deployment payload accepts two new optional fields:
  - `ref` — free-form source identifier (branch name, PR number, tag, or any human-readable git ref). Nullable string.
  - `sha` — commit SHA associated with this deployment. Nullable string. No hex check, no length cap.

  Both fields are stored when present and surfaced on the read-side wire shape (`current`, `lastSuccessful`, history items, SSE `slot-update.state.current`/`.lastSuccessful`). When absent on the stored row, the server MAY omit the property entirely OR emit it as `null`; clients MUST treat absent and `null` as equivalent.

  **Backward compatibility:** payloads that omit both `ref` and `sha` (the original seven-field shape) MUST continue to be accepted. Existing stored rows without these fields remain valid; the server treats missing values as `null`. Stricter validation (length cap, format, required-when-paired) is deferred — see "Decision 10" below, moved out of the initial SAD into this CR.

- **Impact:**
  - **FR-05** amended (verbatim post-amendment text below) — payload shape now includes `ref` and `sha`.
  - **§7 Data Model → `deployments` table** — `ref` and `sha` columns added (nullable text).
  - **§7 API Contract → POST `/api/deployments` request body** — `ref` and `sha` rows added.
  - **§7 API Contract → Matrix response shape — per service** — `current` and `lastSuccessful` examples include `ref` and `sha`; field rules describe the absent-or-null contract.
  - **§7 API Contract → SSE `slot-update` data payload** — example carries `ref` and `sha` on `current` and `lastSuccessful`; same omitted-or-`null`-when-absent rule applies.
  - **§7 Components → CI/CD Notify Step** — second example payload shows the optional `ref` + `sha` fields appended.
  - **§10 Decision 10** moved out of the initial SAD into this CR.
- **References:**
  - SAD §4 FR-05 (amended).
  - SAD §7 Components → CI/CD Notify Step.
  - SAD §7 Data Model → `deployments` table.
  - SAD §7 API Contract → POST body, matrix response shape, SSE payload.
  - **CR-0005** — `ref` / `sha` exposed as Display picker options and Topology correlation options (consumer-facing companion of this CR).

## SAD-level content owned by this CR — verbatim

### FR-05 — amended (verbatim post-amendment text)

> The system shall receive deployment events through a push-based HTTP ingest API (`POST /api/deployments`) accepting: service, environment, version, status, run URL, run number, and actor. The payload also accepts two optional source-identifier fields — `ref` (branch / PR / human-readable source identifier) and `sha` (commit SHA) — both nullable strings; the server stores them when present and renders them via the API responses defined in §"API Contract". The SPA exposes both fields to the user as Display picker (FR-12) options and as Topology correlation picker options (FR-13); see §7 "Attribute vocabulary" and §7 "Null-render invariant for nullable attributes". Stricter validation of value shape is a separate, deferred follow-up (§10 Decision 10).

### §7 Components → CI/CD Notify Step — second example (with `ref` + `sha`)

> Two optional source-identifier fields — `ref` and `sha` — MAY be included on the same payload (FR-05; full shape in §"API Contract" → "POST `/api/deployments` request body"). Backward compatible: omitting them leaves the matrix behaviour unchanged.
>
> ```json
> {
>   "service":     "service-a",
>   "environment": "dev",
>   "version":     "v2.3.1",
>   "status":      "success",
>   "run_url":     "https://ci.example.com/runs/12345",
>   "run_number":  1247,
>   "actor":       "john.doe",
>   "ref":         "feature/login-revamp",
>   "sha":         "9f1c0d2e8a"
> }
> ```

### §7 Data Model → `deployments` table — `ref` and `sha` columns

| Column | Type | Description |
|---|---|---|
| `ref` | TEXT NULL | **Optional source identifier.** Free-form string — branch name, PR number, tag, or any human-readable git ref. Nullable; omit (or send `null`) when absent. No length or format constraint at this stage — stricter validation is a deferred follow-up (see §10 "Decisions"). |
| `sha` | TEXT NULL | **Optional commit SHA.** Free-form string — the commit hash associated with this deployment. Nullable; omit (or send `null`) when absent. No length or format constraint at this stage (not required to be hex, not bounded to 7/40 chars) — stricter validation is a deferred follow-up (see §10 "Decisions"). |

### §7 API Contract → POST `/api/deployments` request body — `ref` and `sha` rows

| Field | Type | Required | Notes |
|---|---|---|---|
| `ref` | string \| null | no | **Optional.** Branch name, PR number, tag, or any human-readable git ref. Free-form string. Omit the property, send `null`, or send a string; absence and `null` are equivalent. No length or format validation at this stage (see §10 "Decisions"). |
| `sha` | string \| null | no | **Optional.** Commit SHA associated with this deployment. Free-form string. Omit the property, send `null`, or send a string; absence and `null` are equivalent. No length or format validation at this stage (see §10 "Decisions"). |

> Backward compatibility: payloads that omit both `ref` and `sha` (the original seven-field shape) MUST continue to be accepted. Existing stored rows without these fields remain valid; the server treats missing values as `null`.

### §7 API Contract → Matrix response — `ref` / `sha` field rule

> `ref` and `sha` are surfaced on both `current` and `lastSuccessful` when stored. When absent on the stored row, the server MAY omit the property entirely OR emit it as `null`; clients MUST treat absent and `null` as equivalent. The SPA renders these fields per FR-12 (Display attribute picker — §7 "Attribute vocabulary") and may use them as the correlation key per FR-13 (Topology correlation picker — §"Topology Derivation"); they are not used by the matrix-state derivation logic. Null/absent values render empty in the picker slot (§7 "Null-render invariant for nullable attributes") and are skipped by the correlation fallback pass.
>
> The same per-event shape — including `ref` and `sha` with the same omitted-or-`null`-when-absent rule — applies to `GET /api/deployments/{service}/{environment}` (single slot, `current` / `lastSuccessful`) and to every item returned by `GET /api/deployments/{service}/{environment}/history`. The history endpoint returns deployment events as an array; each item carries the full row fields (`deployment_id`, `service`, `environment`, `version`, `status`, `run_url`, `run_number`, `actor`, `deployed_at`, `parent_deployments`, `ref`, `sha`).

### §7 API Contract → SSE `slot-update` data payload — `ref` / `sha` field rule

> `ref` and `sha` follow the same omitted-or-`null`-when-absent rule as on the matrix response.

Example payload (with `ref` / `sha`):

```json
{
  "service":     "service-a",
  "environment": "dev",
  "state": {
    "current":        { "deployment_id": "gh-run-1251", "version": "v2.3.2", "status": "in-progress", "run_url": "https://github.com/org/repo/actions/runs/1251", "run_number": 1251, "actor": "john.doe", "deployed_at": "2026-05-14T14:34:00Z", "parent_deployments": ["gh-run-1240"], "ref": "feature/login-revamp", "sha": "9f1c0d2e8a" },
    "lastSuccessful": { "deployment_id": "gh-run-1247", "version": "v2.3.1", "run_url": "https://github.com/org/repo/actions/runs/1247", "run_number": 1247, "actor": "john.doe", "deployed_at": "2026-05-14T12:30:00Z", "parent_deployments": [], "ref": null, "sha": null },
    "previousFailed": false
  }
}
```

### §10 Decision 10 — verbatim (moved out of the initial SAD)

| # | Question | Decision |
|---|---|---|
| 10 | Validation of `ref` and `sha` (length, format, character set, required-when-paired)? | **Deferred — additive-only for now.** This cycle adds `ref` and `sha` as nullable, unconstrained string fields on the ingest payload and the read-side wire shape (FR-05). No length cap, no hex check on `sha`, no required-when-`ref`-set rule. A separate, larger validation overhaul is on the project backlog and will revisit every payload field (`version`, `ref`, `sha`, others) together, set length caps, define a standard format, and surface proper 4xx errors. Backward compatibility: payloads with neither field, either field, or both must continue to work. |
