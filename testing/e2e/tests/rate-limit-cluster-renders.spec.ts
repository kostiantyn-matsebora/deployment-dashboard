// Implements testing/e2e/scenarios/rate-limit-cluster-renders.md
//
// CR-0011 § 3d cluster contract; ADR-0008 Decision 3 (per-token cap →
// per-(adapter, source-id) reporting). Three snapshots span all three
// severity bands per the mockup fixture in
// docs/ui/rate-limit-cluster.md § Fixture additions.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildFetcherUsagePayload } from './support/env';

const PROGRESS_REPORTER = 'dashboard-fetcher/e2e-renders';

test('Rate-limit cluster renders with worst-band pill + counter + per-source popover', async ({ page }) => {
  const suffix = runSuffix();
  const sources = [
    { adapter: 'github-actions', source: `acme/widget-a-${suffix}`, limit: 5000, remaining: 3600 }, // 28% — green
    { adapter: 'github-actions', source: `acme/widget-b-${suffix}`, limit: 5000, remaining: 1250 }, // 75% — amber
    { adapter: 'azure-devops',   source: `contoso/payments-${suffix}`, limit: 5000, remaining:  600 }, // 88% — red (worst)
  ];

  // POST three snapshots to /api/fetcher/usage via the Write API context.
  const api = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: {
      'X-Api-Key': API_KEY,
      'X-Progress-Reporter': PROGRESS_REPORTER,
      'Content-Type': 'application/json',
    },
  });

  for (const s of sources) {
    const resp = await api.post('/api/fetcher/usage', {
      data: buildFetcherUsagePayload({
        adapter_id: s.adapter,
        source_id: s.source,
        upstream_limit: s.limit,
        upstream_remaining: s.remaining,
      }),
    });
    expect(resp.status()).toBe(200);
  }

  // Open the SPA — the cluster appears on the first /api/fetcher/usage poll.
  await page.goto('/');
  // Allow up to one MVP poll interval (30 s) + 5 s buffer.
  await expect(page.getByTestId('rate-limit-cluster'))
    .toBeAttached({ timeout: 35_000 });
  await expect(page.getByTestId('rate-limit-cluster')).toBeVisible();

  // Pill carries the worst-band token. We accept either the full pill
  // (full-viewport) OR the collapsed pill (sub-1280 viewport) — but at
  // the default 1280×720 Playwright viewport the full pill is expected.
  const pill = page.locator(
    "[data-testid='rate-limit-pill'], [data-testid='rate-limit-pill-collapsed']",
  ).first();
  await expect(pill).toBeVisible();
  const pillClass = await pill.getAttribute('class');
  // CR-0006 + docs/ui/rate-limit-cluster.md severity-band token table:
  // red light-mode = bg-red-100 (with companion text-red-700 + border).
  expect(pillClass).toContain('bg-red-100');

  // Counter shows "· N sources" — N must include our three snapshots
  // (the SPA may also be showing snapshots from earlier test runs; we
  // assert >= 3 rather than == 3 so the test is run-order-independent).
  const counter = page.getByTestId('rate-limit-counter');
  await expect(counter).toBeVisible();
  const counterText = (await counter.textContent()) ?? '';
  const nMatch = counterText.match(/(\d+)/);
  expect(nMatch).not.toBeNull();
  expect(parseInt(nMatch![1], 10)).toBeGreaterThanOrEqual(3);

  // Open the popover and assert one row per snapshot (by data-testid).
  await counter.click();
  await expect(page.getByTestId('rate-limit-popover')).toBeVisible();

  for (const s of sources) {
    await expect(
      page.locator(`[data-testid='rate-limit-row-${s.adapter}-${s.source}']`),
    ).toBeVisible();
  }

  // Outside-click closes the popover.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('rate-limit-popover')).toBeHidden();

  await api.dispose();
});
