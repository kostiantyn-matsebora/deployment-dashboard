// Implements testing/e2e/scenarios/picker-ref-sha-checkboxes.md
//
// Validates FR-02 + FR-05 + FR-12: the Display picker exposes ref /
// sha checkboxes; selecting either adds a per-slot render anchor
// (current-{ref|sha}-<service>-<env>); unchecking removes it.
// Fixture values are asserted verbatim for slots that carry the field.

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
});

test('Selecting `ref` renders source-ref values from the fixture verbatim', async ({ page }) => {
  // Open the picker, check the ref attribute -> 6/7.
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');

  // Close the picker so it doesn't obscure the grid.
  await page.getByTestId('attribute-picker').click();

  // service-b/dev: ref="main" per seed-data.json.
  await expect(page.getByTestId('current-ref-service-b-dev')).toHaveText('main');

  // service-a/dev: ref="feature/login-revamp" per seed-data.json
  // (latest event, status in-progress).
  await expect(page.getByTestId('current-ref-service-a-dev')).toHaveText('feature/login-revamp');

  // service-d/dev: ref="hotfix/d-dev-1250" per seed-data.json (latest
  // event in the running-with-prev-failed chain).
  await expect(page.getByTestId('current-ref-service-d-dev')).toHaveText('hotfix/d-dev-1250');
});

test('Selecting `sha` adds a per-slot anchor for slots whose current.sha is non-empty', async ({ page }) => {
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
  await page.getByTestId('attribute-picker').click();

  // service-b/dev: sha="9f1c0d2e8a" (10 chars) — anchor must be in
  // the DOM and non-empty. The actual rendered text length depends on
  // the SPA's display truncation (covered by sha-truncation.spec.ts);
  // here we only assert PRESENCE + non-empty.
  const sha = page.getByTestId('current-sha-service-b-dev');
  await expect(sha).toBeVisible();
  const shaText = (await sha.textContent()) ?? '';
  expect(shaText.trim().length).toBeGreaterThan(0);
});

test('Unchecking `ref` removes the per-slot anchor; sibling sha render is unaffected', async ({ page }) => {
  // Pre-select both ref + sha (7/7).
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').check();
  await page.getByTestId('attr-checkbox-sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('7/7');
  await page.getByTestId('attribute-picker').click();

  // Sanity: both anchors visible on service-b/dev.
  await expect(page.getByTestId('current-ref-service-b-dev')).toBeVisible();
  await expect(page.getByTestId('current-sha-service-b-dev')).toBeVisible();

  // Now uncheck ref. Anchor disappears; sha anchor stays.
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').uncheck();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
  await page.getByTestId('attribute-picker').click();

  await expect(page.getByTestId('current-ref-service-b-dev')).toHaveCount(0);
  await expect(page.getByTestId('current-sha-service-b-dev')).toBeVisible();
});

test('Picker selection of `sha` persists across reload and is reflected on first paint', async ({ page }) => {
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');

  // Sanity: localStorage has the expected key shape.
  const persisted = await page.evaluate(() =>
    localStorage.getItem('dashboard.attrs.detailed'),
  );
  expect(persisted).not.toBeNull();
  const arr = JSON.parse(persisted!) as string[];
  expect(arr).toContain('sha');
  expect(arr).not.toContain('ref'); // ref was not checked

  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  // No further picker click required — first paint must honour the
  // persisted selection.
  await expect(page.getByTestId('current-sha-service-b-dev')).toBeVisible();
  await expect(page.getByTestId('current-ref-service-b-dev')).toHaveCount(0);
});
