// Implements testing/e2e/scenarios/realtime-sse-update.md
//
// Measures the end-to-end POST-to-SSE-to-DOM latency. NFR-03 budgets 5s
// for the whole pipeline; we hold that as the upper bound. Uses a
// brand-new (service, environment) pair so the assertion is unambiguous.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, runSuffix, buildDeploymentPayload } from './support/env';

test('POSTed event appears in the matrix within 5 s without a page reload', async ({ page }) => {
  const suffix = runSuffix();
  // Suffix the service + environment as well as the version so the
  // "slot must not exist" precondition holds on every re-run without
  // a manual cleanup step. The mockup-derived assertions don't care
  // about exact names; only that the slot is unique for this run.
  const SERVICE = `qa-bot-realtime-${suffix}`;
  const ENVIRONMENT = `e2e-live-${suffix}`;
  const VERSION = `v0.0.${suffix}`;
  const TEST_ID = `stage-box-${SERVICE}-${ENVIRONMENT}`;

  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  // Sanity — the slot must not exist before the POST.
  await expect(page.getByTestId(TEST_ID)).toHaveCount(0);

  // Track navigations to verify "no page reload" later.
  let navigationCount = 0;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigationCount += 1;
  });
  const baselineNavCount = navigationCount;

  // POST directly to the Write API (bypasses the SPA's client).
  const apiContext = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });

  const start = Date.now();
  const resp = await apiContext.post('/api/deployments', {
    data: buildDeploymentPayload({
      service: SERVICE,
      environment: ENVIRONMENT,
      version: VERSION,
      status: 'in-progress',
      run_url: 'https://example.com/runs/e2e-live',
      run_number: 90001,
    }),
  });
  expect(resp.status()).toBe(201);

  // Wait for the SPA to render the new box. NFR-03 hard cap: 5 s from POST.
  const box = page.getByTestId(TEST_ID);
  await expect(box).toBeVisible({ timeout: 5_000 });
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThanOrEqual(5_000);

  // Version on the rendered box matches the POST.
  await expect(page.getByTestId(`current-version-${SERVICE}-${ENVIRONMENT}`))
    .toHaveText(VERSION);

  // No additional main-frame navigation occurred during the test (the
  // browser did not reload).
  expect(navigationCount).toBe(baselineNavCount);

  await apiContext.dispose();
});
