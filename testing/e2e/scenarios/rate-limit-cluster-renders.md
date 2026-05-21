# Rate-limit cluster renders against the running SPA

**Intent:** after the fetcher pushes per-`(adapter_id, source_id)` usage
snapshots to `POST /api/fetcher/usage`, the SPA's stats-strip surfaces
the right-aligned cluster with the aggregated worst-band pill + counter
+ per-source popover per CR-0011 § 3d.

## Citations

- [CR-0011](../../../docs/cr/CR-0011-fetcher-rate-limit-governance.md) § 3d
  (cluster contract) + § 3b (wire shape).
- [ADR-0008](../../../docs/adr/ADR-0008-leaky-bucket-cap-and-republish-on-tick.md)
  Decision 3 (per-token cap → reporting per `(adapter, source-id)`).
- [docs/ui/rate-limit-cluster.md](../../../docs/ui/rate-limit-cluster.md)
  § Chosen variant + § Per-source-id presentation + § Fixture additions.
- `frontend/matrix/src/lib/rate-limit-cluster.component.ts` — SPA cluster.
- `frontend/shared/src/lib/fetcher-usage-api.service.ts` — poll service.

## Preconditions

- Stack up (`dev_env/start.ps1`).
- The SPA loads against `http://localhost:8080`.
- Three `(adapter_id, source_id)` snapshots POSTed via
  `buildFetcherUsagePayload`, covering all three severity bands per
  the mockup fixture in `docs/ui/rate-limit-cluster.md` § Fixture
  additions:
  - `github-actions / acme/widget-a-<suffix>` — 28 % used (green).
  - `github-actions / acme/widget-b-<suffix>` — 75 % used (amber).
  - `azure-devops  / contoso/payments-<suffix>` — 88 % used (red).

## Steps

1. **Given** the SPA is open at `http://localhost:8080`,
2. **And** three rate-limit snapshots have been POSTed to
   `/api/fetcher/usage` per the precondition,
3. **When** the SPA's fetcher-usage poll fires (≤ poll interval, MVP =
   30 s for the matrix poll cadence),
4. **Then** the cluster wrapper `[data-testid='rate-limit-cluster']`
   becomes attached and visible,
5. **And** the aggregated pill `[data-testid='rate-limit-pill']`
   carries the severity-band class matching the **worst band across
   snapshots** (red, since 88 % > 85 %),
6. **And** the counter `[data-testid='rate-limit-counter']` shows `3`
   (sources count),
7. **And** clicking the counter opens the popover
   `[data-testid='rate-limit-popover']` exposing exactly one row per
   snapshot — each row carries the per-`(adapter, source)` testid
   `[data-testid='rate-limit-row-<adapter_id>-<source_id>']`.

## Expected results

- Cluster wrapper renders within a poll interval (assert with a 35 s
  Playwright `waitFor`, > MVP's 30 s cadence).
- Pill class list contains the worst-band token (Tailwind utility class
  matching CR-0006's theme bindings — assertion is on
  `bg-red-100`/`text-red-700` per `docs/ui/rate-limit-cluster.md`
  § Severity-band colour tokens; theme axis composes orthogonally).
- Counter text matches `/3\s*sources?/i`.
- Popover contains three rows after counter click; popover closes on
  outside click.

## Out of scope

- Stale-affordance flip — covered by
  `rate-limit-cluster-stale.spec.ts`.
- Viewport reflow / collapse — covered by
  `rate-limit-cluster-reflow.spec.ts`.
- Dark-mode palette swap — covered by the existing
  `theme-box-state-contract-under-dark.spec.ts` pattern (CR-0006).

## Coverage

- FR-19: `GET /api/fetcher/usage` consumption by the SPA.
- FR-20: dashboard surfaces per-`(adapter, source_id)` usage in a
  right-aligned cluster with green / amber / red severity bands.
