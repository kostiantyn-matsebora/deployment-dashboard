// Implements testing/e2e/scenarios/theme-box-state-contract-under-dark.md
//
// The 6 box-state semantic contract (data-state token,
// last-successful-section, prev-failed-badge) is identical under the
// dark palette. The palette swap is a CSS-only overlay — the Tailwind
// class tokens on each box are byte-identical between light and dark.

import { test, expect, type Page } from '@playwright/test';

interface BoxStateExpectation {
  service: string;
  environment: string;
  dataState: string;
  hasLastSuccessful: boolean;
  hasPrevFailedBadge: boolean;
  /** Tailwind family token expected to remain present under both palettes. */
  familyToken: 'bg-green-50' | 'bg-red-50' | 'bg-orange-50';
}

// Same 6 slots as testing/e2e/scenarios/matrix-six-box-states.md —
// fixture parity is intentional. If the canonical fixture catalogue
// changes, both scenarios update together.
const EXPECTATIONS: readonly BoxStateExpectation[] = [
  { service: 'service-b', environment: 'dev', dataState: 'success',
    hasLastSuccessful: false, hasPrevFailedBadge: false, familyToken: 'bg-green-50' },
  { service: 'service-a', environment: 'dev', dataState: 'running-with-last',
    hasLastSuccessful: true,  hasPrevFailedBadge: false, familyToken: 'bg-orange-50' },
  { service: 'service-c', environment: 'dev', dataState: 'running-prev-failed-with-last',
    hasLastSuccessful: true,  hasPrevFailedBadge: true,  familyToken: 'bg-orange-50' },
  { service: 'service-b', environment: 'qa',  dataState: 'failed-with-last',
    hasLastSuccessful: true,  hasPrevFailedBadge: false, familyToken: 'bg-red-50' },
  { service: 'service-d', environment: 'uat', dataState: 'running',
    hasLastSuccessful: false, hasPrevFailedBadge: false, familyToken: 'bg-orange-50' },
  { service: 'service-d', environment: 'dev', dataState: 'running-prev-failed',
    hasLastSuccessful: false, hasPrevFailedBadge: true,  familyToken: 'bg-orange-50' },
];

async function seedDark(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dashboard.theme', 'dark');
    } catch {
      /* ignore */
    }
  });
}

async function readClassTokens(page: Page, service: string, env: string): Promise<readonly string[]> {
  return page.evaluate(([s, e]) => {
    const el = document.querySelector(`[data-testid="stage-box-${s}-${e}"]`);
    return el ? Array.from(el.classList) : [];
  }, [service, env] as const);
}

test.describe('Theme — 6 box-state contract preserved under dark palette', () => {
  test.beforeEach(async ({ page }) => {
    await seedDark(page);
    await page.goto('/');
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBe('dark');
  });

  for (const exp of EXPECTATIONS) {
    test(`${exp.service}/${exp.environment} renders state="${exp.dataState}" under dark`, async ({ page }) => {
      const boxId = `stage-box-${exp.service}-${exp.environment}`;
      const box = page.getByTestId(boxId);

      await expect(box).toBeVisible();
      await expect(box).toHaveAttribute('data-state', exp.dataState);

      // The palette swap is CSS-only — the Tailwind family token must
      // still be on the class list. If a dark-mode implementation
      // rewrote class strings instead of overriding via CSS, this
      // assertion would catch it.
      const tokens = await readClassTokens(page, exp.service, exp.environment);
      expect(tokens, `Box ${boxId} class tokens [${tokens.join(', ')}]`)
        .toContain(exp.familyToken);

      const lastSuccessful = box.locator('[data-testid="last-successful-section"]');
      if (exp.hasLastSuccessful) {
        await expect(lastSuccessful).toBeVisible();
      } else {
        await expect(lastSuccessful).toHaveCount(0);
      }

      const prevFailedBadge = box.locator('[data-testid="prev-failed-badge"]');
      if (exp.hasPrevFailedBadge) {
        await expect(prevFailedBadge).toBeVisible();
      } else {
        await expect(prevFailedBadge).toHaveCount(0);
      }
    });
  }

  test('class tokens on every box are byte-identical between dark and light', async ({ page }) => {
    // Capture dark-mode class strings for every fixture slot.
    const darkTokens: Record<string, string[]> = {};
    for (const exp of EXPECTATIONS) {
      darkTokens[`${exp.service}-${exp.environment}`] = [
        ...(await readClassTokens(page, exp.service, exp.environment)),
      ].sort();
    }

    // Switch to light via the popover and read again.
    await page.getByTestId('theme-gear').click();
    await page.getByTestId('theme-option-light').click();
    await expect.poll(async () =>
      page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    ).toBe('light');

    for (const exp of EXPECTATIONS) {
      const lightTokens = [
        ...(await readClassTokens(page, exp.service, exp.environment)),
      ].sort();
      const key = `${exp.service}-${exp.environment}`;
      expect(
        lightTokens,
        `Box ${key}: dark tokens [${darkTokens[key].join(', ')}] vs light tokens [${lightTokens.join(', ')}] — palette swap must not rewrite class strings`,
      ).toEqual(darkTokens[key]);
    }
  });
});
