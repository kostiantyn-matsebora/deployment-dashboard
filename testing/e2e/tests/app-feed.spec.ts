/**
 * Live-app E2E — Deployment feed: bottom dock + Feed view (issue #397).
 *
 * Runs against the Angular SPA at http://localhost:4200
 * (proxied through the NestJS mock on :3002, seeded from demo/data/events.json
 * — 58 fixed events, so pagination/infinite-scroll behavior is deterministic).
 *
 * Spec / contract:
 *   docs/api/openapi.yaml — listDeployments `q` param
 *   docs/design/views.md#feed-view-layout
 *   frontend/dashboard/src/app/features/feed/feed.component.{ts,html}
 *   frontend/dashboard/src/app/shared/feed-dock/feed-dock.component.{ts,html}
 *   frontend/dashboard/src/app/core/services/feed.service.ts
 *
 * Assertions (per testing task mandate):
 *   A) Feed is the 3rd tab, immediately after Swimlanes (locked order).
 *   B) Dock toggle in the topbar opens/closes the dock; the open/closed
 *      preference survives a reload (dd:feedDock in localStorage).
 *   C) Grouped roll-up rows expand to reveal per-event child rows.
 *   D) Infinite scroll appends the next cursor page as .feed-log nears bottom.
 *   E) The search box narrows visible rows via the server-side `q` param.
 *   F) The dock is suppressed (no .is-open) while the Feed view itself is
 *      active, without losing the stored open/closed preference.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** localStorage keys owned by FeedService (frontend/dashboard/.../feed.service.ts). */
const LS_GROUPED = 'dd:feedGrouped';
const LS_DOCK = 'dd:feedDock';

/**
 * Wipe feed-related localStorage, then navigate to a view.
 * Isolates each test from the dock-open / grouped preference left by others,
 * mirroring the clearAppState() pattern used by app-presets.spec.ts.
 */
async function resetFeedState(page: Page): Promise<void> {
  await page.goto('/matrix');
  await page.waitForSelector('app-root', { timeout: 20_000 });
  await page.evaluate(([groupedKey, dockKey]) => {
    localStorage.removeItem(groupedKey);
    localStorage.removeItem(dockKey);
  }, [LS_GROUPED, LS_DOCK]);
}

/** Navigate to /feed and wait for the shell + first page of rows to settle. */
async function openFeed(page: Page): Promise<void> {
  await page.goto('/feed');
  await page.waitForSelector('.feed-shell', { timeout: 20_000 });
  await expect(page.locator('.feed-searching')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(200);
}

/** The topbar's dock-toggle button (visible on every view). */
function dockToggleButton(page: Page) {
  return page.locator('button[aria-label="Deployment feed — toggle the live event panel"]');
}

// ---------------------------------------------------------------------------
// A) Tab order — Feed is locked immediately after Swimlanes
// ---------------------------------------------------------------------------

test.describe('Feed tab order', () => {
  test('Feed appears as the 3rd tab, right after Swimlanes, before Analytics', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    const labels = await page.locator('nav.tabs [role="button"], nav.tabs button').allTextContents();
    const trimmed = labels.map((l) => l.trim()).filter((l) => l.length > 0);

    expect(trimmed).toEqual(['Matrix', 'Swimlanes', 'Feed', 'Analytics']);
  });

  test('clicking the Feed tab navigates to /feed and mounts the feed shell', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    const feedOption = page.getByRole('button', { name: /^feed$/i });
    await expect(feedOption).toHaveCount(1);
    await feedOption.click();

    await page.waitForURL('**/feed', { timeout: 10_000 });
    await expect(page.locator('.feed-shell')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// B) Dock toggle + persistence
// ---------------------------------------------------------------------------

test.describe('Feed dock toggle + persistence', () => {
  test.beforeEach(async ({ page }) => {
    await resetFeedState(page);
  });

  test('dock is closed by default, opens on toggle click', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);

    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);
    await expect(dockToggleButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('open preference survives a reload', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);

    await page.reload();
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);
    await expect(dockToggleButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('closed preference survives a reload', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // Open then close, so the stored preference is explicitly 'closed'
    // rather than merely the untouched default.
    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);
    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);

    await page.reload();
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);
    await expect(dockToggleButton(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('the close (×) button inside the dock also closes it', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);

    await page.locator('.feed-dock .drawer-close').click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// C) Grouped roll-up expand/collapse
// ---------------------------------------------------------------------------

test.describe('Grouped roll-up rows', () => {
  test.beforeEach(async ({ page }) => {
    await resetFeedState(page);
  });

  test('a group row with a ×N badge expands to reveal N child rows, then collapses', async ({ page }) => {
    await openFeed(page);

    // Grouping defaults ON — assert the toggle reflects it before relying on group rows.
    await expect(page.locator('.feed-header .toggle[aria-label="Group by deployment"]')).toHaveAttribute(
      'aria-checked', 'true',
    );

    const groupRow = page.locator('.feed-row.feed-group-row').filter({ has: page.locator('.feed-count-badge') }).first();
    await expect(groupRow).toBeVisible({ timeout: 20_000 });

    const badgeText = (await groupRow.locator('.feed-count-badge').textContent())?.trim() ?? '';
    const expectedCount = Number(badgeText.replace('×', ''));
    expect(expectedCount).toBeGreaterThan(1);

    const depId = await groupRow.getAttribute('data-event-id');
    expect(depId).toBeTruthy();

    // Collapsed: no expanded detail block yet.
    await expect(page.locator('.feed-group-detail.is-expanded')).toHaveCount(0);

    await groupRow.click();

    const detail = page.locator('.feed-group-detail.is-expanded');
    await expect(detail).toHaveCount(1);
    await expect(detail.locator('.feed-row.feed-child')).toHaveCount(expectedCount);

    // Collapse again via the same row click.
    await groupRow.click();
    await expect(page.locator('.feed-group-detail.is-expanded')).toHaveCount(0);
  });

  test('the grouping toggle switches between grouped roll-up and flat chronological rows', async ({ page }) => {
    await openFeed(page);

    const groupedRowCount = await page.locator('.feed-row.feed-group-row, .feed-row:not(.feed-child)').count();

    await page.locator('.feed-header .toggle[aria-label="Group by deployment"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('.feed-header .toggle[aria-label="Group by deployment"]')).toHaveAttribute(
      'aria-checked', 'false',
    );
    // Flat mode renders one row per event with no group-only chevrons/badges.
    await expect(page.locator('.feed-chevron')).toHaveCount(0);
    await expect(page.locator('.feed-count-badge')).toHaveCount(0);

    const flatRowCount = await page.locator('.feed-row').count();
    expect(flatRowCount).toBeGreaterThanOrEqual(groupedRowCount);
  });
});

// ---------------------------------------------------------------------------
// D) Infinite scroll
// ---------------------------------------------------------------------------

test.describe('Infinite scroll', () => {
  test.beforeEach(async ({ page }) => {
    await resetFeedState(page);
  });

  test('scrolling near the bottom of .feed-log loads the next cursor page', async ({ page }) => {
    await openFeed(page);

    const initialCount = await page.locator('.feed-row').count();
    expect(initialCount).toBeGreaterThan(0);

    const nextPageRequest = page.waitForRequest(
      (req) => req.url().includes('/api/deployments') && req.url().includes('cursor='),
      { timeout: 15_000 },
    );

    await page.locator('.feed-log').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });

    await nextPageRequest;
    await page.waitForTimeout(500);

    const grownCount = await page.locator('.feed-row').count();
    expect(grownCount).toBeGreaterThan(initialCount);
  });

  test('scrolling to the very end of a fixed 58-event fixture reaches end-of-history', async ({ page }) => {
    await openFeed(page);

    // Flatten so row count maps 1:1 to loaded events (grouping collapses rows).
    await page.locator('.feed-header .toggle[aria-label="Group by deployment"]').click();
    await page.waitForTimeout(200);

    for (let i = 0; i < 5; i++) {
      const reachedEnd = await page.locator('.feed-end').count();
      if (reachedEnd > 0) break;
      await page.locator('.feed-log').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll'));
      });
      await page.waitForTimeout(700);
    }

    await expect(page.locator('.feed-end')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.feed-loading')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// E) Search narrowing
// ---------------------------------------------------------------------------

test.describe('Search narrowing', () => {
  test.beforeEach(async ({ page }) => {
    await resetFeedState(page);
  });

  test('typing a known service name narrows rows to matches only, updating the subtitle', async ({ page }) => {
    await openFeed(page);

    // Flatten so every visible row is a single event.
    await page.locator('.feed-header .toggle[aria-label="Group by deployment"]').click();
    await page.waitForTimeout(200);

    const unfilteredSub = await page.locator('.feed-sub').textContent();

    await page.locator('.feed-search').fill('payments-api');
    await page.waitForTimeout(600); // 300ms debounce + request round trip

    await expect(page.locator('.feed-sub')).not.toHaveText(unfilteredSub ?? '');
    const sub = (await page.locator('.feed-sub').textContent()) ?? '';
    expect(sub).toContain('matching "payments-api"');

    const rows = page.locator('.feed-row:not(.feed-child)');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    const services = await rows.locator('.feed-service').allTextContents();
    for (const svc of services) {
      expect(svc).toContain('payments-api');
    }
  });

  test('a query matching nothing shows the no-matching-events end state', async ({ page }) => {
    await openFeed(page);

    await page.locator('.feed-search').fill('zzz-no-such-deployment-substring-xyz');
    await page.waitForTimeout(600);

    await expect(page.locator('.feed-end')).toHaveText(/no matching deployment events/i);
    await expect(page.locator('.feed-row')).toHaveCount(0);
  });

  test('clearing the search restores the unfiltered listing', async ({ page }) => {
    await openFeed(page);

    await page.locator('.feed-search').fill('zzz-no-such-deployment-substring-xyz');
    await page.waitForTimeout(600);
    await expect(page.locator('.feed-row')).toHaveCount(0);

    await page.locator('.feed-search').fill('');
    await page.waitForTimeout(600);

    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// F) Dock suppression on the Feed view
// ---------------------------------------------------------------------------

test.describe('Dock suppression on the Feed view', () => {
  test.beforeEach(async ({ page }) => {
    await resetFeedState(page);
  });

  test('dock stays open while browsing Matrix, but is suppressed (no .is-open) on /feed', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);

    await page.goto('/feed');
    await page.waitForSelector('.feed-shell', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // Still mounted, but not visible — suppressed, not removed.
    await expect(page.locator('.feed-dock')).toHaveCount(1);
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);
  });

  test('the topbar dock toggle is disabled while on the Feed view', async ({ page }) => {
    await openFeed(page);
    await expect(dockToggleButton(page)).toBeDisabled();
  });

  test('leaving the Feed view restores the dock to its stored open preference', async ({ page }) => {
    await page.goto('/matrix');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    await dockToggleButton(page).click();
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);

    await page.goto('/feed');
    await page.waitForSelector('.feed-shell', { timeout: 20_000 });
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(0);

    await page.goto('/swimlanes');
    await page.waitForSelector('app-root', { timeout: 20_000 });
    await page.waitForTimeout(300);

    // Suppression only applied while /feed was active — the untouched
    // dockOpenPref (still true) is restored on any other view.
    await expect(page.locator('.feed-dock.is-open')).toHaveCount(1);
  });
});
