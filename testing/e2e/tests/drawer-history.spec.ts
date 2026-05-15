// Implements testing/e2e/scenarios/drawer-history.md
//
// Clicks a populated stage box, validates the drawer's current panel,
// last-successful panel, and lazily-fetched history list, then closes
// the drawer.

import { test, expect } from '@playwright/test';

const SERVICE = 'service-c';
const SERVICE_NAME_LABEL = 'Service C';
const ENV_ID = 'dev';
const ENV_LABEL = 'DEV';
const CURRENT_VERSION = 'v3.1.2';
const LAST_SUCCESSFUL_VERSION = 'v3.1.0';

test('Clicking a stage box opens the history drawer with current, last-successful and history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  const box = page.getByTestId(`stage-box-${SERVICE}-${ENV_ID}`);
  await expect(box).toBeVisible();
  await box.click();

  const drawer = page.getByTestId('history-drawer');
  await expect(drawer).toBeVisible();

  // Drawer header reflects the clicked slot. Service display name is
  // derived inside the SPA; for a fixture-supplied service id without
  // a known display-name mapping the SPA falls back to the id, so we
  // accept either form to keep this test resilient.
  const serviceNameEl = page.getByTestId('drawer-service-name');
  await expect(serviceNameEl).toBeVisible();
  const serviceNameText = (await serviceNameEl.textContent())?.trim() ?? '';
  expect([SERVICE_NAME_LABEL, SERVICE]).toContain(serviceNameText);

  // Env label — same fallback story.
  const envLabelEl = page.getByTestId('drawer-env-label');
  await expect(envLabelEl).toBeVisible();
  const envText = (await envLabelEl.textContent())?.trim() ?? '';
  expect([ENV_LABEL, ENV_ID]).toContain(envText);

  // Current panel shows current version + "running" badge.
  const current = page.getByTestId('drawer-current');
  await expect(current).toBeVisible();
  await expect(current).toContainText(CURRENT_VERSION);
  await expect(current).toContainText('running');

  // Last-successful panel exists for this state and references v3.1.0.
  const lastSuccessful = page.getByTestId('drawer-last-successful');
  await expect(lastSuccessful).toBeVisible();
  await expect(lastSuccessful).toContainText(LAST_SUCCESSFUL_VERSION);

  // History list is lazy-fetched on drawer open. Wait until either the
  // list renders or the loading indicator is gone.
  await expect(page.getByTestId('drawer-history-loading')).toHaveCount(0, { timeout: 10_000 });
  const historyList = page.getByTestId('drawer-history-list');
  await expect(historyList).toBeVisible();

  // At least three entries (in-progress, failure, success) per fixture.
  const entries = historyList.locator('> div');
  await expect(entries).not.toHaveCount(0);
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // First row must be the most recent event — the in-progress v3.1.2.
  await expect(entries.first()).toContainText(CURRENT_VERSION);

  // Close button removes the drawer.
  await page.getByTestId('drawer-close').click();
  await expect(page.getByTestId('history-drawer')).toHaveCount(0);
});
