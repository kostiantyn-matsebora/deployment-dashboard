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
| `dev.json`       | Optional. Points at a shared dev environment. Must source `apiKey` from a secret store; do not commit a real value. | no — gitignored if added |
| `prod-smoke.json`| Optional. Read-only smoke target for the production deployment dashboard. Same caveat about `apiKey`. | no — gitignored if added |

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
