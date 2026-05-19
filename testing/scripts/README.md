# Test data scripts + installer test suites

This directory contains two distinct families of artefacts:

1. **Test data scripts** (`seed.ps1`, ...) that drive the Deployment
   Dashboard ingest API for fixture seeding / cleanup. Implements WBS
   MVP §2 ("Automate Local Deployment") and §3.1 ("Seed local database
   with representative test data") in
   [`docs/architecture.md`](../../docs/architecture.md). See
   [§ seed.ps1](#seedps1) below.
2. **Installer test suites** (`*.Tests.ps1` for Pester, `*.bats` for
   bats-core) that gate the user-facing release-install + dev-env
   scripts (`install.{ps1,sh}`, `uninstall.{ps1,sh}`,
   `dev_env/start.ps1`, `dev_env/stop.ps1`). See
   [§ Installer test suites](#installer-test-suites) below.

Owner: `qa-engineer` (see [`.claude/agents/qa-engineer.md`](../../.claude/agents/qa-engineer.md)).

## Installer test suites

The 6 user-facing release / dev-env scripts are gated by automated
suites that match the CI runner invocations:

| Script | Test file | Runner |
|---|---|---|
| `install.ps1` | `install.Tests.ps1` | Pester 5 |
| `uninstall.ps1` | `uninstall.Tests.ps1` | Pester 5 |
| `dev_env/start.ps1` | `start.Tests.ps1` | Pester 5 |
| `dev_env/stop.ps1` | `stop.Tests.ps1` | Pester 5 |
| `install.sh` | `install.bats` | bats-core |
| `uninstall.sh` | `uninstall.bats` | bats-core |

### Prerequisites

- **PowerShell 7+ (`pwsh`)** for the Pester suites. Already required
  by the rest of the testing surface.
- **Pester 5.x** (`Install-Module -Name Pester -MinimumVersion 5.0.0 -Force`).
- **bats-core 1.7+** for the bash suites. On Ubuntu / Debian runners:
  `sudo apt-get install -y bats`. On macOS: `brew install bats-core`.

### Local runner invocations

```powershell
# All Pester suites (CI equivalent).
Invoke-Pester ./testing/scripts/*.Tests.ps1 -CI -Output Detailed
```

```bash
# All bats suites (CI equivalent).
bats ./testing/scripts/*.bats
```

### Test strategy

The suites do NOT require a Docker daemon and never reach the network.

| Pattern | Where |
|---|---|
| **Shimmed subprocess** -- prepend a stub `docker` / `Invoke-WebRequest` function block after the script's `param(...)` block; write the shimmed copy to a per-test tmpdir; invoke via `pwsh -NoProfile -File <shim>`. | `.Tests.ps1` (Pester) |
| **PATH shadowing** -- prepend a per-test `$STUB_DIR` to `PATH` containing fake `curl`, `docker`, `openssl`, `sleep` executables that capture invocations to `$STUB_LOG`. | `.bats` (bash) |

Both patterns are read-only against the installer scripts -- the
originals are never modified, in line with the role boundaries in
[`.agents/ginee/local/bindings.md`](../../.agents/ginee/local/bindings.md)
(`qa-engineer` must NOT edit `install.{ps1,sh}` /
`uninstall.{ps1,sh}` / `dev_env/*.ps1`; report bugs, don't fix).

### Coverage matrix

Each row is a contract axis; each column is a test file. `yes` =
covered; `n/a` = axis does not apply to that script (e.g. `stop.ps1`
does not touch secrets, so secret-handling axes are n/a). Use this
table to find which file(s) to extend when a contract changes.

| Axis | `install.Tests.ps1` | `uninstall.Tests.ps1` | `start.Tests.ps1` | `stop.Tests.ps1` | `install.bats` | `uninstall.bats` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Param defaults + persistence | yes | yes | yes | yes | yes | yes |
| `GHA_TOKEN` precondition (4 cases, issue #5) [1] | yes | n/a | yes | n/a | yes | n/a |
| `API_TOKEN` defence-in-depth [2] | yes | n/a | n/a | n/a | yes | n/a |
| `POSTGRES_PASSWORD` defence-in-depth [2] | yes | n/a | n/a | n/a | yes | n/a |
| Release URL shape (`latest` vs pinned tag) [3] | yes | n/a | n/a | n/a | yes | n/a |
| Env-file output shape [4] | yes | n/a | n/a | n/a | yes | n/a |
| Compose args (profiles + `--env-file`) [5] | yes | yes | yes | yes | yes | yes |
| Error paths [6] | yes | yes | yes | yes | yes | yes |
| **Test count (as of authoring)** | **24** | **11** | **10** | **7** | **23** | **12** |

Total: 87 tests.

Notes:

1. Must exit BEFORE any `docker compose` / network call when
   `-Fetcher` / `--fetcher` is set without a token AND without
   `-AllowMissingGhaToken` / `--allow-missing-gha-token`. `uninstall`
   and `stop` are teardown-only and never read `GHA_TOKEN`.
2. Dev-literal refusal + env override + reuse of valid pre-existing
   value. `uninstall` / `start` / `stop` never generate or rotate
   secrets.
3. `/releases/latest/download/` vs `/releases/download/<tag>/`.
   Install-only — no other script downloads assets.
4. Every required key written with correct values. Install-only — it's
   the script that produces `dashboard.env`.
5. `--profile migrate` / `--profile fetcher` / `--env-file`.
6. Asset 404; `docker compose pull` / `up` / `down` failure; health-poll
   timeout; missing-compose-file paths (stop only).

## Test data scripts

PowerShell scripts that drive the Deployment Dashboard ingest API for
test purposes. Implements WBS MVP §2 ("Automate Local Deployment") and
§3.1 ("Seed local database with representative test data") in
[`docs/architecture.md`](../../docs/architecture.md).

## Configuration model

Every script in this directory takes a single `-Config <file>`
parameter pointing at a JSON file under
[`testing/config/`](../config/README.md). The config file is the
**only** source of URLs and API tokens — the scripts contain no
hardcoded targets. The schema is documented in
[`testing/config/README.md`](../config/README.md):

```json
{
  "readBaseUrl": "http://localhost:8080",
  "writeBaseUrl": "http://localhost:8081",
  "apiKey": "local-dev-token-not-for-production"
}
```

Loose `-BaseUrl` / `-ApiKey` overrides are intentionally not supported
— those are configuration and belong in the JSON file, per the
"Engineering principles" section of [`CLAUDE.md`](../../CLAUDE.md).

## Scripts

| Script | WBS item | Status |
|---|---|---|
| `seed.ps1` (incl. `-Clean` / `-CleanOnly`) | MVP §2.4, §3.1, §10 | Implemented |
| `test-notify.ps1` | CI/CD Integration §2.1, §7.1 | TODO |
| `init-data.ps1` | MVP §11.2 | TODO - backfills real baseline from CSV/JSON |

## Quick start (local dev, zero-setup)

After `dev_env/start.ps1` brings up the local stack, run:

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1
```

That's it — no arguments. The script defaults `-Config` to
[`testing/config/local.json`](../config/local.json), which points at
`http://localhost:8080` / `http://localhost:8081` with the fixed fake
token `local-dev-token-not-for-production` baked into the local
compose stack by `dev_env/start.ps1`. The local-dev token is committed
on purpose: it has no value outside the developer's loopback interface
and exists only to make the "start the stack, seed it, see boxes"
path frictionless.

## Non-local targets

To target a different environment, create a new file under
`testing/config/` matching the schema (see
[`testing/config/README.md`](../config/README.md)) and pass it as
`-Config`:

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1 -Config testing/config/dev.json
```

The script is agnostic about what the file describes — for real
environments, source the `apiKey` from a secret store and write the
config at CI runtime; never commit a real production token.

## Prerequisites

- **PowerShell 7+ (`pwsh`)** — the scripts use `Invoke-WebRequest
  -SkipHttpErrorCheck` (added in PS 7) and the `[ordered]` accelerator
  for stable JSON key ordering.
- A reachable ingest API at `${writeBaseUrl}/api/deployments`. For the
  local stack run `dev_env/start.ps1`; for non-local targets that's
  the responsibility of the target's own deploy automation.

## `seed.ps1`

Seeds the ingest API with a deterministic event sequence that
exercises every box state described in SAD §7 "Web Dashboard (MVP) —
Visual layout". The fixture corpus lives at
[`testing/fixtures/seed-data.json`](../fixtures/seed-data.json) and is
derived from the `SERVICES` const block inside
[`docs/ui/deployment-dashboard.html`](../../docs/ui/deployment-dashboard.html).

### The six box states produced

| State | Slot | Event sequence (oldest -> newest) | Resulting matrix |
|---|---|---|---|
| Success | `service-b/dev` | success `v2.3.0` | `current.status=success`, `lastSuccessful=null` |
| Running + Last Successful | `service-a/dev` | success `v2.3.1`, in-progress `v2.3.2` | `current=in-progress v2.3.2`, `lastSuccessful=v2.3.1`, `previousFailed=false` |
| Running + Failed + Last Successful | `service-c/dev` | success `v3.1.0`, failure `v3.1.1`, in-progress `v3.1.2` | `current=in-progress v3.1.2`, `lastSuccessful=v3.1.0`, `previousFailed=true` |
| Failed + Last Successful | `service-b/qa` | success `v1.7.8`, failure `v1.7.9` | `current=failure v1.7.9`, `lastSuccessful=v1.7.8` |
| Running (no history) | `service-d/uat` | in-progress `v4.0.4` | `current=in-progress v4.0.4`, `lastSuccessful=null`, `previousFailed=false` |
| Running + Failed (no success ever) | `service-d/dev` | failure `v4.0.1`, failure `v4.0.2`, in-progress `v4.0.3` | `current=in-progress v4.0.3`, `lastSuccessful=null`, `previousFailed=true` |

Slots and versions are taken directly from the mockup's `SERVICES`
const so functional and E2E suites can use the same identifiers when
asserting (e.g. `expect(matrix['service-d']['dev'].previousFailed).toBe(true)`).

### Parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `-Config` | string | `testing/config/local.json` | Declarative target config — see [`testing/config/README.md`](../config/README.md). |
| `-DryRun` | switch | off | Prints every payload that would be POSTed and exits without contacting the network. |
| `-FailFast` | switch | off | Stop on the first non-2xx response or transport error. Default is to continue and report a summary at end-of-run. |
| `-TimeoutSec` | int | `10` | Per-request HTTP timeout. |
| `-States` | string[] | `@()` (all) | Optional filter restricting which canonical box states to seed. Allowed values: `success`, `running-with-last-success`, `running-with-prev-failed-and-last-success`, `failed-with-last-success`, `running`, `running-with-prev-failed`. |
| `-Clean` | switch | off | `TRUNCATE deployments` on the local dev stack BEFORE seeding. Removes accumulated state-pollution from prior functional-test runs. Uses `docker exec dashboard-db psql` — local-only. |
| `-CleanOnly` | switch | off | Truncate without seeding. Mutually exclusive with `-Clean`. |

Use `Get-Help testing/scripts/seed.ps1 -Full` for the inline reference.

### Examples

Seed the local docker-compose stack with zero arguments (the
[Quick start](#quick-start-local-dev-zero-setup) path):

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1
```

Smoke-test the script without touching the network (useful in CI for
fixture validation):

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1 -DryRun
```

Seed only the failure-related states against the dev target, stopping
on first error:

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1 `
    -Config testing/config/dev.json `
    -States 'failed-with-last-success','running-with-prev-failed' `
    -FailFast
```

### Output

Every POST emits one JSON line on stdout, for example:

```json
{"ts":"2026-05-14T15:32:11.42Z","level":"info","event":"seed_post_ok","service":"service-a","environment":"dev","version":"v2.3.1","status":"success","run_number":1247,"box_state":"running-with-last-success","slot_event_ix":0,"status_code":201,"latency_ms":24.3}
```

End-of-run summary:

```json
{"ts":"...","level":"info","event":"seed_done","total_posted":11,"succeeded":11,"failed":0,"first_error":null,"dry_run":false,"exit_code":0}
```

Pipe to `jq` or `Where-Object` to filter / aggregate:

```powershell
pwsh -File testing/scripts/seed.ps1 -DryRun |
    ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object event -eq 'seed_post_ok'
```

### Idempotency

`POST /api/deployments` is append-only (SAD §7 "API Contract" —
"Idempotent writes"). Re-running `seed.ps1` inserts additional history
rows but the dashboard matrix — derived by the
`SELECT DISTINCT ON (service, environment) ... ORDER BY deployed_at DESC`
query in SAD §7 "Data Model" — is unchanged because the latest event
per slot still has the same `(version, status)` shape. The dashboard
view is therefore stable across reruns; only `GET /history` will show
the extra rows.

### Cleanup

`seed.ps1 -Clean` (or `-CleanOnly`) truncates the `deployments` table
on the local dev stack before / instead of seeding. This addresses the
state-pollution that accumulates when re-running the functional suite
without restarting the compose stack: every functional test POSTs
unique-per-run rows (`qa-bot-fn-*`, `qa-bot-fn-cycle-*`, etc.) that
would otherwise stay forever. Implementation uses
`docker exec dashboard-db psql` and is local-only by design — for
real environments, use a real Postgres client.

Recommended local dev loop:

```powershell
pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean        # reset + reseed
pwsh -NoProfile -File testing/functional/run-tests.ps1
pwsh -NoProfile -File testing/scripts/seed.ps1 -Clean        # scrub functional pollution + reseed
pwsh -NoProfile -File testing/e2e/run-tests.ps1
```

A future `cleanup.ps1` (WBS MVP §10) may add marker-based deletion
(e.g. by `actor = "qa.bot"` only) if a less-destructive variant is
required against shared environments.

### Auto-teardown from the test runners

Both `testing/functional/run-tests.ps1` and `testing/e2e/run-tests.ps1`
invoke `seed.ps1 -CleanOnly -Config <same config>` AFTER the test pass
completes, regardless of the test result. Rationale: every functional
test POSTs unique `qa-bot-fn-<guid>` rows and every realtime / discovery
e2e POSTs `qa-bot-realtime-<suffix>` / `qa-bot-discovery` rows. Without
an automatic scrub the local dev database accumulates these forever
and the SPA renders ~20+ stale services on every browser refresh.

| Runner             | After tests run, by default                                                                                                   |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------|
| `run-tests.ps1` (functional) | `seed.ps1 -CleanOnly` (TRUNCATE only — no re-seed; next run uses the in-process `SeedFixture` against an empty DB). |
| `run-tests.ps1` (e2e)        | `seed.ps1 -CleanOnly` then `seed.ps1` (TRUNCATE + reseed canonical corpus so the next interactive browse is sane).  |

Both runners accept `-NoTeardown` to skip the cleanup (debugging). The
e2e runner additionally accepts `-NoReseed` to TRUNCATE but not reseed.

The cleanup is local-only by construction: `seed.ps1 -CleanOnly`
explicitly refuses non-localhost `writeBaseUrl` values to avoid
TRUNCATEing a real environment. Non-local cleanups are an out-of-band
operation against a real Postgres client, never wired into the runners.

## Fixture corpus citation

The slot list and example versions in
[`testing/fixtures/seed-data.json`](../fixtures/seed-data.json) are
adapted from the inline `SERVICES` const inside
[`docs/ui/deployment-dashboard.html`](../../docs/ui/deployment-dashboard.html).
That block exists precisely to demonstrate the six box states, so we
reuse it verbatim rather than inventing parallel fixtures.

Per the conflict-resolution rule in
[`CLAUDE.md`](../../CLAUDE.md) ("Source of truth"), if these scripts
ever disagree with the architecture doc or the mockup, the docs win
and the script must be updated.
