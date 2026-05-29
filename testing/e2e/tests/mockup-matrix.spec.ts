/**
 * Mockup — Matrix View tests.
 *
 * Verifies: service rows, env columns, per-state CSS classes,
 * history drawer open/close, service filter, failures-only toggle.
 *
 * Each test closes the auto-opened drawer first (openDrawer is called at
 * the bottom of the mockup script on every page load).
 *
 * Slot state codes → CSS class mapping (from renderSlot):
 *   success         → .s-success
 *   run-last        → .s-run-last
 *   run-fail-last   → .s-run-fail-last
 *   fail-last       → .s-fail-last
 *   running-only    → .s-running-only
 *   run-fail-only   → .s-run-fail-only
 */

import { test, expect } from '@playwright/test';
import { openMockup } from './helpers';

// Fixture data mirrored from mockup SERVICES / ENVS constants.
const SERVICES = [
  'payments-api',
  'notification-worker',
  'auth-bff',
  'order-svc',
  'catalog-edge',
  'ledger-projector',
  'search-indexer',
  'billing-webhook',
] as const;

const ENVS = ['dev', 'staging', 'qa', 'preprod', 'prod'] as const;

test.describe('Mockup — Matrix View', () => {
  test.beforeEach(async ({ page }) => {
    await openMockup(page); // auto-closes the drawer on load
  });

  // ── View activation ───────────────────────────────────────────────────────

  test('matrix view section is active on load', async ({ page }) => {
    await expect(page.locator('#view-matrix')).toHaveClass(/is-active/);
  });

  test('vis view section is not active on load', async ({ page }) => {
    await expect(page.locator('#view-vis')).not.toHaveClass(/is-active/);
  });

  // ── Environment column headers ────────────────────────────────────────────

  for (const env of ENVS) {
    test(`env column header visible: ${env}`, async ({ page }) => {
      await expect(page.locator(`.env-tag:text-is("${env}")`).first()).toBeVisible();
    });
  }

  // ── Service rows ──────────────────────────────────────────────────────────

  test('8 service row heads rendered', async ({ page }) => {
    await expect(page.locator('.row-head')).toHaveCount(SERVICES.length);
  });

  for (const svc of SERVICES) {
    test(`service row head visible: ${svc}`, async ({ page }) => {
      await expect(page.locator(`.row-head[data-svc="${svc}"]`)).toBeVisible();
    });
  }

  // ── Slot state classes (representative fixture cases) ────────────────────

  test('S1 success: payments-api|dev has .s-success', async ({ page }) => {
    await expect(page.locator('.slot[data-svc="payments-api"][data-env="dev"]')).toHaveClass(
      /s-success/,
    );
  });

  test('S2 run-last: payments-api|preprod has .s-run-last', async ({ page }) => {
    await expect(
      page.locator('.slot[data-svc="payments-api"][data-env="preprod"]'),
    ).toHaveClass(/s-run-last/);
  });

  test('S3 run-fail-last: auth-bff|dev has .s-run-fail-last', async ({ page }) => {
    await expect(page.locator('.slot[data-svc="auth-bff"][data-env="dev"]')).toHaveClass(
      /s-run-fail-last/,
    );
  });

  test('S4 fail-last: notification-worker|staging has .s-fail-last', async ({ page }) => {
    await expect(
      page.locator('.slot[data-svc="notification-worker"][data-env="staging"]'),
    ).toHaveClass(/s-fail-last/);
  });

  test('S5 running-only: catalog-edge|qa has .s-running-only', async ({ page }) => {
    await expect(page.locator('.slot[data-svc="catalog-edge"][data-env="qa"]')).toHaveClass(
      /s-running-only/,
    );
  });

  test('S6 run-fail-only: ledger-projector|qa has .s-run-fail-only', async ({ page }) => {
    await expect(
      page.locator('.slot[data-svc="ledger-projector"][data-env="qa"]'),
    ).toHaveClass(/s-run-fail-only/);
  });

  // ── History drawer ────────────────────────────────────────────────────────

  test('clicking a slot opens the drawer', async ({ page }) => {
    await page.locator('.slot[data-svc="payments-api"][data-env="dev"]').click();
    await expect(page.locator('#drawer')).toHaveClass(/is-open/);
  });

  test('drawer breadcrumb matches clicked slot', async ({ page }) => {
    await page.locator('.slot[data-svc="auth-bff"][data-env="qa"]').click();
    await expect(page.locator('#drawer-crumbs')).toHaveText('auth-bff · qa');
  });

  test('drawer closes on Escape', async ({ page }) => {
    await page.locator('.slot[data-svc="payments-api"][data-env="dev"]').click();
    await expect(page.locator('#drawer')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#drawer')).not.toHaveClass(/is-open/);
  });

  test('drawer closes on overlay click', async ({ page }) => {
    await page.locator('.slot[data-svc="payments-api"][data-env="dev"]').click();
    await expect(page.locator('#drawer')).toHaveClass(/is-open/);
    await page.locator('#overlay').click({ force: true });
    await expect(page.locator('#drawer')).not.toHaveClass(/is-open/);
  });

  test('drawer close button (×) closes the drawer', async ({ page }) => {
    await page.locator('.slot[data-svc="payments-api"][data-env="dev"]').click();
    await page.locator('#drawer-close').click();
    await expect(page.locator('#drawer')).not.toHaveClass(/is-open/);
  });

  test('drawer history entries are rendered (≥1)', async ({ page }) => {
    await page.locator('.slot[data-svc="payments-api"][data-env="dev"]').click();
    const count = await page.locator('#hist .hist-entry').count();
    expect(count).toBeGreaterThan(0);
  });

  // ── Service filter ────────────────────────────────────────────────────────

  test('typing in service filter adds is-hidden to non-matching rows', async ({ page }) => {
    await page.fill('#svc-filter', 'auth');
    // auth-bff: visible (not hidden)
    await expect(page.locator('.row-head[data-svc="auth-bff"]')).not.toHaveClass(/is-hidden/);
    // payments-api: filtered out
    await expect(page.locator('.row-head[data-svc="payments-api"]')).toHaveClass(/is-hidden/);
  });

  test('service filter is case-insensitive', async ({ page }) => {
    await page.fill('#svc-filter', 'AUTH');
    await expect(page.locator('.row-head[data-svc="auth-bff"]')).not.toHaveClass(/is-hidden/);
    await expect(page.locator('.row-head[data-svc="payments-api"]')).toHaveClass(/is-hidden/);
  });

  test('clearing service filter restores all rows', async ({ page }) => {
    await page.fill('#svc-filter', 'auth');
    await page.fill('#svc-filter', '');
    for (const svc of SERVICES) {
      await expect(page.locator(`.row-head[data-svc="${svc}"]`)).not.toHaveClass(/is-hidden/);
    }
  });

  // ── Failures-only toggle ──────────────────────────────────────────────────

  test('failures-only toggle hides services with no failure state', async ({ page }) => {
    await page.locator('#fail-toggle').click();
    // billing-webhook: all slots are success / running-only (no fail-last/run-fail-* state)
    await expect(page.locator('.row-head[data-svc="billing-webhook"]')).toHaveClass(/is-hidden/);
  });

  test('failures-only toggle keeps services that have a failure state', async ({ page }) => {
    await page.locator('#fail-toggle').click();
    // auth-bff|dev is run-fail-last → svcHasFail = true → row remains visible
    await expect(page.locator('.row-head[data-svc="auth-bff"]')).not.toHaveClass(/is-hidden/);
    // notification-worker|staging is fail-last → visible
    await expect(page.locator('.row-head[data-svc="notification-worker"]')).not.toHaveClass(
      /is-hidden/,
    );
  });

  test('failures-only toggle toggles off again to restore all rows', async ({ page }) => {
    await page.locator('#fail-toggle').click();
    await page.locator('#fail-toggle').click();
    await expect(page.locator('.row-head[data-svc="billing-webhook"]')).not.toHaveClass(
      /is-hidden/,
    );
  });

  test('failures-only toggle updates its own is-on class', async ({ page }) => {
    await expect(page.locator('#fail-toggle')).not.toHaveClass(/is-on/);
    await page.locator('#fail-toggle').click();
    await expect(page.locator('#fail-toggle')).toHaveClass(/is-on/);
    await page.locator('#fail-toggle').click();
    await expect(page.locator('#fail-toggle')).not.toHaveClass(/is-on/);
  });
});
