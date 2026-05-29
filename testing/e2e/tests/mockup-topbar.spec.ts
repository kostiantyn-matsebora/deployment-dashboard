/**
 * Mockup — Topbar tests.
 *
 * Verifies: brand, tabs, KPIs, filter visibility, theme switcher,
 * fields/correlation pickers, live pill, and tab-switch side-effects.
 *
 * No need to close the drawer first — topbar is always on top.
 */

import { test, expect } from '@playwright/test';
import { openMockup } from './helpers';

test.describe('Mockup — Topbar', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page);
  });

  // ── Brand ─────────────────────────────────────────────────────────────────

  test('brand name renders', async ({ page }) => {
    await expect(page.locator('.brand-name')).toContainText('Deployment Dashboard');
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────

  test('Matrix tab label is "Matrix"', async ({ page }) => {
    await expect(page.locator('button[data-view="matrix"]')).toHaveText('Matrix');
  });

  test('Swimlanes tab label is "Swimlanes"', async ({ page }) => {
    await expect(page.locator('button[data-view="vis"]')).toHaveText('Swimlanes');
  });

  test('Matrix tab is active on load', async ({ page }) => {
    await expect(page.locator('button[data-view="matrix"]')).toHaveClass(/is-active/);
  });

  test('Swimlanes tab is not active on load', async ({ page }) => {
    await expect(page.locator('button[data-view="vis"]')).not.toHaveClass(/is-active/);
  });

  test('clicking Swimlanes tab activates it and deactivates Matrix', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    await expect(page.locator('button[data-view="vis"]')).toHaveClass(/is-active/);
    await expect(page.locator('button[data-view="matrix"]')).not.toHaveClass(/is-active/);
  });

  test('clicking Matrix tab re-activates it after switching away', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    await page.click('button[data-view="matrix"]');
    await expect(page.locator('button[data-view="matrix"]')).toHaveClass(/is-active/);
    await expect(page.locator('button[data-view="vis"]')).not.toHaveClass(/is-active/);
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────

  test('KPI services = 8', async ({ page }) => {
    await expect(page.locator('#kpi-services')).toHaveText('8');
  });

  test('KPI envs = 5', async ({ page }) => {
    await expect(page.locator('#kpi-envs')).toHaveText('5');
  });

  test('KPI in-flight is a positive integer', async ({ page }) => {
    const text = await page.locator('#kpi-inflight').textContent();
    expect(parseInt(text ?? '0', 10)).toBeGreaterThan(0);
  });

  test('KPI failed is a positive integer', async ({ page }) => {
    const text = await page.locator('#kpi-failed').textContent();
    expect(parseInt(text ?? '0', 10)).toBeGreaterThan(0);
  });

  // ── Matrix-only controls ──────────────────────────────────────────────────

  test('service filter input is visible in Matrix view', async ({ page }) => {
    await expect(page.locator('#svc-filter')).toBeVisible();
  });

  test('service filter input is hidden in Swimlanes view', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    // setView('vis') sets hdr-matrix-filter display:none
    await expect(page.locator('#hdr-matrix-filter')).not.toBeVisible();
  });

  // ── Swimlanes-only controls ───────────────────────────────────────────────

  test('correlation button hidden in Matrix view', async ({ page }) => {
    await expect(page.locator('#hdr-vis-icons')).not.toBeVisible();
  });

  test('correlation button visible in Swimlanes view', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    await expect(page.locator('#btn-correlation')).toBeVisible();
  });

  // ── Fields picker ─────────────────────────────────────────────────────────

  test('fields picker button is visible', async ({ page }) => {
    await expect(page.locator('#btn-fields')).toBeVisible();
  });

  test('fields picker popover opens on click', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#pop-fields')).toHaveClass(/is-open/);
  });

  test('fields picker shows "Visible fields — Matrix" title in Matrix view', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#pop-fields-title')).toHaveText('Visible fields — Matrix');
  });

  test('fields picker shows "Visible fields — Swimlanes" title in Swimlanes view', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    await page.click('#btn-fields');
    await expect(page.locator('#pop-fields-title')).toHaveText('Visible fields — Swimlanes');
  });

  test('fields picker shows matrix grid in Matrix view', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#fields-grid-matrix')).toBeVisible();
    await expect(page.locator('#fields-grid-vis')).not.toBeVisible();
  });

  test('fields picker shows vis grid in Swimlanes view', async ({ page }) => {
    await page.click('button[data-view="vis"]');
    await page.click('#btn-fields');
    await expect(page.locator('#fields-grid-vis')).toBeVisible();
    await expect(page.locator('#fields-grid-matrix')).not.toBeVisible();
  });

  test('pressing Escape closes the fields picker popover', async ({ page }) => {
    await page.click('#btn-fields');
    await expect(page.locator('#pop-fields')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pop-fields')).not.toHaveClass(/is-open/);
  });

  // ── Theme switcher ────────────────────────────────────────────────────────

  test('theme switcher has dark, light, and auto options', async ({ page }) => {
    await expect(page.locator('[data-theme-pick="dark"]')).toBeVisible();
    await expect(page.locator('[data-theme-pick="light"]')).toBeVisible();
    await expect(page.locator('[data-theme-pick="auto"]')).toBeVisible();
  });

  test('dark theme is active by default', async ({ page }) => {
    await expect(page.locator('[data-theme-pick="dark"]')).toHaveClass(/is-on/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('clicking light theme switches data-theme to light', async ({ page }) => {
    await page.click('[data-theme-pick="light"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('[data-theme-pick="light"]')).toHaveClass(/is-on/);
    await expect(page.locator('[data-theme-pick="dark"]')).not.toHaveClass(/is-on/);
  });

  test('clicking auto theme switches data-theme to auto', async ({ page }) => {
    await page.click('[data-theme-pick="auto"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
  });

  // ── Live indicator ────────────────────────────────────────────────────────

  test('live indicator pill is visible', async ({ page }) => {
    await expect(page.locator('.live-pill')).toBeVisible();
  });

  test('live pill contains "SSE live" text', async ({ page }) => {
    await expect(page.locator('.live-pill')).toContainText('SSE live');
  });
});
