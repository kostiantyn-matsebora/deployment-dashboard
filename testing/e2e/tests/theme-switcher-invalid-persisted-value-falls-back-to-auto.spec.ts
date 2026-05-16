// Implements testing/e2e/scenarios/theme-switcher-invalid-persisted-value-falls-back-to-auto.md
//
// Any non-enum value persisted under `dashboard.theme` falls back to
// the default `auto`, which then derives the effective palette from
// `prefers-color-scheme`.

import { test, expect, type Page } from '@playwright/test';

async function seedThemePref(page: Page, value: string): Promise<void> {
  await page.addInitScript((v) => {
    try {
      localStorage.setItem('dashboard.theme', v);
    } catch {
      /* ignore */
    }
  }, value);
}

async function readDataset(page: Page): Promise<{ theme: string | null; pref: string | null }> {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  }));
}

// Pathological persisted values — each must normalise to pref === 'auto'.
const CORRUPT_VALUES = [
  'garbage',
  'GARBAGE',
  '{"theme":"dark"}',
  '',
  'system',
  'Light', // case-sensitive enum — capitalised is invalid
  'DARK',
  '   ',
];

test.describe('Theme switcher — invalid persisted value falls back to auto', () => {
  for (const value of CORRUPT_VALUES) {
    test(`corrupt value ${JSON.stringify(value)} + OS=dark → effective dark, pref normalised to auto`, async ({
      page,
    }) => {
      await seedThemePref(page, value);
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const ds = await readDataset(page);
      expect(ds.pref).toBe('auto');
      expect(ds.theme).toBe('dark');
    });

    test(`corrupt value ${JSON.stringify(value)} + OS=light → effective light, pref normalised to auto`, async ({
      page,
    }) => {
      await seedThemePref(page, value);
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const ds = await readDataset(page);
      expect(ds.pref).toBe('auto');
      expect(ds.theme).toBe('light');
    });
  }
});
