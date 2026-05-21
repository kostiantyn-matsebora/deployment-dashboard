# CR-0011 — manual smoke checklist (rate-limit governance)

**Owner:** `qa-engineer` (run before Phase 8 sign-off).
**Audience:** the human running the local stack to verify CR-0011 end-to-end.
**Citation:** [CR-0011 § Acceptance criteria](../../../docs/cr/CR-0011-fetcher-rate-limit-governance.md#acceptance-criteria).

## Pre-flight

- `dev_env/start.ps1` has brought the stack up (`/health` returns 200).
- `testing/scripts/seed.ps1` has run at least once so the matrix has content.
- The browser is open at `http://localhost:8080`.

## Steps

| # | Action | Expected |
|---|---|---|
| 1 | **Seed rate-limit snapshots.** Run `pwsh -NoProfile -File testing/scripts/seed.ps1 -RateLimit`. | Three structured-log lines `seed_usage_ok` for `github-actions/acme/widget-a`, `…/acme/widget-b`, `azure-devops/contoso/payments`. All three return HTTP 200. |
| 2 | **Verify Read endpoint.** `Invoke-WebRequest -UseBasicParsing -Uri http://localhost:8080/api/fetcher/usage \| Select -ExpandProperty Content`. | JSON body `{ "snapshots": [ {...}, {...}, {...} ] }` with three entries; each carries a server-stamped `received_at` field with a `Z` suffix. |
| 3 | **Verify SPA cluster renders.** Reload the dashboard at `http://localhost:8080`. Observe the stats strip. | Right-aligned cluster appears within one poll interval (≤ 30 s). The aggregated pill is **red** (worst band; 88 % from `contoso/payments`). The counter shows `· 3 sources`. |
| 4 | **Verify per-source popover.** Click the `· 3 sources` counter. | Popover opens with three rows — one per `(adapter_id, source_id)`. Each row shows its own percent. Outside-click closes the popover. |
| 5 | **Verify reflow / collapse.** Resize the browser to **1024 × 768** (DevTools → Toolbar → Responsive → custom). | Cluster collapses to a single severity dot + percent (no `· N sources` label). Left cluster (Services / Failures / Last deploy / Never-reached-PROD) is fully visible without any visual overlap. Resize back to ≥ 1280 px — full layout returns. |
| 6 | **Verify stale-affordance.** Wait 2 minutes 10 seconds without re-running `seed.ps1 -RateLimit` (or restart the SPA after `> 120 s` without a fresh push). | Pill background becomes neutral grey + opacity 0.5; percent figure shows `—`; label changes from `used` to italic `stale`. Tooltip exposes `last seen <relative time>`. |

## Cleanup

- Optional: `pwsh -NoProfile -File testing/scripts/seed.ps1 -CleanOnly` to truncate the deployments table for the next session. The rate-limit snapshots clear on API container restart (no persistence by design — ADR-0008 Decision 2).

## Reporting

Run the script verbatim and record the outcome of each step (PASS / FAIL + observed text). Attach the result to the Phase 5 report. **FAIL** on any step routes back to Phase 6 with the offending domain (BE for endpoint/cache issues, FE for cluster rendering / collapse / stale-affordance, DevOps for stack-up issues).

## Out of scope for this smoke run

- Fetcher cap-reached + INFO-log behaviour (unit-tested in `Dashboard.Fetcher.Tests/FetcherWorkerRateLimitTests.cs`).
- Re-publish-on-tick recovery after API restart (functional-tested in `testing/functional/Dashboard.Functional.Tests/FetcherUsageEndpointsTests.cs § RePublishOnTick_RestoresCache_AfterApiRestart`).
- Dark-mode palette swap on the cluster (covered by the existing CR-0006 theme harness).
