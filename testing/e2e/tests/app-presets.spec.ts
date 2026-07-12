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
 *   J) Apply restores service filter — matrix row count visibly shrinks after applying
 *      a preset that captured a text filter.
 *   K) Reset all settings — confirm dialog accepted → defaults restored (filter cleared,
 *      failOnly off, theme dark).
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
    localStorage.removeItem('dd:presetActive');
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
// I) Update a preset with current settings
// ---------------------------------------------------------------------------

test.describe('Update preset', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('I) Update accepted overwrites the preset settings with the current live state', async ({
    page,
  }) => {
    // Step 1: save a preset while failOnly is OFF (the default after openMatrixClean).
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('Snapshot B');
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();

    // Confirm the preset is saved before proceeding.
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });

    // Close the popover by pressing Escape so we can interact with the topbar.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);

    // Step 2: toggle failures-only ON in the live UI.
    await page.locator('label.hdr-fail-toggle').click();
    // Give Angular change detection a tick to update the signal.
    await page.waitForTimeout(200);

    // Step 3: open the popover and click Update for "Snapshot B".
    await openPresetsPopover(page);

    // Register the dialog handler BEFORE clicking Update.
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="preset-update-btn"]').first().click();

    // Step 4: assert the confirmation message.
    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible({ timeout: 5_000 });
    await expect(msg).toContainText('Updated');
    await expect(msg).toContainText('Snapshot B');

    // Step 5: verify the stored preset now captures failOnly: true.
    const stored = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ name: string; settings: { failOnly?: boolean } }>) : [];
    }, STORAGE_KEY);
    const updated = stored.find((e) => e.name === 'Snapshot B');
    expect(updated).toBeDefined();
    expect(updated!.settings.failOnly).toBe(true);
  });

  test('I) Update dismissed leaves the preset settings unchanged', async ({ page }) => {
    // Save a preset while failOnly is OFF.
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('Snapshot C');
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });

    // Record the original stored settings.
    const before = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ name: string; settings: Record<string, unknown> }>) : [];
    }, STORAGE_KEY);
    const originalSettings = before.find((e) => e.name === 'Snapshot C')!.settings;

    // Toggle failures-only ON so the live state differs from the saved preset.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);
    await page.locator('label.hdr-fail-toggle').click();
    await page.waitForTimeout(200);

    // Dismiss the Update confirm dialog.
    await openPresetsPopover(page);
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.locator('[data-testid="preset-update-btn"]').first().click();

    // Settings in localStorage must be unchanged.
    const after = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ name: string; settings: Record<string, unknown> }>) : [];
    }, STORAGE_KEY);
    const afterSettings = after.find((e) => e.name === 'Snapshot C')!.settings;
    expect(afterSettings).toEqual(originalSettings);
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
// J) Apply restores service filter — VISIBLE matrix change
// ---------------------------------------------------------------------------

test.describe('Apply preset restores service filter', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('J) applying a preset that captured a text filter narrows the matrix rows', async ({
    page,
  }) => {
    // Step 1: wait for the matrix to render all rows with no filter active.
    // The mock serves 10 services; wait until at least one row-head is present.
    await page.waitForSelector('.row-head', { timeout: 15_000 });
    const allRows = await page.locator('.row-head').count();
    expect(allRows).toBeGreaterThan(1);

    // Step 2: type "payment" into the service-filter input — only "payments-api"
    // matches, so the visible row count drops to 1.
    const filterInput = page.locator('input[aria-label="Filter services by name"]');
    await filterInput.fill('payment');
    await page.waitForTimeout(300);

    const filteredCount = await page.locator('.row-head').count();
    expect(filteredCount).toBe(1);

    // Step 3: save a preset while "payment" is the active filter.
    await openPresetsPopover(page);
    await page.locator('[data-testid="presets-save-btn"]').click();
    await page.locator('[data-testid="presets-name-input"]').fill('Payment filter');
    await page.locator('[data-testid="presets-save-confirm-btn"]').click();
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 5_000 });

    // Step 4: clear the filter — all rows return.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);
    await filterInput.fill('');
    await page.waitForTimeout(300);
    const restoredCount = await page.locator('.row-head').count();
    expect(restoredCount).toBe(allRows);

    // Step 5: apply the "Payment filter" preset.
    await openPresetsPopover(page);
    await page.locator('[data-testid="preset-apply-btn"]').first().click();

    // Close the popover so the matrix is fully visible.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);

    // Step 6: assert the matrix rows have shrunk back to the filtered subset.
    await page.waitForTimeout(300);
    const afterApply = await page.locator('.row-head').count();
    expect(afterApply).toBeLessThan(allRows);
    expect(afterApply).toBe(1);

    // Step 7: confirm the filter input itself reflects the restored value.
    await expect(filterInput).toHaveValue('payment');
  });
});

// ---------------------------------------------------------------------------
// K) Reset all settings restores defaults
// ---------------------------------------------------------------------------

test.describe('Reset all settings', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('K) accepting the reset confirm clears the service filter and failOnly toggle', async ({
    page,
  }) => {
    // Arrange: set a text filter so the matrix shows a subset of rows.
    await page.waitForSelector('.row-head', { timeout: 15_000 });
    const allRows = await page.locator('.row-head').count();

    const filterInput = page.locator('input[aria-label="Filter services by name"]');
    await filterInput.fill('payment');
    await page.waitForTimeout(300);
    expect(await page.locator('.row-head').count()).toBeLessThan(allRows);

    // Also turn on failures-only so we can verify it resets too.
    await page.locator('label.hdr-fail-toggle').click();
    await page.waitForTimeout(200);

    // Act: open presets popover, accept the reset confirm.
    await openPresetsPopover(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="presets-reset-all-btn"]').click();

    // Close the popover.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);

    // Assert: matrix shows all rows again (filter cleared).
    await page.waitForTimeout(400);
    const afterReset = await page.locator('.row-head').count();
    expect(afterReset).toBe(allRows);

    // Assert: the filter input is empty.
    await expect(filterInput).toHaveValue('');

    // Assert: failOnly is off — the toggle must not carry the is-on class.
    const failToggle = page.locator('label.hdr-fail-toggle');
    await expect(failToggle).not.toHaveClass(/is-on/);
  });

  test('K) dismissing the reset confirm leaves settings unchanged', async ({
    page,
  }) => {
    // Arrange: set a text filter.
    await page.waitForSelector('.row-head', { timeout: 15_000 });
    const filterInput = page.locator('input[aria-label="Filter services by name"]');
    await filterInput.fill('auth');
    await page.waitForTimeout(300);
    const filteredCount = await page.locator('.row-head').count();

    // Act: dismiss the reset confirm.
    await openPresetsPopover(page);
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.locator('[data-testid="presets-reset-all-btn"]').click();

    // Close the popover.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);

    // Assert: filter remains — same row count.
    await page.waitForTimeout(300);
    const afterDismiss = await page.locator('.row-head').count();
    expect(afterDismiss).toBe(filteredCount);

    // Assert: filter input still has the value.
    await expect(filterInput).toHaveValue('auth');
  });
});

// ---------------------------------------------------------------------------
// L) Active preset indicator — last-applied badge, persistence, and clearing
// ---------------------------------------------------------------------------

/** localStorage key used by PresetsService to track the active preset name. */
const ACTIVE_STORAGE_KEY = 'dd:presetActive';

test.describe('Active preset indicator', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    // Seed two presets so we can verify only one shows the badge.
    await seedPreset(page, 'Alpha preset');
    await seedPreset(page, 'Beta preset');
  });

  test('L) applying a preset shows the Active badge on its row and not the other', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    // The list is ordered: Alpha first, Beta second (insertion order).
    const rows = page.locator('[data-testid="preset-item"]');
    await expect(rows).toHaveCount(2, { timeout: 5_000 });

    // Apply the first preset (Alpha).
    await page.locator('[data-testid="preset-apply-btn"]').first().click();

    // Alpha row must show the badge; Beta row must not.
    const alphaBadge = rows.nth(0).locator('[data-testid="preset-active-badge"]');
    const betaBadge  = rows.nth(1).locator('[data-testid="preset-active-badge"]');
    await expect(alphaBadge).toBeVisible({ timeout: 5_000 });
    await expect(betaBadge).toHaveCount(0);
  });

  test('L) the Active badge persists after a page reload', async ({ page }) => {
    await openPresetsPopover(page);

    // Apply the first preset (Alpha).
    await page.locator('[data-testid="preset-apply-btn"]').first().click();

    // Confirm the badge is visible before reloading.
    const rows = page.locator('[data-testid="preset-item"]');
    await expect(rows.nth(0).locator('[data-testid="preset-active-badge"]')).toBeVisible({ timeout: 5_000 });

    // Close the popover and reload the page.
    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(600);

    // Re-open the popover and verify the badge is still on Alpha.
    await openPresetsPopover(page);
    const rowsAfterReload = page.locator('[data-testid="preset-item"]');
    await expect(rowsAfterReload).toHaveCount(2, { timeout: 5_000 });
    await expect(rowsAfterReload.nth(0).locator('[data-testid="preset-active-badge"]')).toBeVisible();
    await expect(rowsAfterReload.nth(1).locator('[data-testid="preset-active-badge"]')).toHaveCount(0);

    // dd:presetActive in localStorage must still hold the applied name.
    const stored = await page.evaluate((key: string) => localStorage.getItem(key), ACTIVE_STORAGE_KEY);
    expect(stored).toBe('Alpha preset');
  });

  test('L) Reset all settings clears the Active badge', async ({ page }) => {
    await openPresetsPopover(page);

    // Apply the first preset so a badge appears.
    await page.locator('[data-testid="preset-apply-btn"]').first().click();
    const rows = page.locator('[data-testid="preset-item"]');
    await expect(rows.nth(0).locator('[data-testid="preset-active-badge"]')).toBeVisible({ timeout: 5_000 });

    // Accept the reset confirm.
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="presets-reset-all-btn"]').click();

    // No row should show the Active badge after reset.
    await expect(page.locator('[data-testid="preset-active-badge"]')).toHaveCount(0, { timeout: 5_000 });

    // dd:presetActive must be absent from localStorage.
    const stored = await page.evaluate((key: string) => localStorage.getItem(key), ACTIVE_STORAGE_KEY);
    expect(stored).toBeNull();
  });

  test('L) deleting the active preset clears the Active badge', async ({ page }) => {
    await openPresetsPopover(page);

    // Apply the first preset (Alpha).
    await page.locator('[data-testid="preset-apply-btn"]').first().click();
    const rows = page.locator('[data-testid="preset-item"]');
    await expect(rows.nth(0).locator('[data-testid="preset-active-badge"]')).toBeVisible({ timeout: 5_000 });

    // Accept the delete confirm for Alpha (first row).
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="preset-delete-btn"]').first().click();

    // Alpha is gone; only Beta remains, and it must not show the badge.
    await expect(page.locator('[data-testid="preset-item"]')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('[data-testid="preset-active-badge"]')).toHaveCount(0);

    // dd:presetActive must be absent from localStorage.
    const stored = await page.evaluate((key: string) => localStorage.getItem(key), ACTIVE_STORAGE_KEY);
    expect(stored).toBeNull();
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

// ---------------------------------------------------------------------------
// M) Import from URL
//
// Uses page.route() to stub the external HTTPS fetch — this is the true
// network boundary; it is NOT mocking application code.
//
// M1 — SINGLE: route returns a valid single-preset JSON → one new row + success msg.
// M2 — BUNDLE: route returns {version:1,presets:[A,B]} with name A colliding
//              with an existing preset → both imported; A gets dedup suffix ' (2)'.
// M3 — FAILURE (404): route fulfills with status 404 → inline error, no preset added.
// M4 — FAILURE (CORS/network abort): route aborts → inline error, no preset added.
// ---------------------------------------------------------------------------

/** Stable fake HTTPS URL intercepted by page.route() in every test below. */
const FAKE_URL = 'https://raw.example.com/presets/test.json';

test.describe('M) Import from URL', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  // ── M1: single-preset import ──────────────────────────────────────────────

  test('M1) single-preset URL imports one new preset and shows success message', async ({
    page,
  }) => {
    // Stub the fetch before any browser request can fire.
    await page.route(FAKE_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          name: 'URL Preset Alpha',
          settings: { theme: 'dark', view: 'matrix' },
        }),
      }),
    );

    await openPresetsPopover(page);

    // Type the URL and click Import URL.
    await page.locator('[data-testid="presets-import-url-input"]').fill(FAKE_URL);
    await page.locator('[data-testid="presets-import-url-btn"]').click();

    // Wait for the import to complete: exactly one preset row must appear.
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(1, { timeout: 10_000 });
    const names = await listedPresetNames(page);
    expect(names).toContain('URL Preset Alpha');

    // Success message must be shown.
    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Imported 1 preset');

    // URL input must be cleared after a successful import.
    await expect(page.locator('[data-testid="presets-import-url-input"]')).toHaveValue('');

    // Verify the preset landed in localStorage.
    const stored = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ name: string }>) : [];
    }, STORAGE_KEY);
    expect(stored.map((e) => e.name)).toContain('URL Preset Alpha');
  });

  // ── M2: bundle import with name dedup ─────────────────────────────────────

  test('M2) bundle URL imports all presets; colliding name gets dedup suffix', async ({
    page,
  }) => {
    // Seed an existing preset named "Bundle A" so we can verify the dedup.
    await seedPreset(page, 'Bundle A');

    // Stub the fetch to return a two-entry bundle.
    await page.route(FAKE_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          presets: [
            { name: 'Bundle A', settings: { theme: 'dark', view: 'matrix' } },
            { name: 'Bundle B', settings: { theme: 'light', view: 'swimlanes' } },
          ],
        }),
      }),
    );

    await openPresetsPopover(page);

    // Trigger the import.
    await page.locator('[data-testid="presets-import-url-input"]').fill(FAKE_URL);
    await page.locator('[data-testid="presets-import-url-btn"]').click();

    // 1 (seeded) + 2 (bundle) = 3 total preset rows.
    await expect(page.locator('.presets-list .presets-name')).toHaveCount(3, { timeout: 10_000 });
    const names = await listedPresetNames(page);

    // Original pre-existing preset is unchanged.
    expect(names).toContain('Bundle A');
    // Duplicate name gets the (2) suffix.
    expect(names).toContain('Bundle A (2)');
    // Non-colliding bundle entry is imported verbatim.
    expect(names).toContain('Bundle B');

    // Success message confirms 2 presets imported.
    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Imported 2 presets');
  });

  // ── M3: 404 → inline error, no preset written ─────────────────────────────

  test('M3) 404 response shows an inline error and writes no preset', async ({
    page,
  }) => {
    // Record how many presets exist before the attempt (zero after clean).
    const countBefore = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    }, STORAGE_KEY);

    // Stub the fetch to return 404.
    await page.route(FAKE_URL, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found',
      }),
    );

    await openPresetsPopover(page);

    await page.locator('[data-testid="presets-import-url-input"]').fill(FAKE_URL);
    await page.locator('[data-testid="presets-import-url-btn"]').click();

    // An error message must appear.
    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible({ timeout: 10_000 });
    // The service returns "HTTP 404 — …" for non-ok responses.
    await expect(msg).toContainText('404');

    // No new preset must have been written.
    const countAfter = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    }, STORAGE_KEY);
    expect(countAfter).toBe(countBefore);

    // Preset list must still be absent (clean state had none).
    await expect(page.locator('.presets-list')).toHaveCount(0);
  });

  // ── M4: network abort (CORS / unreachable) → inline error, no preset ──────

  test('M4) network abort shows an inline error and writes no preset', async ({
    page,
  }) => {
    // Record baseline preset count (zero after clean).
    const countBefore = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    }, STORAGE_KEY);

    // Abort the request to simulate a CORS / DNS / network failure.
    await page.route(FAKE_URL, (route) => route.abort('failed'));

    await openPresetsPopover(page);

    await page.locator('[data-testid="presets-import-url-input"]').fill(FAKE_URL);
    await page.locator('[data-testid="presets-import-url-btn"]').click();

    // The service catches fetch() throwing and returns a network-error string.
    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible({ timeout: 10_000 });
    // Error message must mention URL reachability / CORS.
    await expect(msg).toContainText('Could not reach that URL');

    // No new preset must have been written.
    const countAfter = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    }, STORAGE_KEY);
    expect(countAfter).toBe(countBefore);
  });
});
