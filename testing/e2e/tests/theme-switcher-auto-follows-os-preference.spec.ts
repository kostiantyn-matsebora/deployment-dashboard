// Implements testing/e2e/scenarios/theme-switcher-auto-follows-os-preference.md
//
// When pref === 'auto', flipping the emulated OS colour scheme flips
// <html data-theme> live without a reload (MQL change listener).
// When pref === 'light' or 'dark', the OS flip is ignored.

import { test, expect, type Page } from '@playwright/test';

async function readDataset(page: Page): Promise<{ theme: string | null; pref: string | null }> {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  }));
}

async function installPersistenceMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __THEME_NAV_MARKER__?: number }).__THEME_NAV_MARKER__ = Date.now();
  });
}

async function navigationMarkerStillPresent(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    typeof (window as unknown as { __THEME_NAV_MARKER__?: number }).__THEME_NAV_MARKER__ === 'number',
  );
}

async function selectTheme(page: Page, pref: 'light' | 'dark' | 'auto'): Promise<void> {
  await page.getByTestId('theme-gear').click();
  await page.getByTestId(`theme-option-${pref}`).click();
}

test.describe('Theme switcher — auto follows OS preference (live)', () => {
  test.beforeEach(async ({ page }) => {
    // Land cleanly with no persisted pref so the default is `auto`.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('theme-switcher')).toBeVisible();
  });

  test('Case A — auto + OS=light → data-theme=light on first paint', async ({ page }) => {
    const ds = await readDataset(page);
    expect(ds.pref).toBe('auto');
    expect(ds.theme).toBe('light');
  });

  test('Case B — auto + OS flips light→dark mid-session → data-theme flips live', async ({ page }) => {
    await installPersistenceMarker(page);

    // Confirm starting state.
    let ds = await readDataset(page);
    expect(ds.pref).toBe('auto');
    expect(ds.theme).toBe('light');

    await page.emulateMedia({ colorScheme: 'dark' });

    await expect.poll(async () => (await readDataset(page)).theme, { timeout: 5_000 }).toBe('dark');
    ds = await readDataset(page);
    expect(ds.pref).toBe('auto'); // unchanged
    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('Case C — auto + OS flips dark→light mid-session → data-theme flips back', async ({ page }) => {
    await installPersistenceMarker(page);

    // Flip OS to dark first to set baseline.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(async () => (await readDataset(page)).theme).toBe('dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await readDataset(page)).theme).toBe('light');

    const ds = await readDataset(page);
    expect(ds.pref).toBe('auto');
    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('Case D — explicit Dark + OS flip ignores', async ({ page }) => {
    await selectTheme(page, 'dark');
    await expect.poll(async () => (await readDataset(page)).theme).toBe('dark');

    await installPersistenceMarker(page);

    await page.emulateMedia({ colorScheme: 'light' });
    // Give the listener time to fire if it incorrectly listens; the
    // contract says it MUST NOT change the effective theme.
    await page.waitForTimeout(500);

    const ds = await readDataset(page);
    expect(ds.pref).toBe('dark');
    expect(ds.theme).toBe('dark');
    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });

  test('Case E — explicit Light + OS flip ignores', async ({ page }) => {
    await selectTheme(page, 'light');
    await expect.poll(async () => (await readDataset(page)).theme).toBe('light');

    await installPersistenceMarker(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);

    const ds = await readDataset(page);
    expect(ds.pref).toBe('light');
    expect(ds.theme).toBe('light');
    expect(await navigationMarkerStillPresent(page)).toBe(true);
  });
});
