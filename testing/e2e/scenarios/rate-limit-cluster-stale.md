# Rate-limit cluster stale-affordance fires after 2 × poll_interval

**Intent:** when the SPA's local clock advances past
`received_at + 2 × poll_interval` (CR-0011 § 3d footnote — MVP
hard-codes `poll_interval = 60 s`, so the threshold is 120 s), the
cluster MUST visually de-emphasise per `docs/ui/rate-limit-cluster.md`
§ Stale-affordance visual:

1. Pill background switches to the **stale (neutral)** token.
2. Pill receives `opacity: 0.5`.
3. The percent figure is replaced by literal `—`.
4. The label changes from `used` to italic `stale`.
5. Tooltip exposes `last seen <relative time>`.

Per the SA-locked constraint table row 7 (`docs/ui/rate-limit-cluster.md`)
the affordance MUST de-emphasise to avoid presenting a stuck gauge as
live truth.

## Citations

- [CR-0011](../../../docs/cr/CR-0011-fetcher-rate-limit-governance.md) § 3d
  (stale-affordance rule + 2 × poll_interval threshold).
- [docs/ui/rate-limit-cluster.md](../../../docs/ui/rate-limit-cluster.md)
  § Stale-affordance visual + § SA-locked constraints row 3.

## Preconditions

- Stack up.
- The SPA loads against `http://localhost:8080`.
- Playwright `page.clock.install({ time: anchor })` installed so the
  SPA's `Date.now()` is fully controllable from the test (no production
  seed-override surface — the SPA reads `now()` honestly; the test
  fast-forwards the clock).
- A single rate-limit snapshot has been POSTed with `observed_at` set
  to `anchor` so the server stamps `received_at` close to the same
  moment.

## Steps

1. **Given** the SPA is loaded with the clock pinned at `anchor`,
2. **And** the snapshot has been POSTed at `anchor`,
3. **When** the SPA's first poll runs after page load (at `anchor`),
4. **Then** the cluster's stale-affordance hook
   `[data-testid='rate-limit-stale']` is HIDDEN (no `stale` class),
5. **When** the test fast-forwards the SPA clock by 125 s
   (`page.clock.fastForward('125s')`) and triggers another poll,
6. **Then** the stale-affordance becomes visible AND the pill text no
   longer contains a `%` (replaced by `—`).

## Expected results

- Pre-fast-forward: stale affordance is hidden (DOM element either
  absent or `display: none` / `x-cloak`-gated).
- Post-fast-forward: stale affordance is visible AND the pill text
  matches `/—|stale/i` (the em-dash and/or the literal `stale` label).

## Out of scope

- Cluster rendering / per-source popover — covered by
  `rate-limit-cluster-renders.spec.ts`.
- Viewport reflow / collapse — covered by
  `rate-limit-cluster-reflow.spec.ts`.
- Dark-mode neutral-token mapping — composes orthogonally with CR-0006.

## Coverage

- FR-20: stale-affordance fires when no fresh push has arrived within
  2 × poll-interval.
