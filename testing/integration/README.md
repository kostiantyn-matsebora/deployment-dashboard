# Integration tests — `testing/integration/`

xUnit cross-stack suite verifying the inbound write path end-to-end. Substrate + canonical scenarios + assertion seams are governed by [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md); operational details (mapping conventions, admin-API scenario activation, endpoint coverage matrix, CI invocation) live in [`docs/integration-tests.md`](../../docs/integration-tests.md).

Owner: `qa-engineer` (`.claude/agents/qa-engineer.md`).

## What this suite proves

Per CR-0012 § "Six canonical box states":

- **FR-06 wire shape.** Every scenario reads back the persisted event via `GET /api/deployments/{service}/{environment}/history` (Read-side echo); each field on the wire round-trips losslessly.
- **NFR-03 latency.** Every scenario asserts the event lands on the Read API + SSE within 5 s of mock-gha scenario load.
- **NFR-05 stateless resilience.** `_cross-cutting/replica-restart` bounces the `api` container mid-fetch; the suite asserts no event loss + cursor advance.
- **ADR-0004 cursor contract.** `_cross-cutting/cursor-contract` issues two fetcher ticks; tick 2 emits ONLY the new deployment per the opaque cursor watermark.
- **Six canonical box states.** One scenario class per `state-id` from [`local/index/ui-states.yaml`](../../.agents/ginee/local/index/ui-states.yaml); each test asserts the matrix box resolves to the correct state-id via [`BoxStateOracle`](Dashboard.Integration.Tests/BoxStateOracle.cs).

The mock surface is the upstream GHA REST API only — the dashboard stack itself runs unmocked.

## How to run locally

1. **Bring up the integration stack.** Provided by the parallel devops slice (issue #10):
   ```powershell
   pwsh -NoProfile -File dev_env/start.ps1 -Integration
   ```
   Compose precondition: `docker compose >= 2.20` (the integration profile uses `depends_on: required: false`).
2. **Run the suite.**
   ```powershell
   pwsh -NoProfile -File testing/integration/run-tests.ps1
   ```
3. **Single-state run.**
   ```powershell
   pwsh -NoProfile -File testing/integration/run-tests.ps1 -Filter 'FullyQualifiedName~SuccessStateTests'
   ```

The runner's two preflights must both pass before `dotnet test` fires:

| Preflight | Endpoint | Verdict |
|---|---|---|
| Stack reachable | `GET ${readBaseUrl}/health` | non-5xx ⇒ pass |
| mock-gha admin reachable | `GET ${mockGhaAdminBaseUrl}/__admin/` | non-5xx ⇒ pass |

## Scenario structure

Per CR-0012 § 3c the fixture corpus is split into base mappings, six box-state scenarios, four cross-cutting scenarios, and a demo bundle:

```
testing/fixtures/gha/
├── mappings/                      # base mappings - always mounted
├── scenarios/
│   ├── success/                   # box state: success
│   ├── running-with-last/         # box state: running-with-last
│   ├── running-failed-with-last/  # box state: running-failed-with-last
│   ├── failed-with-last/          # box state: failed-with-last
│   ├── running/                   # box state: running
│   ├── running-failed/            # box state: running-failed
│   └── _cross-cutting/
│       ├── adr-0004-cursor-second-fetch/{tick-1,tick-2}/
│       ├── nfr-03-latency/
│       ├── nfr-05-replica-restart/
│       └── fr-06-wire-shape/
└── demo/                          # CR-0012 § 3d - not wired
```

Each scenario directory contains:

| File-name prefix | Content |
|---|---|
| `10-list-deployments.json` | `GET /repos/{owner}/{repo}/deployments` mapping — the deployments-list body the fetcher pages. |
| `30-status-dep<N>.json`    | `GET /repos/{owner}/{repo}/deployments/{N}/statuses?per_page=1` mapping — per-deployment lifecycle status the adapter consumes (success / failure / in_progress). |

See [`testing/fixtures/gha/README.md`](../fixtures/gha/README.md) for the full mapping-author guide.

## Adding a new scenario

1. Pick a `state-id` from `local/index/ui-states.yaml` (or `_cross-cutting/<name>` for a non-box-state assertion).
2. Author the scenario directory under `testing/fixtures/gha/scenarios/<state-id>/`.
3. Add a test class under `Dashboard.Integration.Tests/States/` (or `Dashboard.Integration.Tests/` for cross-cutting).
4. Reference the scenario by directory name from your test (`fixture.LoadScenarioAsync("<state-id>")`).
5. Assert via `ReadApiAssertions.WaitForSlotAsync` + `BoxStateOracle.Classify`.

## Debugging a failing scenario

1. **Re-run with `-Filter` narrowing.** Isolate the failing test:
   ```powershell
   pwsh -NoProfile -File testing/integration/run-tests.ps1 -Filter 'FullyQualifiedName~SuccessStateTests' -FailFast
   ```
2. **Inspect the mock-gha request log.** While the stack is up:
   ```powershell
   curl http://localhost:18080/__admin/requests
   ```
   The log shows the fetcher's actual GET requests against the mock surface — typically the smoking gun for a "no event arrived" failure (e.g. fetcher hit a 404 because the scenario URL pattern didn't match).
3. **Inspect the mappings currently loaded.**
   ```powershell
   curl http://localhost:18080/__admin/mappings
   ```
4. **Inspect the Read API directly.**
   ```powershell
   curl http://localhost:8080/api/deployments | jq .
   curl http://localhost:8080/api/deployments/integration-test-repo/state-success/history | jq .
   ```
5. **Tail the fetcher logs.**
   ```powershell
   docker compose --profile integration logs --follow fetcher
   ```
6. **TRUNCATE the table between debug iterations.**
   ```powershell
   pwsh -NoProfile -File testing/scripts/seed.ps1 -Config testing/config/integration.json -CleanOnly
   ```

## Dependency on the `integration` compose profile

The suite requires the `integration` compose profile to be active. The profile pins:

| Env var | Value | Why |
|---|---|---|
| `FETCHER_POLL_INTERVAL_SECONDS` | `1` | Tight poll cadence so the NFR-03 5 s envelope is exercised meaningfully (CR-0012 § 3b). |
| `GHA_API_BASE_URL` | `http://mock-gha:8080` | Re-points the fetcher at the mock surface — same env-var contract as production (no fetcher code change). |
| `GHA_SOURCE_ID` | one of `fetcherSourceIds` from `integration.json` | The `owner/repo` the fetcher polls — typically `integration-test-org/integration-test-repo`. |

The mock-gha service publishes its admin port (`18080` by default) to the host **only** under the `integration` profile — NFR-04 is preserved in production (CR-0012 § Profile-gating contract).

## Cross-references

- [CR-0012](../../docs/cr/CR-0012-integration-test-substrate.md) — design-of-record (substrate, scenario taxonomy, FR-06 Read-side echo seam).
- [`docs/integration-tests.md`](../../docs/integration-tests.md) — operational guide (mapping conventions § 4, admin-API scenario activation § 5, endpoint coverage matrix § 6, CI invocation § 7, `-Integration` switch § 8).
- [`testing/fixtures/gha/README.md`](../fixtures/gha/README.md) — mapping-corpus author guide.
- [`testing/config/README.md`](../config/README.md) § "Schema — integration target" — `integration.json` schema.
