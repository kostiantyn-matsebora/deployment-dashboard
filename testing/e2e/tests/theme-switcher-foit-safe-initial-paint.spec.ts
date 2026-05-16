// Implements testing/e2e/scenarios/theme-switcher-foit-safe-initial-paint.md
//
// Asserts the FOIT-safe inline <head> bootstrap script has already
// set <html data-theme> + <html data-theme-pref> on first paint, BEFORE
// Angular has had a chance to render. We do not wait for the SPA's
// hydrated state — we read the dataset attributes off
// document.documentElement immediately after `domcontentloaded`.

import { test, expect, type Page } from '@playwright/test';

type ThemePref = 'light' | 'dark' | 'auto';

async function seedThemePref(page: Page, value: string): Promise<void> {
  // addInitScript runs BEFORE every navigation in the page context —
  // ensuring the inline bootstrap reads the value on its first run.
  await page.addInitScript((v) => {
    try {
      localStorage.setItem('dashboard.theme', v);
    } catch {
      /* storage disabled — test will fail in the assertion */
    }
  }, value);
}

async function readDataset(page: Page): Promise<{ theme: string | null; pref: string | null }> {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  }));
}

test.describe('Theme switcher — FOIT-safe initial paint', () => {
  test('persisted "dark" paints data-theme="dark" before Angular renders', async ({ page }) => {
    await seedThemePref(page, 'dark');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ds = await readDataset(page);
    expect(ds.theme).toBe('dark');
    expect(ds.pref).toBe('dark');
  });

  test('persisted "light" paints data-theme="light" before Angular renders', async ({ page }) => {
    await seedThemePref(page, 'light');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ds = await readDataset(page);
    expect(ds.theme).toBe('light');
    expect(ds.pref).toBe('light');
  });

  test('persisted "auto" + OS=dark resolves data-theme="dark" on first paint', async ({ page }) => {
    await seedThemePref(page, 'auto');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ds = await readDataset(page);
    expect(ds.theme).toBe('dark');
    expect(ds.pref).toBe('auto');
  });

  test('persisted "auto" + OS=light resolves data-theme="light" on first paint', async ({ page }) => {
    await seedThemePref(page, 'auto');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ds = await readDataset(page);
    expect(ds.theme).toBe('light');
    expect(ds.pref).toBe('auto');
  });

  test('no persisted value + OS=dark resolves data-theme="dark" on first paint (default auto)', async ({ page }) => {
    // Do NOT seed — first-time visitor.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const ds = await readDataset(page);
    expect(ds.theme).toBe('dark');
    expect(ds.pref).toBe('auto');
  });

  // Parameterised round-trip for every enum value × every OS value.
  const PREFS: ThemePref[] = ['light', 'dark', 'auto'];
  const OS_SCHEMES: Array<'light' | 'dark'> = ['light', 'dark'];

  for (const pref of PREFS) {
    for (const os of OS_SCHEMES) {
      test(`pref=${pref} × OS=${os} resolves the effective palette synchronously`, async ({ page }) => {
        await seedThemePref(page, pref);
        await page.emulateMedia({ colorScheme: os });
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        const ds = await readDataset(page);
        const expectedEffective = pref === 'auto' ? os : pref;
        expect(ds.theme).toBe(expectedEffective);
        expect(ds.pref).toBe(pref);
      });
    }
  }
});
