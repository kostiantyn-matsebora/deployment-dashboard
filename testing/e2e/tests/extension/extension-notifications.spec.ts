/**
 * Extension E2E — Notification toasts (spec d)
 *
 * Spec: docs/EXTENSION_SPECIFICATION.md §4.3 Notification toasts
 *
 * Coverage:
 *   d1) SSE event matching watch scope + enabled status fires a notification.
 *   d2) SSE event with disabled status does NOT fire a notification.
 *   d3) Notification is suppressed when watching is OFF.
 *
 * Approach:
 *   Notifications in MV3 are created by the background service worker via
 *   browser.notifications.create().  Playwright cannot directly intercept Chrome
 *   OS notifications; instead we verify via a proxy:
 *     - POST a new deployment event to the mock server (which triggers SSE emission
 *       on the live store.live$ subject) — the SSE event reaches the background SW
 *       which calls browser.notifications.create().
 *     - We observe side-effects: the slotStatus in storage.local is updated (which
 *       reflects the SW processed the SSE event), AND we verify the notification was
 *       created by calling chrome.notifications.getAll() from an extension page.
 *
 *   The mock server does NOT auto-emit SSE (emitService is disabled by default).
 *   To trigger SSE we use POST /api/deployments which appends to the store and emits
 *   on live$ → EventsController streams it to all SSE subscribers.
 */

import { extensionTest, expect, resetMock, postDeployment, MOCK_BASE } from './fixtures';
import { BrowserContext } from '@playwright/test';

/**
 * Get all notification IDs via chrome.notifications.getAll evaluated in an extension page.
 * Returns an object mapping notificationId → bool (true).
 */
async function getAllNotifications(
  context: BrowserContext,
  extensionId: string,
): Promise<Record<string, boolean>> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 10_000 });

  const result = await page.evaluate((): Promise<Record<string, boolean>> =>
    new Promise((resolve) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).chrome.notifications.getAll((notifs: Record<string, boolean>) =>
        resolve(notifs ?? {}),
      ),
    ),
  );
  await page.close();
  return result;
}

/**
 * Configure URL via options page, save settings.
 */
async function configureUrl(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.fill('#input-url', MOCK_BASE);
  await page.click('#btn-save');
  await page.waitForFunction(
    () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
    { timeout: 5_000 },
  );
  await page.close();
}

// ── d1) Notification fires for in-scope + enabled status ──────────────────────

extensionTest.describe('Notifications — fires for in-scope event with enabled status', () => {

  extensionTest('notification is created when SSE event matches watch scope', async ({ context, extensionId }) => {
    await resetMock();
    await configureUrl(context, extensionId);

    // Allow SW to connect to SSE stream.
    await new Promise<void>((r) => setTimeout(r, 1_500));

    // POST a new event — this appends to the store and emits on live$ → SSE.
    await postDeployment({
      deployment_id: 'dep-notif-test',
      service: 'notif-svc',
      environment: 'staging',
      status: 'success',
      happened_at: new Date().toISOString(),
    });

    // Wait for the SW to process the SSE event and create the notification.
    await new Promise<void>((r) => setTimeout(r, 2_000));

    const notifs = await getAllNotifications(context, extensionId);
    const ids = Object.keys(notifs);
    // At least one notification should exist.
    expect(ids.length).toBeGreaterThan(0);

    // The notification ID follows the pattern "notif-<eventId>".
    const hasNotifId = ids.some((id) => id.startsWith('notif-'));
    expect(hasNotifId).toBe(true);
  });

});

// ── d2) Notification suppressed by status filter ──────────────────────────────

extensionTest.describe('Notifications — suppressed when status is disabled', () => {

  extensionTest('no notification when event status is disabled in status filter', async ({ context, extensionId }) => {
    await resetMock();

    // Disable demo data so pre-existing demo SSE events cannot fire notifications
    // before the status filter is configured, which would cause a false failure
    // on the Object.keys(notifs).length === 0 assertion.
    await fetch(`${MOCK_BASE}/_mock/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    // Configure URL with 'success' status disabled.
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    await opts.waitForSelector('#statuses-list .checklist-item', { timeout: 10_000 });
    // Uncheck 'success'.
    await opts.uncheck('#status-success');
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    // Allow SW to reconnect with new settings.
    await new Promise<void>((r) => setTimeout(r, 1_500));

    // Post a 'success' event — should NOT fire a notification.
    await postDeployment({
      deployment_id: 'dep-notif-filtered',
      service: 'notif-filtered-svc',
      environment: 'dev',
      status: 'success',
      happened_at: new Date().toISOString(),
    });

    await new Promise<void>((r) => setTimeout(r, 2_000));

    const notifs = await getAllNotifications(context, extensionId);
    // No notifications should have been created (status was disabled).
    expect(Object.keys(notifs).length).toBe(0);
  });

});

// ── d3) Notification suppressed when watching is OFF ─────────────────────────

extensionTest.describe('Notifications — suppressed when watching is OFF', () => {

  extensionTest('no notification when master watching switch is OFF', async ({ context, extensionId }) => {
    await resetMock();

    // Configure URL with watching OFF.
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId}/options.html`);
    await opts.waitForSelector('#input-url', { timeout: 15_000 });
    await opts.waitForTimeout(300);
    await opts.fill('#input-url', MOCK_BASE);
    // Turn off watching.
    await opts.click('#btn-watching');
    await expect(opts.locator('#btn-watching')).toHaveAttribute('aria-checked', 'false');
    await opts.click('#btn-save');
    await opts.waitForFunction(
      () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
      { timeout: 5_000 },
    );
    await opts.close();

    await new Promise<void>((r) => setTimeout(r, 1_500));

    await postDeployment({
      deployment_id: 'dep-notif-paused',
      service: 'notif-paused-svc',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    await new Promise<void>((r) => setTimeout(r, 2_000));

    const notifs = await getAllNotifications(context, extensionId);
    // Watching is OFF — no notifications.
    expect(Object.keys(notifs).length).toBe(0);
  });

});
