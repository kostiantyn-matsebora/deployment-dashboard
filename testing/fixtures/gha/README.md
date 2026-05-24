# WireMock mapping corpus — `testing/fixtures/gha/`

JVM WireMock mapping JSON consumed by the `mock-gha` service under the `integration` compose profile. The runtime substrate, governance, and assertion seams are documented in:

- [`docs/cr/CR-0012-integration-test-substrate.md`](../../../docs/cr/CR-0012-integration-test-substrate.md) — design-of-record (substrate, six canonical box states, FR-06 Read-side echo, demo-bundle co-location).
- [`docs/integration-tests.md`](../../../docs/integration-tests.md) — operational guide (mapping conventions § 4, scenario activation § 5, endpoint coverage matrix § 6).
- [`testing/integration/Dashboard.Integration.Tests/MockGhaClient.cs`](../../integration/Dashboard.Integration.Tests/MockGhaClient.cs) — the admin-API client that loads scenarios.

Owner: `qa-engineer` (`.claude/agents/qa-engineer.md`).

## Directory layout

| Path | Purpose | Mount semantics |
|---|---|---|
| `mappings/` | Base mappings always loaded — one file per `(method, URL pattern)`. Filename-prefix ordered for priority. | Mounted into the `mock-gha` container at startup by the integration compose profile. Persistent across scenarios. |
| `scenarios/<state-id>/` | Per-canonical-box-state scenario bundles. One directory per `state-id` from [`local/index/ui-states.yaml`](../../../.agents/ginee/local/index/ui-states.yaml). | NOT mounted. Loaded into the running mock-gha via `POST /__admin/mappings/import` by the test runner. |
| `scenarios/_cross-cutting/` | Scenarios that don't fit the six-box-state axis — NFR-05 replica restart, ADR-0004 cursor contract, NFR-03 latency, FR-06 wire-shape echo. | Same — runner-loaded via admin API. |
| `demo/` | Demo-mode mapping bundle (CR-0012 § 3d). | **AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint.** |

## Mapping JSON shape — primer

Each mapping is a single JSON object that describes one `(request matcher → response definition)` pairing. Canonical reference: [wiremock.org/docs/stubbing/](https://wiremock.org/docs/stubbing/). The minimum-viable shape:

```json
{
  "priority": 10,
  "request":  { "method": "GET", "urlPath": "/repos/integration-test-org/integration-test-repo/deployments" },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json", "X-RateLimit-Limit": "5000", "X-RateLimit-Remaining": "4999", "X-RateLimit-Reset": "1700000000" },
    "jsonBody": []
  }
}
```

Notes:

- All property names are **camelCase** (`priority`, `request`, `response`, `method`, `urlPath`, `status`, `jsonBody`, `bodyPatterns`). PascalCase is NOT the JVM WireMock format.
- Regex URL matchers use `"urlPattern"` (regex) or `"urlPath"` (exact path). Example: `"urlPattern": "/repos/[^/]+/[^/]+/deployments"`.
- Use `"jsonBody"` for inline JSON response bodies (object or array). Use `"body"` for plain string responses. Do NOT mix both on the same mapping.

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

The numeric prefix is informational — JVM WireMock selects mappings by the `"priority"` JSON field, not by filename. Keep the two values in sync: **lower numeric prefix ⇒ lower `"priority"` value ⇒ higher effective match precedence**.

## Priority numbering — locked

| `"priority"` value | Meaning |
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
- [WireMock Admin API Reference](https://wiremock.org/docs/standalone/admin-api-reference/) — upstream admin-route surface.
- [WireMock Stubbing](https://wiremock.org/docs/stubbing/) — full mapping JSON schema.
