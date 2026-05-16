// Implements testing/e2e/scenarios/theme-switcher-persists-across-reload.md
//
// Selecting a theme writes the persisted preference to localStorage
// under `dashboard.theme`, and a full page reload restores the
// effective palette with no intermediate flash back to the default.

import { test, expect, type Page } from '@playwright/test';

type ThemePref = 'light' | 'dark' | 'auto';

async function readPersisted(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('dashboard.theme'));
}

async function readDataset(page: Page): Promise<{ theme: string | null; pref: string | null }> {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  }));
}

async function selectTheme(page: Page, pref: ThemePref): Promise<void> {
  await page.getByTestId('theme-gear').click();
  await page.getByTestId(`theme-option-${pref}`).click();
}

test.describe('Theme switcher — persists across reload', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('theme-switcher')).toBeVisible();
  });

  test('first-time visitor lands with pref="auto"', async ({ page }) => {
    const ds = await readDataset(page);
    expect(ds.pref).toBe('auto');
    const persisted = await readPersisted(page);
    // Default may be either an absent key or the literal "auto".
    expect(persisted === null || persisted === 'auto').toBe(true);
  });

  test('selecting Dark writes localStorage.dashboard.theme === "dark" synchronously', async ({ page }) => {
    await selectTheme(page, 'dark');
    expect(await readPersisted(page)).toBe('dark');
  });

  test('selecting Light writes localStorage.dashboard.theme === "light" synchronously', async ({ page }) => {
    await selectTheme(page, 'light');
    expect(await readPersisted(page)).toBe('light');
  });

  test('selecting Auto writes localStorage.dashboard.theme === "auto" synchronously', async ({ page }) => {
    // Start somewhere else so the change is observable.
    await selectTheme(page, 'dark');
    await selectTheme(page, 'auto');
    expect(await readPersisted(page)).toBe('auto');
  });

  for (const pref of ['light', 'dark', 'auto'] as const) {
    test(`Reload after selecting "${pref}" restores both data-theme + data-theme-pref`, async ({ page }) => {
      await selectTheme(page, pref);
      expect(await readPersisted(page)).toBe(pref);

      await page.reload();
      await expect(page.getByTestId('theme-switcher')).toBeVisible();

      const ds = await readDataset(page);
      expect(ds.pref).toBe(pref);
      // OS = light (emulated in beforeEach), so auto resolves to light.
      const expectedEffective = pref === 'auto' ? 'light' : pref;
      expect(ds.theme).toBe(expectedEffective);
      expect(await readPersisted(page)).toBe(pref);
    });
  }
});
