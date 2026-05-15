// Implements testing/e2e/scenarios/view-switcher-persists.md
//
// Validates FR-12 + SAD §7 "Layout views" + §7 "Client-side
// persistence": the four-view segmented control sets the active
// `data-view` on the matrix root, writes `dashboard.view` to
// localStorage, and the selection survives a full page reload.

import { test, expect, type Page } from '@playwright/test';

type ViewId = 'detailed' | 'compact' | 'glance' | 'focus';

const NON_DEFAULT_VIEWS: ViewId[] = ['compact', 'glance', 'focus'];

test.beforeEach(async ({ page }) => {
  // First navigate so the page's storage is in the same origin we then
  // clear. Some browsers reject localStorage access on `about:blank`.
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
});

async function expectActiveView(page: Page, view: ViewId): Promise<void> {
  // The active option carries data-active="true"; the matrix root
  // carries data-view="<viewId>". Both must agree.
  await expect(page.getByTestId(`view-option-${view}`)).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-view', view);
}

async function readPersistedView(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('dashboard.view'));
}

test('First-time visitor lands on Detailed view', async ({ page }) => {
  await expectActiveView(page, 'detailed');

  // Default may be either an absent key (defaults apply) or the
  // literal "detailed" — both are acceptable per the SAD's load-time
  // hardening rules.
  const persisted = await readPersistedView(page);
  expect(persisted === null || persisted === 'detailed').toBeTruthy();
});

for (const view of NON_DEFAULT_VIEWS) {
  test(`Switching to ${view} persists across reload`, async ({ page }) => {
    await expectActiveView(page, 'detailed');

    await page.getByTestId(`view-option-${view}`).click();
    await expectActiveView(page, view);
    expect(await readPersistedView(page)).toBe(view);

    await page.reload();
    await expect(page.getByTestId('view-switcher')).toBeVisible();
    await expectActiveView(page, view);
    expect(await readPersistedView(page)).toBe(view);
  });
}
