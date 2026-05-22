# WireMock mapping corpus — `testing/fixtures/gha/`

WireMock.Net mapping JSON consumed by the `mock-gha` service under the `integration` compose profile. The runtime substrate, governance, and assertion seams are documented in:

- [`docs/cr/CR-0012-integration-test-substrate.md`](../../../docs/cr/CR-0012-integration-test-substrate.md) — design-of-record (substrate, six canonical box states, FR-06 Read-side echo, demo-bundle co-location).
- [`docs/integration-tests.md`](../../../docs/integration-tests.md) — operational guide (mapping conventions § 4, scenario activation § 5, endpoint coverage matrix § 6).
- [`testing/integration/Dashboard.Integration.Tests/MockGhaClient.cs`](../../integration/Dashboard.Integration.Tests/MockGhaClient.cs) — the admin-API client that loads scenarios.

Owner: `qa-engineer` (`.claude/agents/qa-engineer.md`).

## Directory layout

| Path | Purpose | Mount semantics |
|---|---|---|
| `mappings/` | Base mappings always loaded — one file per `(method, URL pattern)`. Filename-prefix ordered for priority. | Mounted into the `mock-gha` container at startup by the integration compose profile. Persistent across scenarios. |
| `scenarios/<state-id>/` | Per-canonical-box-state scenario bundles. One directory per `state-id` from [`local/index/ui-states.yaml`](../../../.agents/ginee/local/index/ui-states.yaml). | NOT mounted. Loaded into the running mock-gha via `POST /__admin/mappings/import` (or per-mapping POST fallback) by the test runner. |
| `scenarios/_cross-cutting/` | Scenarios that don't fit the six-box-state axis — NFR-05 replica restart, ADR-0004 cursor contract, NFR-03 latency, FR-06 wire-shape echo. | Same — runner-loaded via admin API. |
| `demo/` | Demo-mode mapping bundle (CR-0012 § 3d). | **AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint.** |

## Mapping JSON shape — primer

Each mapping is a single JSON object that describes one `(request matcher → response definition)` pairing. Canonical reference: [WireMock.Net Mappings wiki](https://github.com/WireMock-Net/WireMock.Net/wiki/Mappings). The minimum-viable shape:

```json
{
  "Priority": 10,
  "Request":  { "Method": "GET", "UrlPath": "/repos/integration-test-org/integration-test-repo/deployments" },
  "Response": {
    "StatusCode": 200,
    "Headers":    { "Content-Type": "application/json", "X-RateLimit-Limit": "5000", "X-RateLimit-Remaining": "4999", "X-RateLimit-Reset": "1700000000" },
    "BodyAsJson": []
  }
}
```

Notes:

- The `Request` matcher MUST use WireMock.Net's PascalCase property names (`Method`, `UrlPath`, `Url`, `Body`, `Headers`, `Params`); the upstream Java WireMock JSON shape (`request: { method, url, ... }`) is NOT compatible.
- Regex matchers go through `"Matcher": { "Name": "RegexMatcher", "Pattern": "/repos/[^/]+/[^/]+/deployments" }`. WireMock.Net does NOT recognise the bare Java WireMock `urlPattern` key.
- Either `BodyAsJson` (inline JSON) or `BodyAsString` is valid; do NOT use both.

## Filename prefix convention

Both base mappings and scenario mappings use a two-digit numeric prefix ordering effective priority within a directory:

| Prefix range | Use |
|---|---|
| `00-`–`09-` | Catch-alls and global rate-limit mappings. Lowest priority. |
| `10-`–`19-` | Per-endpoint base mappings (the five GHA endpoints the adapter calls). |
| `20-`–`29-` | Per-scenario deployments-list overrides (newest-first content). |
| `30-`–`39-` | Per-scenario per-deployment-status overrides. |
| `40-`–`49-` | Per-scenario needs-recovery mappings (`actions/runs/*`, `contents/*`). |
| `50-`–`99-` | Anything else (multi-page list extensions, rate-limit-hit injectors). |

The numeric prefix is informational — WireMock.Net selects mappings by the `"Priority"` JSON field, not by filename. Keep the two values in sync: **lower numeric prefix ⇒ lower `"Priority"` value ⇒ higher effective match precedence**.

## Priority numbering — locked

| `"Priority"` value | Meaning |
|---|---|
| `1`–`9` | Per-scenario per-deployment-status mappings. Highest precedence. |
| `10`–`19` | Per-scenario list-deployments mappings. |
| `20`–`29` | Per-scenario needs-recovery mappings. |
| `100` | Base mappings (the `mappings/` directory). |
| `999` | Catch-alls (e.g. `00-default-404-unknown-endpoint.json`). Lowest precedence — fires only when nothing else matches. |

## Rate-limit headers — required on every successful response

Per CR-0011 + [`docs/integration-tests.md § 4 SA-locked invariants`](../../../docs/integration-tests.md#4-wiremock-mapping-authoring-conventions), every 200/201 response MUST carry:

```json
"X-RateLimit-Limit":     "5000",
"X-RateLimit-Remaining": "4999",
"X-RateLimit-Reset":     "1700000000"
```

Exact values are insensitive — the fetcher parses them as integers and records observations on the `IFetcherUsageCache`. The scenario corpus uses uniform constants so cursor-contract scenarios can assert "fetcher observed identical headers tick-1 + tick-2" if needed.

## Adding a new scenario

1. Pick a `state-id` from `local/index/ui-states.yaml`, or place under `_cross-cutting/` if the scenario doesn't fit the six-state axis.
2. Create a directory `scenarios/<state-id>/` (or `scenarios/_cross-cutting/<scenario>/`).
3. Author one mapping file per endpoint the scenario needs to override. Prefer specific URL paths over regex — easier to reason about precedence.
4. Reference the scenario by its directory name from a test class (`new ScenarioFixture().LoadScenarioAsync("<state-id>")`).
5. Update `docs/integration-tests.md § 9` if a new canonical state-id is being added (escalate to `solution-architect` first — the six-state axis is a frozen surface).

## Cross-references

- [`docs/integration-tests.md § 4`](../../../docs/integration-tests.md#4-wiremock-mapping-authoring-conventions) — qa-engineer-owned mapping conventions (operational form).
- [`docs/integration-tests.md § 5`](../../../docs/integration-tests.md#5-scenario-activation-via-admin-api) — admin-API scenario activation (loader signatures).
- [`docs/integration-tests.md § 6`](../../../docs/integration-tests.md#6-mock-gha-endpoint-coverage-matrix-vs-cr-0009--3d) — the five GHA endpoints every base mapping must cover.
- [WireMock.Net Admin API Reference](https://github.com/WireMock-Net/WireMock.Net/wiki/Admin-API-Reference) — upstream admin-route surface.
- [WireMock.Net Mappings](https://github.com/WireMock-Net/WireMock.Net/wiki/Mappings) — full mapping JSON schema.
