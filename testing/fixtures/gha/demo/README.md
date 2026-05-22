# Demo-mode mapping bundle

> **AUTHORED HERE, CONSUMED BY: follow-up demo-mode issue. Not wired into any current entrypoint.**

This directory carries the long-running, multi-service demo bundle authored under [CR-0012 § 3d](../../../docs/cr/CR-0012-integration-test-substrate.md). The bundle is intentionally co-located with the integration-test fixtures so the dashboard surfaces a single `mock-gha` admin surface for both the `integration` and the future `demo` compose profiles — one image, one mapping format, one admin API.

## Status — IMPORTANT

No current entrypoint loads this bundle. The follow-up demo-mode issue (TBD) will:

- Wire a `demo` compose profile that mounts `testing/fixtures/gha/demo/` into `mock-gha` in place of the per-scenario test bundles.
- Add a `-Demo` switch to `install/install.ps1` / `install.sh` that activates the `demo` profile on the release-install stack.

Until then this bundle is **authored substrate only** — `qa-engineer` keeps it green against the same WireMock.Net image the integration suite uses, but no test exercises it and no operator workflow consumes it.

## Layout

| Path | Purpose |
|---|---|
| `mappings/` | Demo-mode list + status responses for the six demo services. One file per `(method, URL pattern)` — same shape as `../mappings/` but populated with the demo's long-running content. |
| `services.md` | Inventory of the six demo services + four demo environments + the three services with `needs:` chains (frontend → backend, gateway → backend, mobile → backend). |

## Content shape

- **Services × environments.** Six demo services × four demo environments = 24 slots. Drives the same six box states the integration suite covers, scaled out across all slots.
- **Deployment cardinality.** Approximately 150 deployments distributed across the slots, IDs `1..150`.
- **Recent tail.** Approximately 10 deployments carry `created_at` within the demo runtime window so the matrix continues to evolve while a demo viewer watches.
- **Needs chains.** Three services advertise `needs:` upstream dependencies in their workflow YAML so the topology pane renders multi-hop edges (frontend ← backend, gateway ← backend, mobile ← backend).

## Cross-references

- [CR-0012 § 3d](../../../docs/cr/CR-0012-integration-test-substrate.md) — demo-bundle co-location rationale (single mock-gha surface, two consumers).
- [`docs/integration-tests.md § 10`](../../../docs/integration-tests.md#10-demo-bundle-co-location-story) — same verbatim disclaimer in the operational guide.
- [`testing/fixtures/gha/README.md`](../README.md) — global mapping-corpus authoring conventions.
