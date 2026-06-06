/**
 * Live-app E2E — Never-deployed slot rendering (issue #268).
 *
 * Runs against the Angular SPA at http://localhost:4200 backed by the NestJS
 * mock on :3000. The mock data includes a never-deployed slot at
 * platform-proxy|qa (status: waiting, no effective baseline, no slot.next).
 *
 * Asserts:
 *   - Matrix tile: neutral/grey surface (s-never-deployed class), no spinner,
 *     status chip with correct status class and text.
 *   - Swimlane card: neutral/grey (s-never-deployed class), status chip.
 *   - Effective tile (e.g. auth-bff|dev, s-success): unchanged, no s-never-deployed.
 *   - Empty slot ("—" placeholder): unchanged — the two concepts are distinct.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the matrix view and wait for data to load. */
async function openMatrix(page: Page): Promise<void> {
  await page.goto('/matrix', { waitUntil: 'domcontentloaded' });
  // Wait for at least one tile to appear — the matrix re-renders when data arrives.
  await page.waitForSelector('.slot', { timeout: 20_000 });
  // Allow SSE-driven re-renders to stabilise.
  await page.waitForTimeout(1000);
}

/** Navigate to the swimlanes view and wait for cards to render. */
async function openSwimlanes(page: Page): Promise<void> {
  await page.goto('/swimlanes', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vis-card', { timeout: 30_000 });
  await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------
// Matrix tile — never-deployed
// ---------------------------------------------------------------------------

test.describe('Matrix tile — never-deployed slot (platform-proxy|qa)', () => {
  test('slot carries s-never-deployed class', async ({ page }) => {
    await openMatrix(page);
    const slot = page.locator('.slot.s-never-deployed').first();
    await expect(slot).toBeVisible();
  });

  test('exactly one never-deployed slot exists in matrix', async ({ page }) => {
    await openMatrix(page);
    await expect(page.locator('.slot.s-never-deployed')).toHaveCount(1);
  });

  test('slot does NOT carry any effective state class', async ({ page }) => {
    await openMatrix(page);
    const slot = page.locator('.slot.s-never-deployed').first();
    await expect(slot).not.toHaveClass(/s-success/);
    await expect(slot).not.toHaveClass(/s-running-only/);
    await expect(slot).not.toHaveClass(/s-fail-last/);
    await expect(slot).not.toHaveClass(/s-run-last/);
  });

  test('slot has NO spinner', async ({ page }) => {
    await openMatrix(page);
    const slot = page.locator('.slot.s-never-deployed').first();
    await expect(slot.locator('.spinner')).toHaveCount(0);
  });

  test('slot has a status chip with correct class (waiting)', async ({ page }) => {
    await openMatrix(page);
    const chip = page.locator('.slot.s-never-deployed .ctx-badge.cb-waiting');
    await expect(chip).toBeVisible();
  });

  test('status chip text contains "waiting"', async ({ page }) => {
    await openMatrix(page);
    const chip = page.locator('.slot.s-never-deployed .ctx-badge');
    await expect(chip).toContainText('waiting');
  });

  test('slot has NO split bottom section (no tile-divider)', async ({ page }) => {
    await openMatrix(page);
    const slot = page.locator('.slot.s-never-deployed').first();
    await expect(slot.locator('.tile-divider')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Matrix tile — effective state unchanged
// ---------------------------------------------------------------------------

test.describe('Matrix tile — effective slots are unchanged', () => {
  test('at least one s-success slot exists', async ({ page }) => {
    await openMatrix(page);
    await expect(page.locator('.slot.s-success').first()).toBeVisible();
  });

  test('s-success slots do NOT have s-never-deployed class', async ({ page }) => {
    await openMatrix(page);
    await expect(page.locator('.slot.s-success.s-never-deployed')).toHaveCount(0);
  });

  test('empty ("—") slots are unchanged', async ({ page }) => {
    await openMatrix(page);
    // Empty slots: platform-proxy has no preprod or prod → at least 2 empty cells.
    const empty = page.locator('.slot.empty');
    const count = await empty.count();
    expect(count).toBeGreaterThan(0);
    // Empty slots must not have s-never-deployed
    await expect(page.locator('.slot.empty.s-never-deployed')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Swimlane card — never-deployed
// ---------------------------------------------------------------------------

test.describe('Swimlane card — never-deployed node (platform-proxy|qa)', () => {
  test('card carries s-never-deployed class', async ({ page }) => {
    await openSwimlanes(page);
    const card = page.locator('.vis-card.s-never-deployed').first();
    await expect(card).toBeVisible();
  });

  test('card does NOT carry effective state class', async ({ page }) => {
    await openSwimlanes(page);
    const card = page.locator('.vis-card.s-never-deployed').first();
    await expect(card).not.toHaveClass(/s-success/);
    await expect(card).not.toHaveClass(/s-progress/);
    await expect(card).not.toHaveClass(/s-failure/);
  });

  test('card has a status chip with class cb-waiting', async ({ page }) => {
    await openSwimlanes(page);
    const chip = page.locator('.vis-card.s-never-deployed .ctx-badge.cb-waiting');
    await expect(chip).toBeVisible();
  });

  test('status chip text contains "waiting"', async ({ page }) => {
    await openSwimlanes(page);
    const chip = page.locator('.vis-card.s-never-deployed .ctx-badge');
    await expect(chip).toContainText('waiting');
  });
});

// ---------------------------------------------------------------------------
// Swimlane card — effective states unchanged
// ---------------------------------------------------------------------------

test.describe('Swimlane cards — effective states unchanged', () => {
  test('s-success cards exist and have no s-never-deployed class', async ({ page }) => {
    await openSwimlanes(page);
    await expect(page.locator('.vis-card.s-success').first()).toBeVisible();
    await expect(page.locator('.vis-card.s-success.s-never-deployed')).toHaveCount(0);
  });
});
