/**
 * Live-app E2E — Analytics view (issue #299).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3000, which serves fixed analytics fixtures).
 *
 * Spec / contract:
 *   frontend/dashboard/src/app/features/analytics/analytics.component.html
 *   docs/api/openapi.yaml — tag: analytics
 *
 * Assertions (per testing task mandate):
 *   A) 3rd tab in the topbar navigates to /analytics (app-analytics mounts).
 *   B) Period selector 7d / 14d / 30d re-fetches + re-renders (subtitle changes,
 *      active button class moves).
 *   C) KPI band shows exactly 4 keys with classification chips.
 *   D) All 8 chart containers mount with an ngx-echarts canvas/svg present.
 *   E) Retention-bound subtitle is surfaced when window.clamped is true.
 *   F) Legend button (☷) is ABSENT on the Analytics tab (present on Matrix / Swimlanes).
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the SPA, wait for app-root, then click the Analytics tab.
 * The mock always serves data, so we wait for the KPI band to render.
 */
async function openAnalytics(page: Page): Promise<void> {
  await page.goto('/analytics');
  await page.waitForSelector('app-root', { timeout: 20_000 });
  // Wait until at least one KPI card is rendered (signals data arrived)
  await page.waitForSelector('.an-kpi-card', { timeout: 20_000 });
  await page.waitForTimeout(400);
}

/** Return the text of the currently-active period button. */
async function activePeriod(page: Page): Promise<string> {
  const btn = page.locator('.an-period-btn.is-active');
  await expect(btn).toHaveCount(1);
  return (await btn.textContent())?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// A) Navigation: 3rd tab routes to /analytics
// ---------------------------------------------------------------------------

test.describe('Analytics tab navigation', () => {

  test('clicking the Analytics view option in the topbar navigates to /analytics', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // PrimeNG SelectButton renders buttons with role="button" and aria labels.
    // Use the role + text content to locate the Analytics tab button.
    const analyticsOption = page.getByRole('button', { name: /^analytics$/i });
    await expect(analyticsOption).toHaveCount(1);
    await analyticsOption.click();

    await page.waitForURL('**/analytics', { timeout: 10_000 });
    await page.waitForSelector('.an-shell', { timeout: 20_000 });
    expect(page.url()).toContain('/analytics');
  });

  test('direct navigation to /analytics mounts the analytics view', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('.an-shell')).toBeVisible();
  });

});

// ---------------------------------------------------------------------------
// B) Period selector
// ---------------------------------------------------------------------------

test.describe('Period selector', () => {

  test('analytics view loads with a default period selected (a period button is active)', async ({ page }) => {
    await openAnalytics(page);
    const period = await activePeriod(page);
    expect(['7d', '14d', '30d']).toContain(period);
  });

  test('all three period buttons (7d, 14d, 30d) are present', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('.an-period-btn', { hasText: '7d' })).toHaveCount(1);
    await expect(page.locator('.an-period-btn', { hasText: '14d' })).toHaveCount(1);
    await expect(page.locator('.an-period-btn', { hasText: '30d' })).toHaveCount(1);
  });

  test('clicking a different period moves the active state and updates the subtitle', async ({ page }) => {
    await openAnalytics(page);

    // Read the initial subtitle so we can compare after period change.
    const subtitleBefore = await page.locator('.an-sub').textContent();

    // Find a period button that is NOT already active; capture its label BEFORE clicking.
    const inactiveFirst = page.locator('.an-period-btn:not(.is-active)').first();
    const clickedLabel = (await inactiveFirst.textContent())?.trim();
    await inactiveFirst.click();

    // Wait for the KPI band to re-render after refetch.
    await page.waitForTimeout(600);

    // The active button text should now match the one we clicked.
    const newActivePeriod = await activePeriod(page);
    expect(newActivePeriod).toBe(clickedLabel);

    // Subtitle should have changed (different window.days embedded).
    const subtitleAfter = await page.locator('.an-sub').textContent();
    expect(subtitleAfter).not.toBe(subtitleBefore);
  });

  test('period change re-renders the KPI band (values may differ between 7d and 30d)', async ({ page }) => {
    await openAnalytics(page);

    // Switch to 7d
    await page.locator('.an-period-btn', { hasText: '7d' }).click();
    await page.waitForTimeout(600);
    const sub7d = (await page.locator('.an-sub').textContent())?.trim() ?? '';

    // Switch to 30d
    await page.locator('.an-period-btn', { hasText: '30d' }).click();
    await page.waitForTimeout(600);
    const sub30d = (await page.locator('.an-sub').textContent())?.trim() ?? '';

    // The mock returns different window.days per period → subtitles differ
    expect(sub7d).not.toBe(sub30d);
  });

});

// ---------------------------------------------------------------------------
// C) KPI band — exactly 4 cards with classification chips
// ---------------------------------------------------------------------------

test.describe('DORA KPI band', () => {

  test('exactly 4 KPI cards are rendered', async ({ page }) => {
    await openAnalytics(page);
    await expect(page.locator('.an-kpi-card')).toHaveCount(4);
  });

  test('each KPI card has a classification chip with a non-empty label', async ({ page }) => {
    await openAnalytics(page);
    const chips = page.locator('.an-class-chip');
    await expect(chips).toHaveCount(4);
    const texts = await chips.allTextContents();
    for (const text of texts) {
      expect(text.trim().length).toBeGreaterThan(0);
      // Classification chips must be one of the four lowercase DORA bands
      expect(['elite', 'high', 'medium', 'low']).toContain(text.trim().toLowerCase());
    }
  });

  test('the lead_time KPI card shows the "~approx" annotation', async ({ page }) => {
    await openAnalytics(page);
    // The template renders .an-approx-note only on the lead_time card
    await expect(page.locator('.an-approx-note')).toHaveCount(1);
    const approxText = await page.locator('.an-approx-note').textContent();
    expect(approxText).toContain('approx');
  });

});

// ---------------------------------------------------------------------------
// D) All 8 chart containers mount with an ngx-echarts canvas/svg present
// ---------------------------------------------------------------------------

test.describe('Charts — 8 echarts containers mount', () => {

  /**
   * Wait until the ngx-echarts canvas elements (or SVG when canvas unavailable)
   * are visible.  ECharts under CanvasRenderer produces a <canvas>; under
   * SVGRenderer a <svg>.  We check both to stay renderer-agnostic.
   *
   * The mock always returns data, so the @if guards flip to truthy quickly.
   */
  async function expectEchartsInContainer(page: Page, containerAriaLabel: string): Promise<void> {
    const container = page.locator(`[echarts][aria-label="${containerAriaLabel}"], div[echarts][aria-label="${containerAriaLabel}"]`);
    await expect(container).toHaveCount(1, { timeout: 15_000 });
    // Either a <canvas> or <svg> should be rendered inside the echarts host
    const hasCanvas = await container.locator('canvas').count();
    const hasSvg    = await container.locator('svg').count();
    expect(
      hasCanvas + hasSvg,
      `No canvas/svg found inside echarts container "${containerAriaLabel}"`,
    ).toBeGreaterThan(0);
  }

  test('Deployment frequency stacked bar chart mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Deployment frequency stacked bar chart');
  });

  test('Change failure rate trend line chart mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Change failure rate trend line chart');
  });

  test('Deployment duration histogram mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Deployment duration histogram');
  });

  test('Promotion funnel chart mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Promotion funnel chart');
  });

  test('Status distribution donut chart mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Status distribution donut chart');
  });

  test('Deployment heatmap by day and hour mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Deployment heatmap by day and hour');
  });

  test('Top deployers horizontal bar chart mounts', async ({ page }) => {
    await openAnalytics(page);
    await expectEchartsInContainer(page, 'Top deployers horizontal bar chart');
  });

  test('MTTR incidents list renders (8th "chart" — HTML list, not echarts)', async ({ page }) => {
    await openAnalytics(page);
    // The incidents section renders either a list or an empty-state message.
    const incidentsList = page.locator('.an-incidents-list');
    const emptyState    = page.locator('.an-chart-empty');
    const listOrEmpty   = incidentsList.or(emptyState.first());
    await expect(listOrEmpty).toHaveCount(1, { timeout: 15_000 });
  });

});

// ---------------------------------------------------------------------------
// E) Retention-bound subtitle surfaced (mock-intercept route)
// ---------------------------------------------------------------------------

test.describe('Retention bound label', () => {

  test('shows "clamped to retention" in subtitle when window.clamped is true', async ({ page }) => {
    // Intercept the DORA endpoint and return clamped: true to trigger the label.
    await page.route('**/api/analytics/dora**', (route) => {
      const to   = new Date().toISOString();
      const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          window: {
            days: 90, from, to,
            retention_days: 90,
            clamped: true,
          },
          deployment_frequency: {
            value: 5.0, unit: 'per_day', classification: 'elite',
            trend_delta: 0, sparkline: [5], approximated: false,
          },
          lead_time: {
            value: 3.0, unit: 'hours', classification: 'high',
            trend_delta: null, sparkline: [3], approximated: true,
          },
          change_failure_rate: {
            value: 0.1, unit: 'ratio', classification: 'high',
            trend_delta: 0, sparkline: [0.1], approximated: false,
          },
          time_to_restore: {
            value: 60, unit: 'minutes', classification: 'medium',
            trend_delta: null, sparkline: [60], approximated: false,
          },
        }),
      });
    });

    await openAnalytics(page);

    const subtitle = await page.locator('.an-sub').textContent();
    expect(subtitle).toContain('clamped');
    expect(subtitle).toContain('retention');
  });

});

// ---------------------------------------------------------------------------
// F) Legend button (☷) — ABSENT on Analytics, present on Matrix/Swimlanes
// ---------------------------------------------------------------------------

test.describe('Legend button guard — fix #10', () => {

  test('Legend button is NOT rendered on the Analytics view', async ({ page }) => {
    await openAnalytics(page);
    // The topbar hides the legend button with @if(!isAnalytics())
    const legendBtn = page.locator('button[aria-label="Legend — status key"]');
    await expect(legendBtn).toHaveCount(0);
  });

  test('Legend button IS rendered on the Matrix view', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('.col-draggable .env-tag', { timeout: 20_000 });
    await page.waitForTimeout(300);
    const legendBtn = page.locator('button[aria-label="Legend — status key"]');
    await expect(legendBtn).toHaveCount(1);
  });

  test('Legend button IS rendered on the Swimlanes view', async ({ page }) => {
    await page.goto('/swimlanes');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);
    const legendBtn = page.locator('button[aria-label="Legend — status key"]');
    await expect(legendBtn).toHaveCount(1);
  });

});
