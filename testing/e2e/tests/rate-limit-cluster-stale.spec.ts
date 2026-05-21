// Implements testing/e2e/scenarios/rate-limit-cluster-stale.md
//
// CR-0011 § 3d — stale-affordance fires when now - received_at > 2 ×
// poll_interval (MVP hard-codes poll_interval = 60 s, threshold = 120 s).
// Uses page.clock.install so the SPA's Date.now() is fully controllable
// from the test — no production seed-override surface.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildFetcherUsagePayload } from './support/env';

const PROGRESS_REPORTER = 'dashboard-fetcher/e2e-stale';

test('Rate-limit cluster flips to stale affordance after now - received_at > 120 s', async ({ page }) => {
  const suffix = runSuffix();
  const adapter = 'github-actions';
  const source = `qa-bot/e2e-stale-${suffix}`;

  // Pin the clock at an anchor BEFORE navigating; the SPA's first
  // Date.now() inside its poll will see this value. Playwright's
  // page.clock.install supersedes the page's wall clock entirely.
  const anchor = new Date('2026-05-21T13:00:00.000Z').getTime();
  await page.clock.install({ time: anchor });

  // POST a snapshot with observed_at = anchor. The server stamps
  // received_at close to its own wall-clock — since the test runs
  // inline this is within seconds of anchor; the SPA's 120 s stale
  // threshold uses received_at on the wire.
  const api = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: {
      'X-Api-Key': API_KEY,
      'X-Progress-Reporter': PROGRESS_REPORTER,
      'Content-Type': 'application/json',
    },
  });
  const resp = await api.post('/api/fetcher/usage', {
    data: buildFetcherUsagePayload({
      adapter_id: adapter,
      source_id: source,
      upstream_limit: 5000,
      upstream_remaining: 4500, // 10% — green
      observed_at: new Date(anchor).toISOString(),
    }),
  });
  expect(resp.status()).toBe(200);

  await page.goto('/');
  await expect(page.getByTestId('rate-limit-cluster'))
    .toBeAttached({ timeout: 35_000 });

  // Pre-fast-forward: stale affordance must be hidden (or absent).
  const stale = page.getByTestId('rate-limit-stale');
  await expect(stale).toBeHidden();

  // Fast-forward the SPA's clock past the stale threshold (120 s).
  await page.clock.fastForward('00:02:05'); // 125 s

  // Either the affordance becomes visible OR the pill text loses the
  // '%' character (replaced by '—' per docs/ui/rate-limit-cluster.md
  // § Stale-affordance visual). We accept either signal as the
  // load-bearing stale flip — implementation may render only one of
  // them at the lowest viewport.
  await expect.poll(async () => {
    const visible = await stale.isVisible().catch(() => false);
    if (visible) return 'stale-affordance-visible';

    const pill = page.locator(
      "[data-testid='rate-limit-pill'], [data-testid='rate-limit-pill-collapsed']",
    ).first();
    const text = (await pill.textContent().catch(() => '')) ?? '';
    if (/—|stale/i.test(text) && !/%/.test(text)) return 'pill-text-staled';

    return 'still-live';
  }, { timeout: 35_000, intervals: [500, 1_000, 2_000] }).not.toBe('still-live');

  await api.dispose();
});
