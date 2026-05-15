// Implements testing/e2e/scenarios/attribute-picker-cap-enforcement.md
//
// Validates FR-02 (seven-attribute set) + FR-12 + SAD §7 "Layout views
// (FR-12)" caps table: Detailed=7, Compact=5, Glance=1, Focus=5. Once
// selectedAttrCount equals the cap, unchecked checkboxes render
// disabled; freeing a slot re-enables them. The picker exposes the
// same seven checkboxes in every view — only defaults + cap differ.

import { test, expect, type Page } from '@playwright/test';

const ALL_ATTRS = [
  'status', 'version', 'run', 'ago', 'actor', 'ref', 'sha',
] as const;
type AttrKey = (typeof ALL_ATTRS)[number];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
});

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toBeVisible();
}

function checkbox(page: Page, key: AttrKey) {
  return page.getByTestId(`attr-checkbox-${key}`);
}

test('Picker exposes the seven FR-02 attribute checkboxes in every view', async ({ page }) => {
  // The catalogue is invariant per view (only defaults + cap differ).
  // This is the FR-02 contract — every attribute is selectable in every
  // view, even if Glance can only display one at a time.
  for (const view of ['detailed', 'compact', 'glance', 'focus'] as const) {
    await page.getByTestId(`view-option-${view}`).click();
    await openPicker(page);
    for (const a of ALL_ATTRS) {
      await expect(
        checkbox(page, a),
        `view '${view}': checkbox attr-checkbox-${a} must exist in the picker (FR-02 seven-attribute set)`,
      ).toBeVisible();
    }
    // Close to avoid stale overlay across iterations.
    await page.getByTestId('attribute-picker').click();
  }
});

test('Detailed view: cap 7, defaults 5/7; ref + sha addable up to 7/7', async ({ page }) => {
  await openPicker(page);

  // 5/7 default — status / version / run / ago / actor checked;
  // ref + sha unchecked but enabled (room for two more).
  await expect(page.getByTestId('picker-counter')).toHaveText('5/7');
  for (const a of ['status', 'version', 'run', 'ago', 'actor'] as AttrKey[]) {
    await expect(checkbox(page, a)).toBeChecked();
  }
  for (const a of ['ref', 'sha'] as AttrKey[]) {
    await expect(checkbox(page, a)).not.toBeChecked();
    await expect(checkbox(page, a)).toBeEnabled();
  }

  // Check ref -> 6/7.
  await checkbox(page, 'ref').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
  // sha is still enabled (one slot left).
  await expect(checkbox(page, 'sha')).toBeEnabled();

  // Check sha -> 7/7, cap reached. Every checkbox is checked, so the
  // disabled state is not yet observable.
  await checkbox(page, 'sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('7/7');
  for (const a of ALL_ATTRS) {
    await expect(checkbox(page, a)).toBeChecked();
  }

  // Uncheck actor -> 6/7, actor is now unchecked AND enabled (room
  // for one more).
  await checkbox(page, 'actor').uncheck();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
  await expect(checkbox(page, 'actor')).not.toBeChecked();
  await expect(checkbox(page, 'actor')).toBeEnabled();
});

test('Compact view: cap 5, defaults 4/5; checking one of the three extras fills the cap and disables the others', async ({ page }) => {
  await page.getByTestId('view-option-compact').click();
  await openPicker(page);

  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
  for (const a of ['status', 'version', 'run', 'ago'] as AttrKey[]) {
    await expect(checkbox(page, a)).toBeChecked();
  }
  for (const a of ['actor', 'ref', 'sha'] as AttrKey[]) {
    await expect(checkbox(page, a)).not.toBeChecked();
    // One slot free — all three extras are enabled.
    await expect(checkbox(page, a)).toBeEnabled();
  }

  // Checking `ref` lifts to 5/5 and disables the other two unchecked
  // boxes (actor, sha) until a slot is freed.
  await checkbox(page, 'ref').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('5/5');
  await expect(checkbox(page, 'actor')).toBeDisabled();
  await expect(checkbox(page, 'sha')).toBeDisabled();

  // Uncheck `run` -> 4/5, the cap frees -> actor + sha re-enable.
  await checkbox(page, 'run').uncheck();
  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
  await expect(checkbox(page, 'actor')).toBeEnabled();
  await expect(checkbox(page, 'sha')).toBeEnabled();
});

test('Glance view: cap 1, default version; the other six checkboxes are unchecked and disabled', async ({ page }) => {
  await page.getByTestId('view-option-glance').click();
  await openPicker(page);

  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');
  await expect(checkbox(page, 'version')).toBeChecked();
  for (const a of ['status', 'run', 'ago', 'actor', 'ref', 'sha'] as AttrKey[]) {
    await expect(checkbox(page, a)).not.toBeChecked();
    await expect(checkbox(page, a)).toBeDisabled();
  }
});

test('Focus view: cap 5, defaults 4/5; behaves like Compact for cap enforcement', async ({ page }) => {
  await page.getByTestId('view-option-focus').click();
  await openPicker(page);

  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');
  for (const a of ['status', 'version', 'run', 'ago'] as AttrKey[]) {
    await expect(checkbox(page, a)).toBeChecked();
  }
  for (const a of ['actor', 'ref', 'sha'] as AttrKey[]) {
    await expect(checkbox(page, a)).not.toBeChecked();
    await expect(checkbox(page, a)).toBeEnabled();
  }

  // Check sha first -> 5/5. The other two unchecked boxes (actor, ref)
  // now disable.
  await checkbox(page, 'sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('5/5');
  await expect(checkbox(page, 'actor')).toBeDisabled();
  await expect(checkbox(page, 'ref')).toBeDisabled();
});
