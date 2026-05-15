// Implements testing/e2e/scenarios/view-switch-keeps-drawer-open.md
//
// Validates FR-04 + FR-12 + SAD §7 "Full-attribute disclosure rule":
// the history drawer is independent of the active layout view.
// Switching views while the drawer is open must NOT close it nor
// rebind it to a different slot, and no JS errors should fire during
// the matrix re-render.

import { test, expect } from '@playwright/test';

const SERVICE = 'service-b';
const ENV = 'qa';

test('Drawer survives every view switch and closes cleanly', async ({ page }) => {
  // Collect every uncaught page error for the final assertion.
  const errors: Error[] = [];
  page.on('pageerror', (err) => errors.push(err));

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(page.getByTestId('view-option-detailed')).toHaveAttribute('data-active', 'true');

  // Open drawer on service-b/qa.
  await page.getByTestId(`stage-box-${SERVICE}-${ENV}`).click();
  const drawer = page.getByTestId('history-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-drawer-slot', `${SERVICE}/${ENV}`);

  for (const view of ['compact', 'glance', 'focus'] as const) {
    await page.getByTestId(`view-option-${view}`).click();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
    // Drawer must remain visible and bound to the same slot under
    // every new layout.
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-drawer-slot', `${SERVICE}/${ENV}`);
  }

  await page.getByTestId('drawer-close').click();
  await expect(drawer).toBeHidden();

  expect(errors, `Browser pageerror events: ${errors.map((e) => e.message).join('; ')}`).toHaveLength(0);
});
