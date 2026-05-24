> **Superseded — see CR-0013**
>
> As of CR-0013 (accepted 2026-05-22, amended by issue #57), the `demo-gha` service runs
> [JVM WireMock 3.10.0](https://wiremock.org/) (`wiremock/wiremock:3.10.0`), not WireMock.Net.
> The demo-driver sidecar advances the bundle via PUT-by-file-id (`PUT /__admin/mappings/{guid}`)
> — not by walking Scenario state. The admin path is `/__admin/mappings` (no `/app` prefix).
> The bundle is baked into `/home/wiremock/mappings/` inside the image (JVM WireMock's default
> mappings directory), not `/app/__admin/mappings/`.
> The historical Scenario-walk description below explains why the `scenarios/walk/` layout
> exists; it is no longer the active mechanism.
> See [CR-0013](../../../docs/cr/CR-0013-demo-mode-default-installer.md) for the current
> design-of-record.

# Demo-mode fixture bundle

This directory carries the demo-mode mapping corpus loaded by the
`demo-gha` service under the `demo` Compose profile (`install.ps1` /
`install.sh` no-flag default). The corpus is **baked into the
`deployment-dashboard-demo-gha` image** at build time — see
[CR-0013 § 3c](../../../docs/cr/CR-0013-demo-mode-default-installer.md#3c--baked-demo-gha-docker-image-ship-mechanism)
for the ship mechanism — and baked into `/home/wiremock/mappings/`
inside the image so JVM WireMock loads everything recursively at
startup.

## What this bundle does

When `install.ps1` (or `install.sh`) runs with no flags, the
release-install stack boots the `demo` Compose profile. The fetcher
points at `http://demo-gha:80` with `GHA_REPOSITORIES=[{"owner":
"demo-org","repo":"demo-repo"}]` and polls every
`FETCHER_POLL_INTERVAL_SECONDS=5` seconds. This bundle returns:

- 30 deployments across **6 services × 5 environments** seeded
  immediately on the first poll.
- 35 further deployments arriving across 20 scenario ticks — roughly
  **3+ new events per minute over the first 5 minutes**, then 1 per
  tick for the remainder of the cycle.
- All four GHA-adapter DAG-edge shapes:
  - **Empty `parent_deployments`** — first deployment per
    `(service, env)`.
  - **Per-env predecessor only** — second deployment in the same env
    (status URL omits `/job/{id}` → adapter falls back to per-env
    predecessor).
  - **Single intra-run `needs:`** — `web-portal` `build → deploy`
    chain.
  - **Multiple `needs:` + per-env mix** — `billing-service` and
    `analytics-pipeline` `lint → test → build → deploy` chains.
- **All 6 canonical box states** from
  [`local/index/ui-states.yaml`](../../../.agents/ginee/local/index/ui-states.yaml):
  `success` · `failed-with-last` · `running` · `running-with-last` ·
  `running-failed` · `running-failed-with-last`.

See [`services.md`](./services.md) for the per-service catalog,
workflow YAML shape, and DAG-edge map.

## Layout

```
testing/fixtures/gha/demo/
├── README.md                                # this file
├── services.md                              # service catalog + DAG-edge map
├── mappings/                                # always-loaded base mappings
│   ├── 00-default-404-unknown-endpoint.json # catch-all
│   ├── 10-default-status-pending.json       # priority-fallback /statuses (empty → InProgress)
│   ├── 20-runs-<service>.json               # 4 files — /actions/runs/{id} workflow-run DTO
│   ├── 30-jobs-<service>.json               # 4 files — /actions/runs/{id}/jobs (templated)
│   ├── 40-contents-<service>.json           # 4 files — /contents/<workflow_path>
│   └── statuses/
│       └── NNN-status-<dep_id>.json         # 65 files — one per deployment
└── scenarios/
    └── walk/
        └── NN-list-tick-NN-<state>.json     # 20 files — scenario-driven list-deployments
```

### Why a single `scenarios/walk/` directory

The CR-0012 integration suite layout uses `scenarios/<state-id>/` —
one directory per canonical box state. That structure presumes a
**test runner** that POSTs one scenario's mappings to the running
mock-gha and asserts. The demo bundle has a different audience: it
runs unattended inside the `demo-gha` image with **no runner present
to swap mappings**. So everything is loaded recursively at startup
and the dynamic "evolves over time" feel is delivered via the
WireMock.Net Scenario primitive (see "Scenario walk" below).

`walk` is the only scenario name used here, so the directory holds
just one subtree — kept under `scenarios/` for symmetry with the
integration suite even though there's no name collision risk.

## Dynamic ticks

The demo-driver sidecar (issue [#46](https://github.com/kostiantyn-matsebora/deployment-dashboard/issues/46))
advances the bundle through time without WireMock.Net Scenarios. See
[`ticks/README.md`](./ticks/README.md) for the per-tick contract, the
cumulative-body rule, the authored ID range, and the pinned-GUID
dependency on the static-base `05-list-deployments-<service>.json`
files.

## Mock identity

| Surface | Value | Why |
|---|---|---|
| Source-id | `demo-org/demo-repo` | URL prefix in every mapping pattern |
| URL pattern | `/repos/demo-org/demo-repo/...` | The five endpoints the GHA adapter walks |
| Rate-limit headers | `X-RateLimit-Limit=5000` · `X-RateLimit-Remaining=4999` · `X-RateLimit-Reset=9999999999` | Headers the adapter parses per CR-0011 |
| Workflow run id range per service | `<service_prefix>00001..<service_prefix>99999` | Lets per-service regex mappings route by prefix digit |
| Workflow `head_sha` per service | Fixed constant per service | Adapter caches workflow metadata by `(owner, repo, run_id)` — sha is only used to fetch contents |

## Scenario walk (the dynamic part)

The list-deployments endpoint
(`GET /repos/demo-org/demo-repo/deployments`) is driven by a
WireMock.Net Scenario named `demo-walk`. 20 mappings cover ticks
`Started` (the default initial state) through `tick-19`; tick-19
transitions back to `Started`, making the walk cyclic.

Each tick advances state on every matching call, so with the
fetcher polling every 5 seconds, the walk advances ~12 ticks per
minute and completes a full 20-tick cycle every ~100 seconds. The
cumulative event list at each tick is a superset of the prior tick's
list (per ADR-0004 cursor monotonicity — new deployments arrive
strictly above the prior watermark).

| Tick | When-state | Set-state | Δ new events | Cumulative |
|---|---|---|---|---|
| 0 | `Started` | `tick-1` | 30 (seed) | 30 |
| 1 | `tick-1` | `tick-2` | 5 | 35 |
| 2 | `tick-2` | `tick-3` | 4 | 39 |
| 3 | `tick-3` | `tick-4` | 3 | 42 |
| 4 | `tick-4` | `tick-5` | 3 | 45 |
| 5–19 | `tick-N` | `tick-N+1` (or `Started` for tick 19) | 1–2 | 47 → 65 |

The "burst" in ticks 1-4 (15 events in the first ~20 s) populates
the dashboard with motion fast; the long tail (1-2 events per tick)
keeps the matrix alive without overwhelming evaluators.

### Loop behaviour

Tick-19 → `Started` is observable only by the WireMock.Net engine.
The fetcher's persisted cursor is already past every id in the loop
window (max id = 10065), so the second pass through `Started` returns
no events the cursor accepts. **The demo feels static after the
~100-second first cycle.** This is intentional — see
[CR-0013 § 3e](../../../docs/cr/CR-0013-demo-mode-default-installer.md#3e--dynamic-mock-scenario-walk).

## Mapping priority

| `Priority` | Meaning |
|---|---|
| `10` | Scenario tick mappings (list-deployments per `WhenStateIs`). Highest precedence among list-endpoint matches — the scenario state machine drives selection. |
| `50` | Per-deployment status mappings under `statuses/`. Each names a single deployment id. |
| `100` | Per-service base mappings (`runs/...`, `jobs/...`, `contents/...`). Regex-matched against run-id prefix or wildcard-matched against workflow path. |
| `500` | Empty-status fallback (`10-default-status-pending.json`). Fires when a `/statuses` URL has no specific mapping — adapter treats empty array as InProgress. |
| `999` | Catch-all 404 (`00-default-404-unknown-endpoint.json`). Lowest precedence. |

Filename two-digit prefixes mirror priority bands — kept in sync to
make priority intent visible in `ls` output.

## Templating

Three of the four base-mapping bands use Handlebars templating
(`"UseTransformer": true`) to compute job ids dynamically:

```handlebars
{{Math.Multiply (Regex.Match request.path "runs/(\\d+)/jobs") 10}}
```

This extracts the `run_id` from the request path and multiplies by 10
so the response's deploy-job id matches the status URL's
`/job/<run_id*10>` segment for any run id under the service's
prefix. Without templating we'd need one jobs mapping per
deployment; with it we author exactly one per service.

WireMock.Net's transformer auto-converts numeric strings back to
JSON numbers (`StringUtils.TryConvertToKnownType`), so the
`GitHubRunJobDto.Id long` field deserializes correctly.

## Authoring new ticks

1. Add the new entries to the next-available `tick-N` mapping under
   `scenarios/walk/`. Each entry MUST have an id strictly greater
   than every id already in the bundle (ADR-0004 cursor
   monotonicity).
2. Add a per-deployment status mapping under `statuses/`. Status
   URL with `/job/{id}` triggers needs-recovery; without it triggers
   per-env-predecessor-only.
3. Update the `Δ new events` + `Cumulative` rows in the table above.

## Testing changes locally

The fastest loop is via `devops-engineer`'s `gateway/demo-gha/`
build path — see
[CR-0013 § 3c](../../../docs/cr/CR-0013-demo-mode-default-installer.md#3c--baked-demo-gha-docker-image-ship-mechanism).
The build COPYs this directory's contents to
`/home/wiremock/mappings/` inside the image so any change to a JSON
file is picked up on the next image rebuild.

## Cross-references

- [CR-0013 § 3d + § 3e](../../../docs/cr/CR-0013-demo-mode-default-installer.md#3d--demo-bundle-content-shape)
  — bundle content shape + scenario walk design-of-record.
- [CR-0012 § 3d](../../../docs/cr/CR-0012-integration-test-substrate.md#3d-demo-bundle-co-location)
  — co-location rationale (single WireMock.Net image across both
  profiles, one mapping format).
- [`docs/integration-tests.md § 3.1`](../../../docs/integration-tests.md#31-two-profiles-two-bundles)
  — two profiles, two bundles.
- [`testing/fixtures/gha/README.md`](../README.md) — global mapping
  corpus authoring conventions (priority numbering, rate-limit
  headers, filename prefix mapping).
- [ADR-0004](../../../docs/adr/ADR-0004-opaque-per-progress-reporter-cursor.md)
  — opaque cursor contract (monotonically increasing deployment ids).
- [WireMock.Net Stateful Behaviour wiki](https://github.com/WireMock-Net/WireMock.Net/wiki/Stateful-Behaviour)
  — `Scenario` / `WhenStateIs` / `SetStateTo` field reference.
