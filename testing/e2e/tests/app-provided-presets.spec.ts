/**
 * Live-app E2E — Provided presets (issue #391).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3002).
 *
 * The mock serves GET /api/presets (frontend/mock/src/presets/presets.controller.ts)
 * with a fixed two-source catalog:
 *   - acme/web    → "Frontend defaults"   (dark theme, matrix view, failOnly off)
 *   - acme/infra  → "Ops incident view"   (light theme, matrix view, failOnly on)
 *
 * Reuses the #357 presets popover selectors (presets-btn, .presets-content,
 * .presets-list, preset-active-badge, presets-msg) plus the new #391
 * data-testids: provided-preset-item, provided-preset-apply-btn,
 * provided-preset-clone-btn, provided-preset-source.
 *
 * Assertions:
 *   M) Provided presets render read-only under a "PROVIDED" section with
 *      "provided by {source}" attribution, and expose ONLY Apply + Clone
 *      (no rename/update/delete/export controls).
 *   N) Apply applies a provided preset (live settings change) and shows the
 *      last-applied Active badge on that provided-preset-item.
 *   O) Clone-to-edit creates a LOCAL, editable copy (appears in the local
 *      presets list, renamable/deletable — i.e. carries the full local
 *      preset action set).
 *   P) The Active badge is a single pointer spanning local + provided —
 *      applying a local preset clears a provided preset's badge and
 *      vice versa.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key used by PresetsService for local presets. */
const STORAGE_KEY = 'dd:presets';

/** localStorage key used by PresetsService to track the active preset name. */
const ACTIVE_STORAGE_KEY = 'dd:presetActive';

/** Fixture served by the mock's GET /api/presets (kept in sync manually). */
const PROVIDED = {
  web:   { source: 'acme/web',   name: 'Frontend defaults' },
  infra: { source: 'acme/infra', name: 'Ops incident view' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the matrix view and wipe all preset + app-state localStorage
 * keys so each test starts from a clean slate. Mirrors app-presets.spec.ts.
 */
async function openMatrixClean(page: Page): Promise<void> {
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });

  await page.evaluate((key: string) => {
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
 * Seed a LOCAL preset directly in localStorage then reload so the Angular
 * signal is populated from storage. Mirrors app-presets.spec.ts.
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
 * Open the presets popover by clicking the presets button. Waits for the
 * PRESETS heading inside the popover to become visible, then — since
 * opening the popover triggers loadProvidedPresets() — waits for the
 * PROVIDED section to render so provided-preset assertions don't race the
 * GET /api/presets round trip.
 */
async function openPresetsPopover(page: Page): Promise<void> {
  await page.locator('[data-testid="presets-btn"]').click();
  await page.waitForSelector('.presets-content', { timeout: 10_000 });
  await expect(page.locator('[data-testid="provided-preset-item"]')).toHaveCount(2, {
    timeout: 10_000,
  });
}

/** Return the local preset names currently listed in the open popover. */
async function listedLocalPresetNames(page: Page): Promise<string[]> {
  const names = await page
    .locator('[data-testid="preset-item"] .presets-name')
    .allTextContents();
  return names.map((n) => n.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// M) Read-only rendering + attribution + restricted action set
// ---------------------------------------------------------------------------

test.describe('Provided presets — read-only rendering', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('M) provided presets render under PROVIDED with "provided by {source}" attribution', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const providedTitle = page.locator('.presets-content .popover-title', { hasText: 'PROVIDED' });
    await expect(providedTitle).toBeVisible();

    const items = page.locator('[data-testid="provided-preset-item"]');
    await expect(items).toHaveCount(2);

    const sources = await page.locator('[data-testid="provided-preset-source"]').allTextContents();
    expect(sources.map((s) => s.trim())).toEqual([
      `provided by ${PROVIDED.web.source}`,
      `provided by ${PROVIDED.infra.source}`,
    ]);

    const names = await items.locator('.presets-name').allTextContents();
    expect(names.map((n) => n.trim())).toEqual([PROVIDED.web.name, PROVIDED.infra.name]);
  });

  test('M) a provided-preset row exposes ONLY Apply + Clone — no rename/update/delete/export', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const first = page.locator('[data-testid="provided-preset-item"]').first();
    await expect(first.locator('[data-testid="provided-preset-apply-btn"]')).toBeVisible();
    await expect(first.locator('[data-testid="provided-preset-clone-btn"]')).toBeVisible();

    await expect(first.locator('[data-testid="preset-rename-btn"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="preset-update-btn"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="preset-delete-btn"]')).toHaveCount(0);
    await expect(first.locator('[data-testid="preset-export-btn"]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// N) Apply a provided preset
// ---------------------------------------------------------------------------

test.describe('Provided presets — Apply', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('N) Apply on a provided preset shows a confirmation message naming it', async ({ page }) => {
    await openPresetsPopover(page);

    const first = page.locator('[data-testid="provided-preset-item"]').first();
    await first.locator('[data-testid="provided-preset-apply-btn"]').click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Applied');
    await expect(msg).toContainText(PROVIDED.web.name);
  });

  test('N) Apply on a provided preset shows the Active badge on that row only', async ({ page }) => {
    await openPresetsPopover(page);

    const items = page.locator('[data-testid="provided-preset-item"]');
    await items.first().locator('[data-testid="provided-preset-apply-btn"]').click();

    await expect(items.nth(0).locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(items.nth(1).locator('[data-testid="preset-active-badge"]')).toHaveCount(0);

    // Persisted under the same active-preset pointer used by local presets.
    const stored = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      ACTIVE_STORAGE_KEY,
    );
    expect(stored).toBe(PROVIDED.web.name);
  });

  test('N) Apply on a provided preset changes live settings (theme switches to the preset\'s theme)', async ({
    page,
  }) => {
    // acme/infra ("Ops incident view") carries theme: 'light'. Start from the
    // default dark theme so the switch is observable.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');

    await openPresetsPopover(page);
    const infraRow = page.locator('[data-testid="provided-preset-item"]').nth(1);
    await infraRow.locator('[data-testid="provided-preset-apply-btn"]').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const theme = await page.evaluate(() => localStorage.getItem('theme'));
    expect(theme).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// O) Clone-to-edit a provided preset
// ---------------------------------------------------------------------------

test.describe('Provided presets — Clone-to-edit', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
  });

  test('O) Clone-to-edit shows a confirmation message and creates a LOCAL copy with " (copy)" suffix', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const first = page.locator('[data-testid="provided-preset-item"]').first();
    await first.locator('[data-testid="provided-preset-clone-btn"]').click();

    const msg = page.locator('.presets-msg');
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('Cloned');
    await expect(msg).toContainText(PROVIDED.web.name);

    // The clone must appear in the LOCAL presets list (preset-item, not
    // provided-preset-item), named "<original> (copy)".
    await expect(page.locator('[data-testid="preset-item"]')).toHaveCount(1, { timeout: 5_000 });
    const localNames = await listedLocalPresetNames(page);
    expect(localNames).toContain(`${PROVIDED.web.name} (copy)`);

    // Provided list itself is untouched — still exactly 2 read-only items.
    await expect(page.locator('[data-testid="provided-preset-item"]')).toHaveCount(2);
  });

  test('O) the cloned copy is a fully editable local preset (rename/update/delete/export present)', async ({
    page,
  }) => {
    await openPresetsPopover(page);
    const first = page.locator('[data-testid="provided-preset-item"]').first();
    await first.locator('[data-testid="provided-preset-clone-btn"]').click();
    await expect(page.locator('[data-testid="preset-item"]')).toHaveCount(1, { timeout: 5_000 });

    const clonedRow = page.locator('[data-testid="preset-item"]');
    await expect(clonedRow.locator('[data-testid="preset-apply-btn"]')).toBeVisible();
    await expect(clonedRow.locator('[data-testid="preset-clone-btn"]')).toBeVisible();
    await expect(clonedRow.locator('[data-testid="preset-rename-btn"]')).toBeVisible();
    await expect(clonedRow.locator('[data-testid="preset-update-btn"]')).toBeVisible();
    await expect(clonedRow.locator('[data-testid="preset-delete-btn"]')).toBeVisible();
    await expect(clonedRow.locator('[data-testid="preset-export-btn"]')).toBeVisible();

    // It is persisted to the local store, unlike the source provided preset.
    const stored = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<{ name: string }>) : [];
    }, STORAGE_KEY);
    expect(stored.map((p) => p.name)).toContain(`${PROVIDED.web.name} (copy)`);
  });
});

// ---------------------------------------------------------------------------
// P) Active badge spans local + provided presets
// ---------------------------------------------------------------------------

test.describe('Provided presets — Active badge spans local + provided', () => {
  test.beforeEach(async ({ page }) => {
    await openMatrixClean(page);
    await seedPreset(page, 'My local view');
  });

  test('P) applying a local preset then a provided preset moves the badge across lists', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    // Step 1: apply the local preset — badge shows on the local row.
    const localRow = page.locator('[data-testid="preset-item"]').first();
    await localRow.locator('[data-testid="preset-apply-btn"]').click();
    await expect(localRow.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });

    // No provided row shows the badge yet.
    await expect(page.locator('[data-testid="provided-preset-item"] [data-testid="preset-active-badge"]')).toHaveCount(0);

    // Step 2: apply a provided preset — badge moves off the local row onto
    // the provided row, using the SAME activePresetName pointer.
    const providedRow = page.locator('[data-testid="provided-preset-item"]').first();
    await providedRow.locator('[data-testid="provided-preset-apply-btn"]').click();

    await expect(providedRow.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(localRow.locator('[data-testid="preset-active-badge"]')).toHaveCount(0);

    const stored = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      ACTIVE_STORAGE_KEY,
    );
    expect(stored).toBe(PROVIDED.web.name);
  });

  test('P) applying a provided preset then a local preset moves the badge back', async ({ page }) => {
    await openPresetsPopover(page);

    // Step 1: apply the provided preset first.
    const providedRow = page.locator('[data-testid="provided-preset-item"]').first();
    await providedRow.locator('[data-testid="provided-preset-apply-btn"]').click();
    await expect(providedRow.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });

    // Step 2: apply the local preset — badge moves back to the local row.
    const localRow = page.locator('[data-testid="preset-item"]').first();
    await localRow.locator('[data-testid="preset-apply-btn"]').click();

    await expect(localRow.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(providedRow.locator('[data-testid="preset-active-badge"]')).toHaveCount(0);

    const stored = await page.evaluate(
      (key: string) => localStorage.getItem(key),
      ACTIVE_STORAGE_KEY,
    );
    expect(stored).toBe('My local view');
  });

  test('P) the Active badge persists after reload regardless of which list it belongs to', async ({
    page,
  }) => {
    await openPresetsPopover(page);

    const providedRow = page.locator('[data-testid="provided-preset-item"]').first();
    await providedRow.locator('[data-testid="provided-preset-apply-btn"]').click();
    await expect(providedRow.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });

    await page.keyboard.press('Escape');
    await expect(page.locator('.presets-content')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(600);

    await openPresetsPopover(page);
    const providedRowAfterReload = page.locator('[data-testid="provided-preset-item"]').first();
    await expect(providedRowAfterReload.locator('[data-testid="preset-active-badge"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="preset-item"] [data-testid="preset-active-badge"]')).toHaveCount(0);
  });
});
