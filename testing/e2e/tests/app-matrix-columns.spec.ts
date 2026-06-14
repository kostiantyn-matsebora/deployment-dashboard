/**
 * Live-app E2E — Matrix environment-column controls.
 *
 * Runs against the Angular SPA at http://localhost:4200 (proxied to the
 * NestJS mock on :3002). Mock data has 5 environments: dev, staging, qa,
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

// ---------------------------------------------------------------------------
// Inset guard — picker popover content is inset from the panel border
//
// Guards the regression where .picker-content had no padding and toggle pills
// sat flush to the glass-popover 1px border (0 px gap on all sides).
//
// Root cause: the CSS relied on ::ng-deep .glass-popover .p-popover-content,
// targeting a PrimeNG inner element that newer PrimeNG versions no longer
// render. The rule was dead; the fix moves padding to .picker-content directly.
//
// These tests will FAIL if .picker-content padding is removed: gaps drop to 0.
// Threshold is 10 px (well below the 14 px spec, tolerates minor viewport shifts).
// ---------------------------------------------------------------------------

test.describe('Inset guard — picker content is inset from panel border', () => {

  // ── Columns popover ───────────────────────────────────────────────────────

  test('Columns popover: toggle pills are inset ≥10px from the panel border on left and right', async ({ page }) => {
    // Inject long env names to maximise toggle width (worst case for overflow).
    await page.route('**/api/matrix**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          environments: ['release', 'release-gate', 'release-playground'],
          rows: [{
            service: 'demo-service',
            slots: {
              'release':            { current: { id:'1', deployment_id:'d1', service:'demo-service', environment:'release',            status:'success',     happened_at: new Date().toISOString() } },
              'release-gate':       { current: { id:'2', deployment_id:'d2', service:'demo-service', environment:'release-gate',       status:'in-progress', happened_at: new Date().toISOString() } },
              'release-playground': { current: { id:'3', deployment_id:'d3', service:'demo-service', environment:'release-playground', status:'failure',     happened_at: new Date().toISOString() } },
            },
          }],
        }),
      });
    });

    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(400);

    await page.locator('button[aria-label*="Columns"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    const gaps = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.glass-popover');
      const toggles = Array.from(document.querySelectorAll<HTMLElement>('.picker-content .field-toggle'));
      if (!panel || !toggles.length) return null;

      const panelRect = panel.getBoundingClientRect();
      // 1 px border on each side
      const panelInnerL = panelRect.left + 1;
      const panelInnerR = panelRect.right - 1;

      const leftmostX  = Math.min(...toggles.map(t => t.getBoundingClientRect().left));
      const rightmostR = Math.max(...toggles.map(t => t.getBoundingClientRect().right));

      return {
        gapLeft:  leftmostX  - panelInnerL,
        gapRight: panelInnerR - rightmostR,
        panelInnerL,
        panelInnerR,
        leftmostX,
        rightmostR,
      };
    });

    expect(gaps, 'Could not find .glass-popover or .field-toggle elements').not.toBeNull();
    expect(
      gaps!.gapLeft,
      `Columns toggle left gap is ${gaps!.gapLeft.toFixed(1)}px — expected ≥10px inset from panel border. ` +
      `panelInnerL=${gaps!.panelInnerL.toFixed(1)}, leftmostToggle.x=${gaps!.leftmostX.toFixed(1)}. ` +
      'Fix: ensure .picker-content has padding (removing it drops gap to 0).',
    ).toBeGreaterThanOrEqual(10);
    expect(
      gaps!.gapRight,
      `Columns toggle right gap is ${gaps!.gapRight.toFixed(1)}px — expected ≥10px inset from panel border. ` +
      `panelInnerR=${gaps!.panelInnerR.toFixed(1)}, rightmostToggle.right=${gaps!.rightmostR.toFixed(1)}.`,
    ).toBeGreaterThanOrEqual(10);
  });

  test('Columns popover: toggle pills are inset ≥10px from the panel border on top', async ({ page }) => {
    await page.route('**/api/matrix**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          environments: ['release', 'release-gate', 'release-playground'],
          rows: [{
            service: 'demo-service',
            slots: {
              'release':            { current: { id:'1', deployment_id:'d1', service:'demo-service', environment:'release',            status:'success',     happened_at: new Date().toISOString() } },
              'release-gate':       { current: { id:'2', deployment_id:'d2', service:'demo-service', environment:'release-gate',       status:'in-progress', happened_at: new Date().toISOString() } },
              'release-playground': { current: { id:'3', deployment_id:'d3', service:'demo-service', environment:'release-playground', status:'failure',     happened_at: new Date().toISOString() } },
            },
          }],
        }),
      });
    });

    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(400);

    await page.locator('button[aria-label*="Columns"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    const gapTop = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.glass-popover');
      const toggles = Array.from(document.querySelectorAll<HTMLElement>('.picker-content .field-toggle'));
      if (!panel || !toggles.length) return null;
      const panelInnerT = panel.getBoundingClientRect().top + 1;
      const topmostY    = Math.min(...toggles.map(t => t.getBoundingClientRect().top));
      return { gap: topmostY - panelInnerT, panelInnerT, topmostY };
    });

    expect(gapTop, 'Could not find panel or toggles').not.toBeNull();
    expect(
      gapTop!.gap,
      `Columns toggle top gap is ${gapTop!.gap.toFixed(1)}px — expected ≥10px inset. ` +
      '(The .popover-title sits between the panel top and the first toggle, contributing extra gap.)',
    ).toBeGreaterThanOrEqual(10);
  });

  // ── Fields popover (Matrix) ───────────────────────────────────────────────

  test('Fields popover (Matrix): toggle pills are inset ≥10px from the panel border L/R/top', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await page.locator('button[aria-label*="Fields"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    const gaps = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.glass-popover');
      // Fields uses the 2-col grid (no --single modifier)
      const toggles = Array.from(
        document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single) .field-toggle'),
      );
      if (!panel || !toggles.length) return null;

      const panelRect   = panel.getBoundingClientRect();
      const panelInnerL = panelRect.left  + 1;
      const panelInnerR = panelRect.right - 1;
      const panelInnerT = panelRect.top   + 1;

      const rects = toggles.map(t => t.getBoundingClientRect());
      const leftmostX  = Math.min(...rects.map(r => r.left));
      const rightmostR = Math.max(...rects.map(r => r.right));
      const topmostY   = Math.min(...rects.map(r => r.top));

      return {
        gapLeft:  leftmostX - panelInnerL,
        gapRight: panelInnerR - rightmostR,
        gapTop:   topmostY - panelInnerT,
      };
    });

    expect(gaps, 'Could not find .glass-popover or Fields .field-toggle elements').not.toBeNull();
    expect(
      gaps!.gapLeft,
      `Fields toggle left gap is ${gaps!.gapLeft.toFixed(1)}px — expected ≥10px. Fix: ensure .picker-content has padding.`,
    ).toBeGreaterThanOrEqual(10);
    expect(
      gaps!.gapRight,
      `Fields toggle right gap is ${gaps!.gapRight.toFixed(1)}px — expected ≥10px.`,
    ).toBeGreaterThanOrEqual(10);
    expect(
      gaps!.gapTop,
      `Fields toggle top gap is ${gaps!.gapTop.toFixed(1)}px — expected ≥10px.`,
    ).toBeGreaterThanOrEqual(10);
  });

});

// ---------------------------------------------------------------------------
// Overflow regression guard — Columns + Fields popovers
//
// Covers the text-overlapping-border bug class:
//   Root cause #1: .field-toggle had no border in base state; .field-toggle.is-on
//     added `border: 1px solid …` which shrank the content box by 2px, causing
//     text to touch/overlap the pill border.
//   Root cause #2: the Columns picker used `grid-template-columns: 1fr 1fr`,
//     forcing each toggle into half the popover width — long env names overflowed.
//
// Fix verified here:
//   - .field-toggle now reserves `border: 1px solid transparent` in the base;
//     .is-on only changes border-color — box size is constant.
//   - The Columns picker grid uses .field-grid--single (1fr); Fields keeps 2-col.
// ---------------------------------------------------------------------------

test.describe('Overflow guard — toggle pills do not overflow on/off', () => {

  // ── Columns popover: long environment names ───────────────────────────────

  test('Columns popover: long env names fit within their toggle, OFF and ON, no layout jump', async ({ page }) => {
    // Inject a matrix response with long environment names via route interception.
    await page.route('**/api/matrix**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generated_at: new Date().toISOString(),
          environments: ['release-gate', 'release-playground', 'dev', 'prod'],
          rows: [
            {
              service: 'test-svc',
              slots: {
                'release-gate': {
                  current: {
                    id: 'ev-1', deployment_id: 'dep-1',
                    service: 'test-svc', environment: 'release-gate',
                    status: 'success', happened_at: new Date().toISOString(),
                  },
                },
                'release-playground': {
                  current: {
                    id: 'ev-2', deployment_id: 'dep-2',
                    service: 'test-svc', environment: 'release-playground',
                    status: 'success', happened_at: new Date().toISOString(),
                  },
                },
                'dev': {
                  current: {
                    id: 'ev-3', deployment_id: 'dep-3',
                    service: 'test-svc', environment: 'dev',
                    status: 'success', happened_at: new Date().toISOString(),
                  },
                },
                'prod': {
                  current: {
                    id: 'ev-4', deployment_id: 'dep-4',
                    service: 'test-svc', environment: 'prod',
                    status: 'success', happened_at: new Date().toISOString(),
                  },
                },
              },
            },
          ],
        }),
      });
    });

    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(400);

    // Open the Columns popover.
    await page.locator('button[aria-label*="Columns"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    // ── Assert: no overflow in OFF state ─────────────────────────────────
    const offOverflows = await page.evaluate(() => {
      const toggles = Array.from(
        document.querySelectorAll<HTMLElement>('.picker-content .field-grid--single .field-toggle'),
      );
      return toggles
        .filter((t) => {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (!label) return false;
          // scrollWidth > offsetWidth means text is wider than its container.
          return label.scrollWidth > t.clientWidth + 2; // 2px tolerance for sub-pixel rounding
        })
        .map((t) => t.querySelector('.field-label')?.textContent?.trim() ?? '?');
    });
    expect(
      offOverflows,
      `These env labels overflow their toggle (OFF state): [${offOverflows.join(', ')}]`,
    ).toEqual([]);

    // ── Assert: box width is stable when toggling ON ──────────────────────
    // Capture widths in OFF state.
    const widthsBefore = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>('.picker-content .field-grid--single .field-toggle'),
      ).map((t) => ({ env: t.querySelector('.field-label')?.textContent?.trim(), w: t.offsetWidth }));
    });

    // Click the toggle for 'release-gate' to turn it OFF (currently ON = visible).
    await page
      .locator('.picker-content .field-grid--single .field-toggle')
      .filter({ has: page.locator('.field-label', { hasText: /^release-gate$/ }) })
      .click();
    await page.waitForTimeout(200);

    // Capture widths after the ON→OFF transition.
    const widthsAfter = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>('.picker-content .field-grid--single .field-toggle'),
      ).map((t) => ({ env: t.querySelector('.field-label')?.textContent?.trim(), w: t.offsetWidth }));
    });

    for (let i = 0; i < widthsBefore.length; i++) {
      const before = widthsBefore[i];
      const after  = widthsAfter[i];
      expect(
        Math.abs((after?.w ?? 0) - (before?.w ?? 0)),
        `Toggle for "${before?.env}" shifted by ${Math.abs((after?.w ?? 0) - (before?.w ?? 0))}px on ON→OFF (border should be reserved, not added)`,
      ).toBeLessThanOrEqual(1); // 1px sub-pixel tolerance
    }

    // ── Assert: no overflow in ON state either ────────────────────────────
    // Click 'release-playground' ON→OFF to get a mix of ON and OFF.
    await page
      .locator('.picker-content .field-grid--single .field-toggle')
      .filter({ has: page.locator('.field-label', { hasText: /^release-playground$/ }) })
      .click();
    await page.waitForTimeout(200);

    const onOverflows = await page.evaluate(() => {
      const toggles = Array.from(
        document.querySelectorAll<HTMLElement>('.picker-content .field-grid--single .field-toggle'),
      );
      return toggles
        .filter((t) => {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (!label) return false;
          return label.scrollWidth > t.clientWidth + 2;
        })
        .map((t) => t.querySelector('.field-label')?.textContent?.trim() ?? '?');
    });
    expect(
      onOverflows,
      `These env labels overflow their toggle (ON state): [${onOverflows.join(', ')}]`,
    ).toEqual([]);
  });

  // ── Fields popover: matrix view ───────────────────────────────────────────

  test('Fields popover (Matrix): no label overflow off or on, no box jump on toggle', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // Open Fields popover.
    await page.locator('button[aria-label*="Fields"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    // ── OFF state: no overflow ────────────────────────────────────────────
    // Note: we look for the Fields popover's grid, which is .field-grid without
    // the --single modifier.
    const offOverflows = await page.evaluate(() => {
      // There may be multiple .picker-content popovers in DOM; find the open one
      // (visible) that has a .field-grid (Fields picker).
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      const overflowed: string[] = [];
      for (const grid of grids) {
        const toggles = Array.from(grid.querySelectorAll<HTMLElement>('.field-toggle'));
        for (const t of toggles) {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (!label) continue;
          if (label.scrollWidth > t.clientWidth + 2) {
            overflowed.push(label.textContent?.trim() ?? '?');
          }
        }
      }
      return overflowed;
    });
    expect(offOverflows, `Fields labels overflow in OFF state: [${offOverflows.join(', ')}]`).toEqual([]);

    // ── Capture widths before toggling ────────────────────────────────────
    const widthsBefore = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      return grids.flatMap((g) =>
        Array.from(g.querySelectorAll<HTMLElement>('.field-toggle')).map((t) => ({
          label: t.querySelector('.field-label')?.textContent?.trim(),
          w: t.offsetWidth,
        })),
      );
    });

    // Toggle every field OFF (click each toggle).
    const toggles = page.locator('.field-grid:not(.field-grid--single) .field-toggle');
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      await toggles.nth(i).click();
      await page.waitForTimeout(100);
    }

    // ── ON→OFF state: no overflow ─────────────────────────────────────────
    const onOverflows = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      const overflowed: string[] = [];
      for (const grid of grids) {
        const toggles = Array.from(grid.querySelectorAll<HTMLElement>('.field-toggle'));
        for (const t of toggles) {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (!label) continue;
          if (label.scrollWidth > t.clientWidth + 2) {
            overflowed.push(label.textContent?.trim() ?? '?');
          }
        }
      }
      return overflowed;
    });
    expect(onOverflows, `Fields labels overflow after toggling: [${onOverflows.join(', ')}]`).toEqual([]);

    // ── Box width stable on/off ───────────────────────────────────────────
    const widthsAfter = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      return grids.flatMap((g) =>
        Array.from(g.querySelectorAll<HTMLElement>('.field-toggle')).map((t) => ({
          label: t.querySelector('.field-label')?.textContent?.trim(),
          w: t.offsetWidth,
        })),
      );
    });
    for (let i = 0; i < widthsBefore.length; i++) {
      const b = widthsBefore[i], a = widthsAfter[i];
      expect(
        Math.abs((a?.w ?? 0) - (b?.w ?? 0)),
        `Fields toggle "${b?.label}" shifted by ${Math.abs((a?.w ?? 0) - (b?.w ?? 0))}px on toggle (border reservation failed)`,
      ).toBeLessThanOrEqual(1);
    }
  });

  // ── Fields popover: swimlanes view ────────────────────────────────────────

  test('Fields popover (Swimlanes): no label overflow off or on, no box jump on toggle', async ({ page }) => {
    await page.goto('/swimlanes');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // Open Fields popover.
    await page.locator('button[aria-label*="Fields"]').click();
    await page.waitForSelector('.picker-content', { timeout: 5_000 });
    await page.waitForTimeout(300);

    // ── OFF state: no overflow ────────────────────────────────────────────
    const offOverflows = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      const overflowed: string[] = [];
      for (const grid of grids) {
        for (const t of Array.from(grid.querySelectorAll<HTMLElement>('.field-toggle'))) {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (label && label.scrollWidth > t.clientWidth + 2) {
            overflowed.push(label.textContent?.trim() ?? '?');
          }
        }
      }
      return overflowed;
    });
    expect(offOverflows, `Swimlanes Fields labels overflow in OFF state: [${offOverflows.join(', ')}]`).toEqual([]);

    // ── Toggle all OFF → verify ON state + box stability ──────────────────
    const widthsBefore = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      return grids.flatMap((g) =>
        Array.from(g.querySelectorAll<HTMLElement>('.field-toggle')).map((t) => ({
          label: t.querySelector('.field-label')?.textContent?.trim(),
          w: t.offsetWidth,
        })),
      );
    });

    const toggles = page.locator('.field-grid:not(.field-grid--single) .field-toggle');
    const count = await toggles.count();
    for (let i = 0; i < count; i++) {
      await toggles.nth(i).click();
      await page.waitForTimeout(100);
    }

    const widthsAfter = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      return grids.flatMap((g) =>
        Array.from(g.querySelectorAll<HTMLElement>('.field-toggle')).map((t) => ({
          label: t.querySelector('.field-label')?.textContent?.trim(),
          w: t.offsetWidth,
        })),
      );
    });
    for (let i = 0; i < widthsBefore.length; i++) {
      const b = widthsBefore[i], a = widthsAfter[i];
      expect(
        Math.abs((a?.w ?? 0) - (b?.w ?? 0)),
        `Swimlanes Fields toggle "${b?.label}" shifted by ${Math.abs((a?.w ?? 0) - (b?.w ?? 0))}px on toggle`,
      ).toBeLessThanOrEqual(1);
    }

    const onOverflows = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll<HTMLElement>('.field-grid:not(.field-grid--single)'));
      const overflowed: string[] = [];
      for (const grid of grids) {
        for (const t of Array.from(grid.querySelectorAll<HTMLElement>('.field-toggle'))) {
          const label = t.querySelector<HTMLElement>('.field-label');
          if (label && label.scrollWidth > t.clientWidth + 2) {
            overflowed.push(label.textContent?.trim() ?? '?');
          }
        }
      }
      return overflowed;
    });
    expect(onOverflows, `Swimlanes Fields labels overflow after toggling: [${onOverflows.join(', ')}]`).toEqual([]);
  });

});
