/**
 * Mockup — Context Badge tests (#268).
 *
 * Verifies that the five "context" statuses (pending/queued/waiting/cancelled/rejected)
 * render as .ctx-badge pills on matrix tiles and swimlane cards WITHOUT replacing the
 * tile's primary box state (success/failure/in-progress).
 *
 * Data fixtures from SLOTS/VIS_NODES in docs/design/mockup/index.html:
 *   Matrix:
 *     notification-worker|prod    → rejected   (no contextVersion)
 *     ledger-projector|prod       → cancelled  (no contextVersion)
 *     search-indexer|preprod      → pending    v0.7.12
 *     search-indexer|prod         → queued     v0.7.12
 *     billing-webhook|qa          → waiting    v1.4.0
 *   Swimlanes (VIS_NODES):
 *     n1pending0001               → pending    v3.2.7-rc1
 *     n2queued0002                → queued     v0.41.3-rc1
 *     n3waiting0003               → waiting    v2.14.4-rc1
 *     n4cancelled004              → cancelled  (no contextVersion)
 *     n5rejected0005              → rejected   (no contextVersion)
 */

import { test, expect } from '@playwright/test';
import { openMockup, switchToSwimlanes } from './helpers';

// ── Matrix view — ctx-badge presence ─────────────────────────────────────────

test.describe('Mockup — Context badges in Matrix view', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page);
  });

  test('notification-worker|prod slot has a .cb-rejected badge', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="notification-worker"][data-env="prod"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('.ctx-badge.cb-rejected');
    await expect(badge).toBeVisible();
  });

  test('ledger-projector|prod slot has a .cb-cancelled badge', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="ledger-projector"][data-env="prod"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('.ctx-badge.cb-cancelled');
    await expect(badge).toBeVisible();
  });

  test('search-indexer|preprod slot has a .cb-pending badge with version', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="search-indexer"][data-env="preprod"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('.ctx-badge.cb-pending');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('pending');
    await expect(badge).toContainText('v0.7.12');
  });

  test('search-indexer|prod slot has a .cb-queued badge with version', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="search-indexer"][data-env="prod"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('.ctx-badge.cb-queued');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('queued');
    await expect(badge).toContainText('v0.7.12');
  });

  test('billing-webhook|qa slot has a .cb-waiting badge with version', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="billing-webhook"][data-env="qa"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('.ctx-badge.cb-waiting');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('waiting');
    await expect(badge).toContainText('v1.4.0');
  });

  // ── Primary state is NOT overridden by context status ──────────────────────

  test('search-indexer|prod still has .s-success box state with ctx-badge', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="search-indexer"][data-env="prod"]');
    await expect(slot).toBeVisible();
    // tile background should be success (emerald), not running/failure
    await expect(slot).toHaveClass(/s-success/);
    // AND the ctx badge must also be present
    await expect(slot.locator('.ctx-badge.cb-queued')).toBeVisible();
  });

  test('notification-worker|prod still has .s-success box state with ctx-badge', async ({ page }) => {
    const slot = page.locator('.slot[data-svc="notification-worker"][data-env="prod"]');
    await expect(slot).toHaveClass(/s-success/);
    await expect(slot.locator('.ctx-badge.cb-rejected')).toBeVisible();
  });

  // ── Total badge count — exactly 5 badges across the whole matrix ───────────

  test('exactly 5 ctx-badge elements are visible in the matrix', async ({ page }) => {
    const badges = page.locator('#view-matrix .ctx-badge');
    await expect(badges).toHaveCount(5);
  });

  // ── Badges in normal document flow (ctx-row), not absolutely positioned ─────

  test('ctx-badges are inside .ctx-row elements (flow layout)', async ({ page }) => {
    const ctxRows = page.locator('#view-matrix .ctx-row');
    const count = await ctxRows.count();
    expect(count).toBe(5);
    for (let i = 0; i < count; i++) {
      // Each .ctx-row must have position:static (flow layout, not absolute)
      const pos = await ctxRows.nth(i).evaluate((el) => getComputedStyle(el).position);
      expect(pos).toBe('static');
    }
  });
});

// ── Swimlanes view — ctx-badge presence ──────────────────────────────────────

test.describe('Mockup — Context badges in Swimlanes view', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page);
    await switchToSwimlanes(page);
  });

  test('swimlanes view has exactly 5 .ctx-badge elements', async ({ page }) => {
    const badges = page.locator('#view-vis .ctx-badge');
    await expect(badges).toHaveCount(5);
  });

  test('a .cb-pending badge exists in the swimlanes view', async ({ page }) => {
    await expect(page.locator('#view-vis .ctx-badge.cb-pending')).toBeVisible();
  });

  test('a .cb-queued badge exists in the swimlanes view', async ({ page }) => {
    await expect(page.locator('#view-vis .ctx-badge.cb-queued')).toBeVisible();
  });

  test('a .cb-waiting badge exists in the swimlanes view', async ({ page }) => {
    await expect(page.locator('#view-vis .ctx-badge.cb-waiting')).toBeVisible();
  });

  test('a .cb-cancelled badge exists in the swimlanes view', async ({ page }) => {
    await expect(page.locator('#view-vis .ctx-badge.cb-cancelled')).toBeVisible();
  });

  test('a .cb-rejected badge exists in the swimlanes view', async ({ page }) => {
    await expect(page.locator('#view-vis .ctx-badge.cb-rejected')).toBeVisible();
  });

  // ── Vis-card primary state is NOT overridden ──────────────────────────────

  test('vis-cards with ctx-badge still carry .s-success class', async ({ page }) => {
    // All 5 VIS_NODES demo nodes have status:'success' with a context badge
    const cardsWithBadge = page.locator('#view-vis .vis-card:has(.ctx-badge)');
    const count = await cardsWithBadge.count();
    expect(count).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < count; i++) {
      await expect(cardsWithBadge.nth(i)).toHaveClass(/s-success/);
    }
  });
});

// ── History drawer — context-status entry displayed ──────────────────────────

test.describe('Mockup — History drawer shows context-status entries', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page);
  });

  test('history drawer for search-indexer|preprod shows a context entry', async ({ page }) => {
    // Click the slot with the pending badge to open its history drawer
    await page.locator('.slot[data-svc="search-indexer"][data-env="preprod"]').click();
    await page.waitForTimeout(300);
    // The drawer should be open
    await expect(page.locator('#drawer')).toHaveClass(/is-open/);
    // At least one history entry should be visible
    const entries = page.locator('#hist .hist-entry');
    await expect(entries.first()).toBeVisible();
  });

  test('history drawer for billing-webhook|qa shows a context entry', async ({ page }) => {
    await page.locator('.slot[data-svc="billing-webhook"][data-env="qa"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#drawer')).toHaveClass(/is-open/);
    const entries = page.locator('#hist .hist-entry');
    await expect(entries.first()).toBeVisible();
  });
});
