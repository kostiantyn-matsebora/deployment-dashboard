/**
 * Live-app E2E — Presets control (issue #357).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3002).
 *
 * The presets button (⊙, data-testid="presets-btn") lives in the topbar.
 * Settings are persisted under "dd:presets" in localStorage as a JSON array
 * of PresetEnvelope objects ({ version:1, name, settings }).
 *
 * Assertions:
 *   A) Presets button is present in the topbar and opens a popover.
 *   B) Save a new preset — popover shows name input; saved preset appears in list.
 *   C) Apply a preset — confirmation message is shown.
 *   D) Clone a preset — a copy with " (copy)" suffix appears in the list.
 *   E) Rename a preset — inline rename input appears; renamed name is reflected.
 *   F) Delete a preset — native confirm is handled; preset is removed from list.
 *   G) Export current — triggers a file download named "dd-preset-current-settings.json".
 *   H) Export a saved preset — triggers a download named "dd-preset-<slug>.json".
 *
 * Screenshots (adopter docs):
 *   - docs/_assets/screenshots/presets-dark.png
 *   - docs/_assets/screenshots/presets-light.png
 */

import { test, expect, Page } from '@playwright/test';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key used by PresetsService. */
const STORAGE_KEY = 'dd:presets';

/** Absolute path for adopter-doc screenshots. */
const SCREENSHOTS_DIR = path.resolve(
  __dirname,
  '../../../docs/_assets/screenshots',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the matrix view and wipe all preset + app-state localStorage
 * keys so each test starts from a clean slate.
 */
async function openMatrixClean(page: Page): Promise<void> {
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });

  await page.evaluate((key: string) => {
    // Clear presets + common app-state keys so state carried from prior tests
    // does not interfere.
    localStorage.removeItem(key);
    localStorage.removeItem('dd:svcPatterns');
    localStorage.removeItem('dd:svcFilterMode');
    localStorage.removeItem('dd:matFields');
    localStorage.removeItem('dd:colOrder');
    localStorage.removeItem('dd:colHidden');
    localStorage.removeItem('dd:theme');
    localStorage.removeItem('dd:failOnly');
  }, STORAGE_KEY);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-root', { timeout: 20_000 });
  // Allow matrix data to settle before interacting with the topbar.
  await page.waitForTimeout(800);
}

/**
 * Seed the preset list directly in localStorage then reload so the Angular
 * signal is populated from storage.  Returns after the SPA is ready.
 */
async function seedPreset(page: Page, name: string): Promise<void> {
  await page.evaluate(
    ({ key, n }: { key: string; n: string }) => {
      const existing: unknown[] = (() => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as unknown[]) : [];
        } catch {
          return [];
        }
      })();
      existing.push({
        version: 1,
        name: n,
        settings: { theme: 'dark', view: 'matrix' },
      });
      localStorage.setItem(key, JSON.stringify(existing));
    },
    { key: STORAGE_KEY, n: name },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-root', { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/**
 * Open the presets popover by clicking the presets button.
 * Waits for the PRESETS heading inside the popover to become visible.
 */
async function openPresetsPopover(page: Page): Promise<void> {
  await page.locator('[data-testid="presets-btn"]').click();
  // The p-popover content is rendered in a portal appended to <body>.
  await page.waitForSelector('.presets-content', { timeout: 10_000 });
}

/**
 * Return the preset names currently listed in the open popover.
 */
async function listedPresetNames(page: Page): Promise<string[]> {
  const names = await page
    .locator('.presets-list .presets-name')
    .allTextContents();
  return names.map((n) => n.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// A) Presets button presence and popover open/close
// ---------------------------------------------------------------------------

test.describe('Presets button', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('A) presets button is visible in the topbar', async ({ page }) => {
    const btn = page.locator('[data-testid="presets-btn"]');
    await expect(btn).toBeVisible();
  });

  test('A) clicking presets button opens a popover with PRESETS heading', async ({ page }) => {
    await openPresetsPopover(page);

    // The popover title element must contain "PRESETS".
    const title = page.locator('.presets-content .popover-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('PRESETS');
  });

  test('A) closing presets popover with Escape hides the popover', async ({ page }) => {
    await openPresetsPopover(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// B) Save a new preset
// ---------------------------------------------------------------------------

test.describe('Save preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('B) "Save current…" button reveals the name input', async ({ page }) => {
    await openPresetsPopover(page);

    await page.locator('[data-testid="presets-save-btn"]').click();
    await expect(page.locator('[data-testid="presets-name-input"]')).toBeVisible();
  });

  test('B) entering a name and clicking Save adds the preset to the list', async ({
    page,
  }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('My preset');
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();

    // Wait for Angular to re-render the list (signal update + change detection).
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('My preset');
  });

  test('B) saving a preset shows a confirmation message', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('Snapshot A');
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Saved');
  });

  test('B) pressing Enter in the name input also saves the preset', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('Enter-save');
    await page.keyboard.press('Enter');

    // Wait for the list to populate after Enter.
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('Enter-save');
  });

  test('B) blank name shows an error and does not save', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    // Leave the name input empty and click Save.
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('blank');

    // The list should still be empty (no preset added).
    await expect(page.locator('.presets-list')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// C) Apply a preset
// ---------------------------------------------------------------------------

test.describe('Apply preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'Work config');
  });

  test('C) Apply button shows a confirmation message', async ({ page }) => {
    await openPresetsPopover(page);

    await page.locator('[data-testid="preset-apply-btn"]').first().click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Applied');
    await expect(msg).toContainText('Work config');
  });
});

// ---------------------------------------------------------------------------
// D) Clone a preset
// ---------------------------------------------------------------------------

test.describe('Clone preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'Base preset');
  });

  test('D) Clone button adds a copy with " (copy)" suffix', async ({ page }) => {
    await openPresetsPopover(page);

    await page.locator('[data-testid="preset-clone-btn"]').first().click();

    // Wait for the cloned preset to appear (signal update → 2 items).
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(2, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('Base preset');
    expect(names).toContain('Base preset (copy)');
  });

  test('D) Clone shows a confirmation message', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-clone-btn"]').first().click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Cloned');
  });
});

// ---------------------------------------------------------------------------
// E) Rename a preset
// ---------------------------------------------------------------------------

test.describe('Rename preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'Old name');
  });

  test('E) Rename button reveals an inline rename input pre-filled with current name', async ({
    page,
  }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-rename-btn"]').first().click();

    const renameInput = page.locator('[data-testid="preset-rename-input"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('Old name');
  });

  test('E) confirming a rename updates the preset name in the list', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-rename-btn"]').first().click();

    const renameInput = page.locator('[data-testid="preset-rename-input"]');
    await renameInput.fill('New name');
    await page.locator('[data-testid="preset-rename-confirm-btn"]').click();

    // Wait for the rename input to disappear and the updated name to appear.
    await expect(renameInput).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('New name');
    expect(names).not.toContain('Old name');
  });

  test('E) pressing Enter in the rename input confirms the rename', async ({ page }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-rename-btn"]').first().click();

    const renameInput = page.locator('[data-testid="preset-rename-input"]');
    await renameInput.fill('Keyboard rename');
    await page.keyboard.press('Enter');

    // Wait for the rename input to disappear and the updated name to appear.
    await expect(renameInput).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('Keyboard rename');
  });

  test('E) pressing Escape cancels the rename — preset name is unchanged', async ({
    page,
  }) => {
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-rename-btn"]').first().click();

    const renameInput = page.locator('[data-testid="preset-rename-input"]');
    await renameInput.fill('Abandoned name');

    // Pressing Escape dismisses the PrimeNG popover (dismissable=true) which also
    // cancels the in-progress rename.  The rename input disappears.
    await renameInput.press('Escape');

    // After Escape the rename input must be gone (either popper closed or
    // cancelRenamePreset fired — both result in input count = 0).
    await expect(renameInput).toHaveCount(0, { timeout: 5_000 });

    // The preset in localStorage must still have the original name.
    // Re-open the popover to verify (in case the entire popper was dismissed).
    const stored = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as Array<{ name: string }> : [];
    }, STORAGE_KEY);
    const storedNames = stored.map((e) => e.name);
    expect(storedNames).toContain('Old name');
    expect(storedNames).not.toContain('Abandoned name');
  });
});

// ---------------------------------------------------------------------------
// F) Delete a preset
// ---------------------------------------------------------------------------

test.describe('Delete preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'To delete');
  });

  test('F) Delete with confirm accepted removes the preset from the list', async ({ page }) => {
    await openPresetsPopover(page);

    // Handle the native window.confirm by accepting it.
    // Register BEFORE the click so the dialog is caught synchronously.
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="preset-delete-btn"]').first().click();

    // Wait for the list to become empty after the delete.
    await expect(page.locator('.presets-list')).toHaveCount(0, { timeout: 5_000 });
    const names = await listedPresetNames(page);
    expect(names).not.toContain('To delete');
  });

  test('F) Delete with confirm dismissed leaves the preset in the list', async ({ page }) => {
    await openPresetsPopover(page);

    // Dismiss the confirm dialog — preset must remain.
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.locator('[data-testid="preset-delete-btn"]').first().click();

    const names = await listedPresetNames(page);
    expect(names).toContain('To delete');
  });
});

// ---------------------------------------------------------------------------
// G) Export current settings
// ---------------------------------------------------------------------------

test.describe('Export current settings', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('G) "Export current" triggers a download named dd-preset-current-settings.json', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="presets-export-current-btn"]').click(),
    ]);

    expect(download.suggestedFilename()).toBe('dd-preset-current-settings.json');
  });
});

// ---------------------------------------------------------------------------
// H) Export a saved preset
// ---------------------------------------------------------------------------

test.describe('Export saved preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'My export');
  });

  test('H) Export button on a preset triggers a download named dd-preset-<slug>.json', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="preset-export-btn"]').first().click(),
    ]);

    expect(download.suggestedFilename()).toBe('dd-preset-my-export.json');
  });
});

// ---------------------------------------------------------------------------
// Screenshots — adopter docs (dark + light themes)
// ---------------------------------------------------------------------------

test.describe('Screenshots', () => {
  test('screenshot: presets-dark.png — popover with saved presets, dark theme', async ({
    page,
  }) => {
    await openMatrixClean(page);

    // Seed two presets so the screenshot shows a populated popover.
    await page.evaluate(
      ({ key }: { key: string }) => {
        const presets = [
          { version: 1, name: 'Production view', settings: { theme: 'dark', view: 'matrix' } },
          { version: 1, name: 'Failures only',   settings: { theme: 'dark', view: 'matrix', failOnly: true } },
        ];
        localStorage.setItem(key, JSON.stringify(presets));
        // Ensure dark theme.
        localStorage.setItem('dd:theme', 'dark');
      },
      { key: STORAGE_KEY },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(600);

    await openPresetsPopover(page);

    // Screenshot the topbar + open presets popover region.
    const topbar = page.locator('app-topbar');
    await expect(topbar).toBeVisible();

    const screenshotPath = path.join(SCREENSHOTS_DIR, 'presets-dark.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    console.log(`[SCREENSHOT] presets-dark: ${screenshotPath}`);
  });

  test('screenshot: presets-light.png — popover with saved presets, light theme', async ({
    page,
  }) => {
    await openMatrixClean(page);

    // Seed two presets + switch to light theme.
    await page.evaluate(
      ({ key }: { key: string }) => {
        const presets = [
          { version: 1, name: 'Production view', settings: { theme: 'light', view: 'matrix' } },
          { version: 1, name: 'Failures only',   settings: { theme: 'light', view: 'matrix', failOnly: true } },
        ];
        localStorage.setItem(key, JSON.stringify(presets));
        localStorage.setItem('dd:theme', 'light');
      },
      { key: STORAGE_KEY },
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(600);

    await openPresetsPopover(page);

    const topbar = page.locator('app-topbar');
    await expect(topbar).toBeVisible();

    const screenshotPath = path.join(SCREENSHOTS_DIR, 'presets-light.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    console.log(`[SCREENSHOT] presets-light: ${screenshotPath}`);
  });
});
