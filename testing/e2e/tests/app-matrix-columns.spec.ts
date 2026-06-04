/**
 * Live-app E2E — Matrix environment-column controls.
 *
 * Runs against the Angular SPA at http://localhost:4200 (proxied to the
 * NestJS mock on :3000). Mock data has 5 environments: dev, staging, qa,
 * preprod, prod — confirmed from demo/data/events.json + store.ts ENV_ORDER.
 *
 * localStorage keys (from AppStateService):
 *   dd:colOrder   — JSON array of env names (persisted column order)
 *   dd:colHidden  — comma-separated hidden env names
 *
 * Fresh-session drag-reorder (fixed):
 *   AppStateService now has an effect() in its constructor that watches
 *   matrixData() and calls syncColOrder(matrix.environments) whenever matrix
 *   data loads or a new environment appears via SSE. This seeds dd:colOrder
 *   from the live environment list on every first load, so reorderColumn()
 *   always finds valid indices — even on a user's very first visit.
 *   The drag tests start from a CLEAN localStorage (no dd:colOrder, no
 *   dd:colHidden) to prove this fix works without any test-side workaround.
 *
 * Native HTML5 DnD emulation:
 *   Playwright's locator.dragTo() is unreliable for native HTML5 drag events
 *   in Chromium. The robust approach dispatches real DragEvents via
 *   page.evaluate(): dragstart on source → dragover + drop on target →
 *   dragend on source. The Angular component reads the dragged env from its
 *   signal (set in onDragStart) rather than dataTransfer, so firing the events
 *   on the correct DOM elements drives the reorder.
 *
 * localStorage setup pattern:
 *   page.evaluate() to clear/write storage + page.reload() to let Angular
 *   read the new state on startup. This avoids addInitScript (which fires on
 *   every navigation including reloads) and correctly isolates setup from the
 *   reload-persistence assertion in persistence tests.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the matrix view, wipe all column-control localStorage keys to
 * simulate a clean first-time visit, then reload so Angular's AppStateService
 * reads the blank slate in its constructors/effects.
 *
 * Keys cleared: dd:colOrder, dd:colHidden, dd:matFields.
 *
 * The two-step (goto → evaluate → reload) avoids addInitScript, which would
 * fire again on subsequent reloads inside the same test and corrupt persistence
 * assertions.
 */
async function openMatrix(page: Page): Promise<void> {
  // First navigation — just need a page context to evaluate against.
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });

  // Wipe all column-control state for a genuinely clean session.
  await page.evaluate(() => {
    localStorage.removeItem('dd:colOrder');
    localStorage.removeItem('dd:colHidden');
    localStorage.removeItem('dd:matFields');
  });

  // Reload so Angular reads the blank localStorage in its signal initialisers
  // and the seeding effect fires after the matrix HTTP response arrives.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
  // Brief settle for Angular change-detection / effect scheduling.
  await page.waitForTimeout(300);
}

/** Return the ordered list of visible environment header texts. */
async function headerOrder(page: Page): Promise<string[]> {
  return page.locator('.col-draggable .env-tag').allTextContents();
}

/**
 * Dispatch native HTML5 DnD events to reorder a column.
 *
 * Uses page.evaluate() to fire real DragEvent instances on the source and
 * target header elements. Angular's (dragstart) handler sets a signal with
 * the dragged env name; (drop) reads it and calls reorderColumn().
 *
 * Sequence: dragstart(src) → dragover(tgt) → drop(tgt) → dragend(src)
 */
async function dragEnvHeader(page: Page, fromEnv: string, toEnv: string): Promise<void> {
  await page.evaluate(
    ({ from, to }: { from: string; to: string }) => {
      const headers = Array.from(document.querySelectorAll<HTMLElement>('.col-draggable'));
      const srcEl = headers.find(
        (h) => h.querySelector('.env-tag')?.textContent?.trim() === from,
      );
      const tgtEl = headers.find(
        (h) => h.querySelector('.env-tag')?.textContent?.trim() === to,
      );
      if (!srcEl || !tgtEl) {
        throw new Error(`dragEnvHeader: could not find headers for "${from}" or "${to}"`);
      }

      const dt = new DataTransfer();

      srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      tgtEl.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
      tgtEl.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
      srcEl.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { from: fromEnv, to: toEnv },
  );
  // Allow Angular signal → DOM update to propagate.
  await page.waitForTimeout(300);
}

/** Open the Columns popover via the ⊞ button in the topbar. */
async function openColumnsPopover(page: Page): Promise<void> {
  await page.locator('button[aria-label*="Columns"]').click();
  await page.waitForSelector('.picker-content', { timeout: 5_000 });
  await page.waitForTimeout(200);
}

/**
 * Click a Columns-popover field-toggle that exactly matches the given env name.
 * Uses a regexp anchor to prevent "prod" matching "preprod".
 */
async function clickEnvToggle(page: Page, envName: string): Promise<void> {
  await page
    .locator('.picker-content .field-toggle')
    .filter({ has: page.locator('.field-label', { hasText: new RegExp(`^${envName}$`) }) })
    .click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Live app — Matrix environment-column controls', () => {

  // ── 1. Drag-reorder ───────────────────────────────────────────────────────

  test('drag-reorder: dragging one env header onto another changes the header order', async ({ page }) => {
    // Clean session — no dd:colOrder pre-seeded. The app's seeding effect
    // must populate colOrder after the matrix loads for this to work.
    await openMatrix(page);

    const before = await headerOrder(page);
    expect(before.length, 'mock must serve ≥2 environments').toBeGreaterThanOrEqual(2);

    // Drag "dev" (first) onto "staging" (second).
    await dragEnvHeader(page, 'dev', 'staging');

    const after = await headerOrder(page);
    expect(
      after,
      `Header order did not change after dragging "dev" onto "staging". ` +
      `Before: [${before.join(', ')}]. After: [${after.join(', ')}]. ` +
      'The seeding effect may not have populated dd:colOrder before the drag, ' +
      'or reorderColumn() still exited early.',
    ).not.toEqual(before);

    // After move-from-0-to-1: expected [staging, dev, qa, preprod, prod].
    const stagingIdx = after.indexOf('staging');
    const devIdx     = after.indexOf('dev');
    expect(stagingIdx, '"staging" should precede "dev" after the drag').toBeLessThan(devIdx);
  });

  test('drag-reorder: reordered column persists across page reload (dd:colOrder)', async ({ page }) => {
    // Clean session — seeding effect must populate colOrder after matrix load.
    await openMatrix(page);

    const before = await headerOrder(page);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await dragEnvHeader(page, 'dev', 'staging');
    const afterDrag = await headerOrder(page);
    expect(afterDrag).not.toEqual(before);

    // Reload — Angular reads the dd:colOrder that was written by the drag.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(300);

    const afterReload = await headerOrder(page);
    expect(
      afterReload,
      `Column order was not persisted. After drag: [${afterDrag.join(', ')}], ` +
      `after reload: [${afterReload.join(', ')}].`,
    ).toEqual(afterDrag);
  });

  // ── 2. Show/hide ──────────────────────────────────────────────────────────

  test('show/hide: unchecking an env in the Columns popover removes its header and body cells', async ({ page }) => {
    await openMatrix(page);

    const envs = await headerOrder(page);
    expect(envs.length, 'mock must serve ≥2 environments to allow hiding one').toBeGreaterThanOrEqual(2);

    // Hide "prod" — exact regex prevents matching "preprod".
    await openColumnsPopover(page);
    await clickEnvToggle(page, 'prod');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // The env-tag header for "prod" must be gone.
    const remainingHeaders = await headerOrder(page);
    expect(
      remainingHeaders,
      `"prod" header still present after hiding it. Headers: [${remainingHeaders.join(', ')}]`,
    ).not.toContain('prod');

    // No .env-tag text anywhere in the page should be "prod" (column cells removed).
    const allEnvTags = await page.locator('.env-tag').allTextContents();
    expect(
      allEnvTags.every((t) => t.trim() !== 'prod'),
      `Found .env-tag with text "prod" after hiding it. Tags: [${allEnvTags.join(', ')}]`,
    ).toBe(true);
  });

  test('show/hide: "Show all · reset order" restores hidden environments', async ({ page }) => {
    await openMatrix(page);

    // Hide "prod".
    await openColumnsPopover(page);
    await clickEnvToggle(page, 'prod');
    await page.waitForTimeout(200);

    // Verify hidden.
    const afterHide = await page.locator('.col-draggable .env-tag').allTextContents();
    expect(afterHide).not.toContain('prod');

    // Click "Show all · reset order" (popover still open).
    await page.locator('button.cols-reset-btn').click();
    await page.waitForTimeout(300);

    // All envs including "prod" must be back.
    const afterReset = await headerOrder(page);
    expect(
      afterReset,
      `"Show all · reset order" did not restore "prod". Headers: [${afterReset.join(', ')}]`,
    ).toContain('prod');
  });

  test('show/hide: hidden state persists across page reload (dd:colHidden)', async ({ page }) => {
    await openMatrix(page);

    // Hide "prod".
    await openColumnsPopover(page);
    await clickEnvToggle(page, 'prod');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Confirm hidden.
    const afterHide = await headerOrder(page);
    expect(afterHide).not.toContain('prod');

    // Reload — Angular reads dd:colHidden written by the toggle above.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(300);

    const afterReload = await headerOrder(page);
    expect(
      afterReload,
      `Hidden state was not persisted across reload. "prod" reappeared.`,
    ).not.toContain('prod');
  });

  // ── 3. Hidden-count badge ─────────────────────────────────────────────────

  test('badge: Columns button shows is-active and a count badge after hiding envs', async ({ page }) => {
    await openMatrix(page);

    // Hide "preprod" and "prod" (exact matches — avoids "prod" matching "preprod").
    await openColumnsPopover(page);
    await clickEnvToggle(page, 'preprod');
    await clickEnvToggle(page, 'prod');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const columnsBtn = page.locator('button[aria-label*="Columns"]');

    // Button must carry is-active.
    await expect(columnsBtn).toHaveClass(/is-active/);

    // Badge must be visible with count 2.
    const badge = columnsBtn.locator('.hidden-count-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('2');
  });

  test('badge: Columns button badge clears after "Show all · reset order"', async ({ page }) => {
    await openMatrix(page);

    // Hide one env.
    await openColumnsPopover(page);
    await clickEnvToggle(page, 'prod');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const columnsBtn = page.locator('button[aria-label*="Columns"]');
    await expect(columnsBtn.locator('.hidden-count-badge')).toBeVisible();

    // Reset.
    await openColumnsPopover(page);
    await page.locator('button.cols-reset-btn').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Badge must be gone (Angular @if removes it when count is 0).
    await expect(columnsBtn.locator('.hidden-count-badge')).toHaveCount(0);
  });

  // ── 4. Fields badge parity ────────────────────────────────────────────────

  test('fields badge: hiding a field shows badge on Fields button', async ({ page }) => {
    await openMatrix(page);

    const fieldsBtn = page.locator('button[aria-label*="Fields"]');

    // Initially no badge (openMatrix cleared dd:matFields → all fields on).
    await expect(fieldsBtn.locator('.hidden-count-badge')).toHaveCount(0);

    // Open Fields popover and uncheck the first field toggle.
    await fieldsBtn.click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(200);

    await page.locator('.picker-content .field-toggle').first().click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Fields button must show is-active and badge of 1.
    await expect(fieldsBtn).toHaveClass(/is-active/);
    const badge = fieldsBtn.locator('.hidden-count-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');
  });

});
