// Implements testing/e2e/scenarios/attribute-picker-persistence.md
//
// Validates FR-02 (seven-attribute set) + FR-12 + SAD §7 "Client-side
// persistence": every check / uncheck writes the active view's
// selection to localStorage[`dashboard.attrs.<view>`]; reload restores
// the exact array; `[]` is preserved as a legitimate choice
// (defaults are NOT auto-restored); `ref` and `sha` are first-class
// keys in the persisted array.

import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
});

async function readAttrs(page: Page, view: string): Promise<string[] | null> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), `dashboard.attrs.${view}`);
  if (raw === null) return null;
  return JSON.parse(raw) as string[];
}

test('Compact selection including sha persists across reload', async ({ page }) => {
  await page.getByTestId('view-option-compact').click();
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');

  // Free a slot (uncheck `run`) and add `sha` — exercises the
  // ref/sha-aware persistence path the original test never covered.
  await page.getByTestId('attr-checkbox-run').uncheck();
  await page.getByTestId('attr-checkbox-sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');

  const persisted = await readAttrs(page, 'compact');
  expect(persisted).not.toBeNull();
  expect(new Set(persisted!)).toEqual(new Set(['status', 'version', 'ago', 'sha']));

  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('view-option-compact')).toHaveAttribute('data-active', 'true');
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
  await expect(page.getByTestId('attr-checkbox-status')).toBeChecked();
  await expect(page.getByTestId('attr-checkbox-version')).toBeChecked();
  await expect(page.getByTestId('attr-checkbox-ago')).toBeChecked();
  await expect(page.getByTestId('attr-checkbox-sha')).toBeChecked();
  await expect(page.getByTestId('attr-checkbox-run')).not.toBeChecked();
  await expect(page.getByTestId('attr-checkbox-actor')).not.toBeChecked();
  await expect(page.getByTestId('attr-checkbox-ref')).not.toBeChecked();
});

test('Glance empty selection persists across reload (defaults are not auto-restored)', async ({ page }) => {
  await page.getByTestId('view-option-glance').click();
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');

  await page.getByTestId('attr-checkbox-version').uncheck();
  await expect(page.getByTestId('picker-counter')).toHaveText('0/1');

  const persisted = await readAttrs(page, 'glance');
  expect(persisted).not.toBeNull();
  expect(persisted!.length).toBe(0);

  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('view-option-glance')).toHaveAttribute('data-active', 'true');
  await page.getByTestId('attribute-picker').click();
  // Empty array survives reload — defaults are NOT auto-restored.
  await expect(page.getByTestId('picker-counter')).toHaveText('0/1');
  for (const a of ['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha']) {
    await expect(page.getByTestId(`attr-checkbox-${a}`)).not.toBeChecked();
  }
});

test('Glance ["ref"] selection persists across reload', async ({ page }) => {
  // Glance cap is 1 — verify the user can pick `ref` instead of the
  // default `version`, and the choice survives a reload as a single-
  // entry array. Mirror for `sha` is exercised by sha-truncation.spec.ts
  // (selecting sha + asserting the truncated render).
  await page.getByTestId('view-option-glance').click();
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');

  // Swap version -> ref: uncheck version first (frees the slot),
  // then check ref. At cap 1 the unchecked `ref` is disabled when
  // version is still checked, so the order matters.
  await page.getByTestId('attr-checkbox-version').uncheck();
  await page.getByTestId('attr-checkbox-ref').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');

  const persisted = await readAttrs(page, 'glance');
  expect(persisted).not.toBeNull();
  expect(persisted!).toEqual(['ref']);

  // Other six are unchecked + disabled (cap reached on a non-version key).
  for (const a of ['status', 'version', 'run', 'ago', 'actor', 'sha']) {
    await expect(page.getByTestId(`attr-checkbox-${a}`)).not.toBeChecked();
    await expect(page.getByTestId(`attr-checkbox-${a}`)).toBeDisabled();
  }

  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('view-option-glance')).toHaveAttribute('data-active', 'true');
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');
  await expect(page.getByTestId('attr-checkbox-ref')).toBeChecked();
});
