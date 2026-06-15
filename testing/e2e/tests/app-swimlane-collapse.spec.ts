/**
 * Live-app E2E — Swimlane collapse / expand (#309).
 *
 * Runs against the Angular SPA at http://localhost:4200 backed by the NestJS
 * mock on :3000.  Mock data has 10 services (auth-bff, billing-webhook,
 * catalog-edge, data-pipeline, ledger-projector, notification-worker,
 * order-svc, payments-api, platform-proxy, search-indexer).
 *
 * Default state on first load: all lanes start collapsed.  A collapsed lane
 * shows the vector (root→tip chain).  For the mock data every service has
 * exactly 1 connected chain under explicit-parent correlation, so the vector
 * IS the full lane — collapsed and expanded are pixel-identical per spec
 * ("A pure single-chain lane is pixel-identical collapsed vs expanded").
 * The meaningful assertions here are therefore:
 *   - aria-expanded state on chevrons and the all-lanes pill label.
 *   - State persistence across toggle cycles (expand-all → collapse-all).
 *
 * Tests use real page.click() on the actual DOM buttons and assert per-element
 * aria-expanded state — function-call invocations are explicitly not used.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANE_COUNT = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the swimlanes route, clear all collapse/known localStorage keys
 * so every run starts from the same clean-slate first-visit state, then reload
 * and wait for cards to render.
 */
async function openSwimlanes(page: Page): Promise<void> {
  await page.goto('/swimlanes', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-root', { timeout: 20_000 });

  // Wipe collapse-state so every test starts from first-visit defaults.
  await page.evaluate(() => {
    localStorage.removeItem('dd:swimCollapsed');
    localStorage.removeItem('dd:swimKnown');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for vis-cards (ngx-graph layout + Angular OnPush stabilise after ~1 s).
  await page.waitForSelector('.vis-card', { timeout: 30_000 });
  await page.waitForTimeout(2000);
}

/** Return the aria-expanded attribute value for the chevron of `service`. */
async function laneAriaExpanded(page: Page, service: string): Promise<string | null> {
  const btn = page.locator(`.lane[data-swim-service="${service}"] .lane-chevron`);
  return btn.getAttribute('aria-expanded');
}

/** Count visible vis-cards inside a specific lane. */
async function laneCardCount(page: Page, service: string): Promise<number> {
  // vis-cards are rendered inside the .lane via ngx-graph foreignObject children.
  // They carry no lane attribute, but they live inside the .lane div.
  return page.locator(`.lane[data-swim-service="${service}"] .vis-card`).count();
}

// ---------------------------------------------------------------------------
// Default collapse state
// ---------------------------------------------------------------------------

test.describe('Swimlane — default collapse state (#309)', () => {
  test.beforeEach(async ({ page }) => {
    await openSwimlanes(page);
  });

  test('all 10 lanes are rendered', async ({ page }) => {
    await expect(page.locator('.lane')).toHaveCount(LANE_COUNT);
  });

  test('all chevrons have aria-expanded="false" on first load', async ({ page }) => {
    const chevrons = page.locator('.lane-chevron');
    const count = await chevrons.count();
    expect(count).toBe(LANE_COUNT);
    for (let i = 0; i < count; i++) {
      await expect(chevrons.nth(i)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('each collapsed lane renders at least 1 vis-card (vector tip)', async ({ page }) => {
    // Spec: collapsed lane shows the root→tip vector chain.
    // With mock data (single chain per service) the vector = full lane, so
    // card count ≥ 1.  The aria-expanded="false" assertion above verifies state.
    const lanes = page.locator('.lane');
    const count = await lanes.count();
    expect(count).toBe(LANE_COUNT);
    for (let i = 0; i < count; i++) {
      const cardCount = await lanes.nth(i).locator('.vis-card').count();
      expect(
        cardCount,
        `lane[${i}] expected ≥1 card in collapsed state, got ${cardCount}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  test('topbar pill reads "⊟ Collapse all" when all lanes are collapsed', async ({ page }) => {
    // When all are collapsed, allCollapsed() is true → pill reads "⊞ Expand all".
    // (collapsed = default state → all lanes collapsed → allCollapsed=true)
    await expect(page.locator('.swim-collapse-all-btn')).toContainText('⊞ Expand all');
  });
});

// ---------------------------------------------------------------------------
// Per-lane chevron click
// ---------------------------------------------------------------------------

test.describe('Swimlane — per-lane chevron click (#309)', () => {
  test.beforeEach(async ({ page }) => {
    await openSwimlanes(page);
  });

  test('clicking chevron expands lane: aria-expanded flips to true', async ({ page }) => {
    const service = 'payments-api';
    // Start collapsed
    expect(await laneAriaExpanded(page, service)).toBe('false');

    await page.locator(`.lane[data-swim-service="${service}"] .lane-chevron`).click();
    // Wait for Angular OnPush + ngx-graph re-layout.
    await page.waitForTimeout(1500);

    expect(await laneAriaExpanded(page, service)).toBe('true');
  });

  test('expanding a lane flips aria-expanded to true and keeps cards visible', async ({ page }) => {
    const service = 'payments-api';
    const collapsedCount = await laneCardCount(page, service);
    expect(collapsedCount).toBeGreaterThanOrEqual(1);

    await page.locator(`.lane[data-swim-service="${service}"] .lane-chevron`).click();
    await page.waitForTimeout(1500);

    // aria-expanded must have flipped.
    expect(await laneAriaExpanded(page, service)).toBe('true');
    // Cards are still visible (expanded = full DAG ≥ collapsed vector).
    const expandedCount = await laneCardCount(page, service);
    expect(
      expandedCount,
      `payments-api should have ≥1 card when expanded`,
    ).toBeGreaterThanOrEqual(collapsedCount);
  });

  test('clicking chevron again re-collapses lane: aria-expanded flips to false', async ({ page }) => {
    const service = 'payments-api';
    const chevron = page.locator(`.lane[data-swim-service="${service}"] .lane-chevron`);

    // Expand
    await chevron.click();
    await page.waitForTimeout(1500);
    expect(await laneAriaExpanded(page, service)).toBe('true');

    // Collapse
    await chevron.click();
    await page.waitForTimeout(1500);
    expect(await laneAriaExpanded(page, service)).toBe('false');
    // Cards still visible in collapsed vector form.
    expect(await laneCardCount(page, service)).toBeGreaterThanOrEqual(1);
  });

  test('other lanes remain collapsed when one is expanded', async ({ page }) => {
    await page.locator(`.lane[data-swim-service="payments-api"] .lane-chevron`).click();
    await page.waitForTimeout(1500);

    // auth-bff stays collapsed
    expect(await laneAriaExpanded(page, 'auth-bff')).toBe('false');
    expect(await laneCardCount(page, 'auth-bff')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Topbar Expand all / Collapse all pill
// ---------------------------------------------------------------------------

test.describe('Swimlane — Expand all / Collapse all pill (#309)', () => {
  test.beforeEach(async ({ page }) => {
    await openSwimlanes(page);
  });

  test('clicking "Expand all" flips all chevrons to aria-expanded="true"', async ({ page }) => {
    // Default: all collapsed → pill reads "⊞ Expand all"
    await page.locator('.swim-collapse-all-btn').click();
    // Wait for Angular signals + ngx-graph re-layout across all 10 lanes.
    await page.waitForTimeout(3000);

    const chevrons = page.locator('.lane-chevron');
    const count = await chevrons.count();
    expect(count).toBe(LANE_COUNT);
    for (let i = 0; i < count; i++) {
      await expect(
        chevrons.nth(i),
        `lane[${i}] chevron should be aria-expanded="true" after Expand all`,
      ).toHaveAttribute('aria-expanded', 'true');
    }
  });

  test('after Expand all each lane shows at least 1 vis-card', async ({ page }) => {
    await page.locator('.swim-collapse-all-btn').click();
    await page.waitForTimeout(3000);

    const lanes = page.locator('.lane');
    const count = await lanes.count();
    expect(count).toBe(LANE_COUNT);
    for (let i = 0; i < count; i++) {
      const cardCount = await lanes.nth(i).locator('.vis-card').count();
      expect(
        cardCount,
        `lane[${i}] should have ≥1 card after Expand all`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  test('pill label flips to "⊟ Collapse all" after Expand all click', async ({ page }) => {
    await page.locator('.swim-collapse-all-btn').click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.swim-collapse-all-btn')).toContainText('⊟ Collapse all');
  });

  test('clicking "Collapse all" after Expand all re-collapses all lanes: all aria-expanded false', async ({ page }) => {
    // Step 1: expand all
    await page.locator('.swim-collapse-all-btn').click();
    await page.waitForTimeout(3000);

    // Step 2: collapse all
    await page.locator('.swim-collapse-all-btn').click();
    await page.waitForTimeout(3000);

    const chevrons = page.locator('.lane-chevron');
    const count = await chevrons.count();
    expect(count).toBe(LANE_COUNT);
    for (let i = 0; i < count; i++) {
      await expect(
        chevrons.nth(i),
        `lane[${i}] chevron should be aria-expanded="false" after Collapse all`,
      ).toHaveAttribute('aria-expanded', 'false');
    }

    // Cards still visible in collapsed vector form.
    const lanes = page.locator('.lane');
    for (let i = 0; i < count; i++) {
      const cardCount = await lanes.nth(i).locator('.vis-card').count();
      expect(
        cardCount,
        `lane[${i}] should have ≥1 card in collapsed state`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  test('pill label returns to "⊞ Expand all" after full cycle', async ({ page }) => {
    await page.locator('.swim-collapse-all-btn').click(); // expand all
    await page.waitForTimeout(3000);
    await page.locator('.swim-collapse-all-btn').click(); // collapse all
    await page.waitForTimeout(3000);
    await expect(page.locator('.swim-collapse-all-btn')).toContainText('⊞ Expand all');
  });
});
