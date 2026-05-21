# Rate-limit cluster honours NFR-09 across the viewport matrix

**Intent:** the right-aligned rate-limit cluster (CR-0011 § 3d) does
not overlap the left-aligned stats-bar cluster at any viewport in the
matrix `[1024 × 768, 1280 × 800, 1440 × 900]` (Decision D10). At
viewport width < 1280 px the cluster MUST collapse to a single severity
dot + percent (no counter, no label) per
`docs/ui/rate-limit-cluster.md` § Collapse threshold.

## Citations

- [CR-0011](../../../docs/cr/CR-0011-fetcher-rate-limit-governance.md) § 3d
  (NFR-09 strict; collapse threshold).
- [docs/ui/rate-limit-cluster.md](../../../docs/ui/rate-limit-cluster.md)
  § Collapse threshold — measured slack, not viewport +
  § NFR-09 footprint.
- `docs/architecture.md` NFR-09 — layout reflow invariant
  (services × envs × name-len × version-len × viewport ≥ 1024 px).

## Preconditions

- Stack up.
- The SPA loads against `http://localhost:8080`.
- At least one rate-limit snapshot has been POSTed so the cluster is
  visible (the SPA hides the cluster entirely when `usageSnapshots`
  is empty per `docs/ui/rate-limit-cluster.md` § Chosen variant
  Empty row).

## Steps

1. **Given** the SPA is loaded and a fetcher-usage snapshot has been
   POSTed,
2. **When** the test sets the viewport to each entry in
   `[1024 × 768, 1280 × 800, 1440 × 900]` in turn,
3. **Then** for every viewport: the right cluster
   `[data-testid='rate-limit-cluster']` is in the DOM,
4. **And** its left edge is ≥ left cluster's right edge + 24 px gutter,
5. **And** at viewport < 1280 px the collapsed pill
   `[data-testid='rate-limit-pill-collapsed']` is visible while the
   full pill `[data-testid='rate-limit-pill']` is hidden,
6. **And** at viewport ≥ 1280 px the full pill is visible.

## Expected results

- For every viewport, `cluster.rect.left - leftCluster.rect.right ≥ 24`.
- At 1024 × 768: collapsed pill visible; full pill hidden; counter
  hidden.
- At 1280 × 800 and 1440 × 900: full pill visible; counter visible.
- No DOM element with `data-testid='rate-limit-cluster'` overlaps any
  DOM element with `data-testid='stats-bar-left'`.

## Out of scope

- Per-source popover behaviour — covered by
  `rate-limit-cluster-renders.spec.ts`.
- Stale flip — covered by `rate-limit-cluster-stale.spec.ts`.
- Highlight-hint vertical stack reconciliation — exercised by the
  mockup-visual harness Invariant 12 sub-assertion I12.c (flex-direction
  geometry).

## Coverage

- NFR-09: reflow invariant — cluster does not overlap the left cluster
  at any viewport ≥ 1024 px.
- FR-20: cluster honours the documented collapse threshold.
