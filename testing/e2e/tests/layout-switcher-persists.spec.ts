// Implements testing/e2e/scenarios/layout-switcher-persists.md
//
// Validates FR-13 + SAD §7 "Layout axis" + §7 "Client-side
// persistence": the three-layout segmented control sets the active
// `data-layout` on the matrix root, writes `dashboard.layout` to
// localStorage, and the selection survives a full page reload. Layout
// is orthogonal to view (FR-12); switching layout never mutates
// `dashboard.view`.

import { test, expect, type Page } from '@playwright/test';

type LayoutId = 'matrix' | 'swim-lane' | 'workflow-rows';

const NON_DEFAULT_LAYOUTS: LayoutId[] = ['swim-lane', 'workflow-rows'];
const ALL_LAYOUTS: LayoutId[] = ['matrix', 'swim-lane', 'workflow-rows'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('layout-switcher')).toBeVisible();
});

async function expectActiveLayout(page: Page, layout: LayoutId): Promise<void> {
  await expect(page.getByTestId(`layout-option-${layout}`)).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', layout);
}

async function readPersistedLayout(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('dashboard.layout'));
}

async function readPersistedView(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('dashboard.view'));
}

test('First-time visitor lands on Matrix layout', async ({ page }) => {
  await expectActiveLayout(page, 'matrix');

  // Default may be either an absent key (defaults apply) or the
  // literal "matrix" per SAD §7 hardening rules.
  const persisted = await readPersistedLayout(page);
  expect(persisted === null || persisted === 'matrix').toBeTruthy();
});

for (const layout of NON_DEFAULT_LAYOUTS) {
  test(`Switching to ${layout} persists across reload`, async ({ page }) => {
    await expectActiveLayout(page, 'matrix');

    await page.getByTestId(`layout-option-${layout}`).click();
    await expectActiveLayout(page, layout);
    expect(await readPersistedLayout(page)).toBe(layout);

    await page.reload();
    await expect(page.getByTestId('layout-switcher')).toBeVisible();
    await expectActiveLayout(page, layout);
    expect(await readPersistedLayout(page)).toBe(layout);
  });
}

test('Cycling through every layout updates data-layout in lock-step', async ({ page }) => {
  for (const layout of ALL_LAYOUTS) {
    await page.getByTestId(`layout-option-${layout}`).click();
    await expectActiveLayout(page, layout);
    expect(await readPersistedLayout(page)).toBe(layout);
  }
});

test('Layout switch does not mutate the view selection (FR-12 / FR-13 orthogonality)', async ({ page }) => {
  // Set a non-default view first.
  await page.getByTestId('view-option-glance').click();
  await expect(page.getByTestId('view-option-glance')).toHaveAttribute('data-active', 'true');
  const viewBefore = await readPersistedView(page);
  expect(viewBefore).toBe('glance');

  // Toggle the layout; the view selection must be untouched.
  await page.getByTestId('layout-option-swim-lane').click();
  await expectActiveLayout(page, 'swim-lane');

  // View persists / is still glance.
  expect(await readPersistedView(page)).toBe('glance');
  await expect(page.getByTestId('view-option-glance')).toHaveAttribute('data-active', 'true');
});
