# Test target configuration

Declarative configuration consumed by every PowerShell entry point under
`testing/` — the seed/cleanup scripts and the per-layer `run-tests.ps1`
wrappers. Owner: `qa-engineer`
(see [`.claude/agents/qa-engineer.md`](../../.claude/agents/qa-engineer.md)).

Rationale: per the "Engineering principles" section of
[`CLAUDE.md`](../../CLAUDE.md), configuration is declarative and runners
are thin. URLs and tokens never live as literals inside `.ps1` scripts
or test source — they live here.

## Schema

A target file is a single JSON object with exactly these three keys:

| Key            | Type   | Notes |
|----------------|--------|-------|
| `readBaseUrl`  | string | Base URL of the Read API and the SPA. `GET /health` is hit against this URL for the runner preflight. |
| `writeBaseUrl` | string | Base URL of the Write API. `POST /api/deployments` lands here. |
| `apiKey`       | string | Value sent as `X-Api-Key` on every write. For `local.json` this is the fixed fake token that `dev_env/start.ps1` bakes into the local compose stack; for real targets it must be a production-grade token sourced from your secret store. |

No other keys are recognised. Unknown keys are ignored.

## Files

| File             | Purpose | In repo |
|------------------|---------|---------|
| `local.json`     | Default for every runner — points at the local docker-compose stack from `dev_env/`. Committed. | yes |
| `integration.json` | Default for the `testing/integration/` runner — points at the local docker-compose stack with the `integration` profile active (per [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md)). Adds `mockGhaAdminBaseUrl` + `fetcherSourceIds` on top of the base schema. Committed. | yes |
| `dev.json`       | Optional. Points at a shared dev environment. Must source `apiKey` from a secret store; do not commit a real value. | no — gitignored if added |
| `prod-smoke.json`| Optional. Read-only smoke target for the production deployment dashboard. Same caveat about `apiKey`. | no — gitignored if added |

## Schema — integration target (`integration.json`)

The integration runner consumes the base schema above **plus** two extra keys that govern mock-gha scenario activation. Unknown keys are ignored.

| Key                    | Type            | Notes |
|------------------------|-----------------|-------|
| `readBaseUrl`          | string          | Same as base schema — base URL of the Read API + SPA. `GET /health` for preflight. |
| `writeBaseUrl`         | string          | Same as base schema — base URL of the Write API. Used by the runner to assert fetcher POSTs landed (via Read-side echo per [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md) § FR-06 assertion seam). |
| `apiKey`               | string          | Same as base schema. For `integration.json` this is the local-dev token (`local-dev-token-not-for-production`) baked into the integration profile of the compose stack. |
| `mockGhaAdminBaseUrl`  | string          | Base URL of the `mock-gha` admin API as published on the host under the `integration` profile (e.g. `http://localhost:<port>`). The runner POSTs scenario bundles to `<mockGhaAdminBaseUrl>/__admin/mappings/import` and resets via `<mockGhaAdminBaseUrl>/__admin/mappings/reset`. **Published to host only under the `integration` profile** — NFR-04 strict (per [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md) § Profile-gating contract). |
| `fetcherSourceIds`     | string[]        | The `owner/repo` source-ids the fetcher polls under the integration profile — typically one entry mirroring `GHA_SOURCE_ID`. Used by scenario mappings whose URL pattern references the source-id (e.g. `repos/{owner}/{repo}/deployments`). |

See [`docs/integration-tests.md`](../../docs/integration-tests.md) for the full operational guide (mapping authoring, admin-API scenario activation, endpoint coverage matrix, CI invocation, `-Integration` switch).

## Adding a new target

1. Create `testing/config/<target>.json` matching the schema above.
2. Source the `apiKey` from a real secret store; never commit a production value. A common pattern is to keep a template (`<target>.json.template`) committed with `"apiKey": ""` and have CI write the real file at runtime from a GitHub Actions secret.
3. Pass it through any runner via `-Config testing/config/<target>.json`.
4. CI workflows (`release.yml`, `smoke.yml`) call the same runners with `-Config testing/config/<target>.json`; no duplicated test-execution logic in YAML.

## Usage from runners

Every runner under `testing/` accepts a single `-Config <file>` parameter
defaulted to `testing/config/local.json`. The runners do **not** accept
loose `-BaseUrl` / `-ApiKey` overrides — those are configuration and
belong here.

```powershell
# Default — local stack from dev_env/start.ps1
pwsh -NoProfile -File testing/functional/run-tests.ps1

# Real environment — same runner, different config
pwsh -NoProfile -File testing/functional/run-tests.ps1 -Config testing/config/dev.json
```
