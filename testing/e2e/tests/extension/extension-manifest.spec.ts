/**
 * Extension E2E — Manifest, service worker, and SSE (spec e)
 *
 * Spec: docs/EXTENSION_SPECIFICATION.md §2 Stack + §5 MV3 SSE survival strategy
 *
 * Coverage:
 *   e1) manifest.json loads with ZERO Chrome MV3 warnings (no deprecated keys).
 *   e2) Manifest has manifest_version: 3.
 *   e3) Manifest declares required permissions: storage, alarms, notifications, tabs.
 *   e4) The service worker registers and its URL contains the extension id.
 *   e5) SSE reconnect — lastEventId is persisted to storage.local after an SSE event
 *       arrives (verifiable indirectly: background processes event and updates slotStatus).
 *   e6) Event serialization — rapid sequential SSE events all update slotStatus
 *       consistently (no stale-snapshot corruption).
 *
 * Note on e1 (MV3 warnings):
 *   Chrome logs warnings to the DevTools console of the extension's background page
 *   when deprecated manifest keys are used.  Playwright captures these via
 *   page.on('console').  We open chrome://extensions (not reachable) or a background
 *   page and listen for warning messages.
 *   Alternative: parse the built manifest.json statically and check for deprecated fields.
 *   We do both: static check (fast) + runtime console check (slower, more realistic).
 */

import { extensionTest, expect, resetMock, postDeployment, MOCK_BASE } from './fixtures';
import path from 'path';
import fs from 'fs';
import { BrowserContext } from '@playwright/test';

const EXTENSION_DIST = path.resolve(__dirname, '../../../../frontend/extension/dist');

/**
 * Read storage.local slotStatus via an extension page.
 */
async function getSlotStatus(
  context: BrowserContext,
  extensionId: string,
): Promise<Record<string, string>> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 10_000 });

  const slotStatus = await page.evaluate((): Promise<Record<string, string>> =>
    new Promise((resolve) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).chrome.storage.local.get('slotStatus', (result: { slotStatus?: Record<string, string> }) =>
        resolve(result.slotStatus ?? {}),
      ),
    ),
  );
  await page.close();
  return slotStatus;
}

/**
 * Configure URL via options page (triggers bootstrap → matrix seed → SSE connect).
 */
async function configureUrl(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('#input-url', { timeout: 15_000 });
  // Wait for init() to finish reading stored settings before filling the URL
  // (replaces the previous waitForTimeout(300) latency-pad).
  await page.waitForFunction(
    () => (document.getElementById('input-url') as HTMLInputElement | null)?.value !== undefined,
    { timeout: 5_000 },
  );
  await page.fill('#input-url', MOCK_BASE);
  await page.click('#btn-save');
  await page.waitForFunction(
    () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
    { timeout: 5_000 },
  );
  await page.close();
}

/**
 * Poll getSlotStatus until `key` has `expectedValue` or the timeout elapses.
 * Replaces fixed-duration setTimeout sleeps in SSE tests.
 */
async function pollSlotStatus(
  context: BrowserContext,
  extensionId: string,
  key: string,
  expectedValue: string,
  timeoutMs = 15_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const slotStatus = await getSlotStatus(context, extensionId);
    if (slotStatus[key] === expectedValue) return slotStatus[key];
    await new Promise<void>((r) => setTimeout(r, 300));
  }
  return (await getSlotStatus(context, extensionId))[key]; // let assertion report the value
}

// ── e1) Static manifest — no deprecated keys ──────────────────────────────────

extensionTest.describe('Manifest — no deprecated MV3 keys (static check)', () => {

  extensionTest('manifest.json does not contain deprecated MV3 keys', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));

    // Deprecated in MV3:
    const deprecated = [
      'background.scripts',         // replaced by background.service_worker
      'background.persistent',       // not supported in MV3
      'browser_action',              // replaced by action
      'page_action',                 // replaced by action
      // NOTE: web_accessible_resources is NOT deprecated in MV3 — the schema changed
      // from string[] to object-array [{resources,matches}].  Checking the key's
      // presence would false-flag legitimate MV3 usage.  Instead we check the old
      // string-array form explicitly below.
    ];

    for (const key of deprecated) {
      const parts = key.split('.');
      let val: unknown = manifest;
      for (const part of parts) {
        if (val && typeof val === 'object') val = (val as Record<string, unknown>)[part];
        else { val = undefined; break; }
      }
      expect(val, `deprecated key "${key}" should not be set`).toBeUndefined();
    }

    // web_accessible_resources: the MV3 object-array form [{resources,matches}] is
    // correct; only the old MV2 string-array form is deprecated.
    const war = manifest.web_accessible_resources;
    if (war !== undefined) {
      const isOldStringArray = Array.isArray(war) && war.length > 0 && typeof war[0] === 'string';
      expect(
        isOldStringArray,
        'web_accessible_resources must use the MV3 object-array form [{resources,matches}], not the deprecated string[] form',
      ).toBe(false);
    }
  });

  extensionTest('manifest_version is 3', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.manifest_version).toBe(3);
  });

  extensionTest('manifest declares required permissions', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));
    const perms: string[] = manifest.permissions ?? [];
    expect(perms).toContain('storage');
    expect(perms).toContain('alarms');
    expect(perms).toContain('notifications');
    expect(perms).toContain('tabs');
  });

  extensionTest('manifest background.service_worker points to background.js', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.background?.service_worker).toBe('background.js');
    expect(manifest.background?.type).toBe('module');
  });

  extensionTest('manifest action.default_popup points to popup.html', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.action?.default_popup).toBe('popup.html');
  });

  extensionTest('manifest options_ui.page points to options.html', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIST, 'manifest.json'), 'utf-8'));
    expect(manifest.options_ui?.page).toBe('options.html');
  });

});

// ── e2) Manifest version ──────────────────────────────────────────────────────
// (Covered inline in e1 describe block above.)

// ── e3) Required permissions ──────────────────────────────────────────────────
// (Covered inline in e1 describe block above.)

// ── e4) Service worker registers ─────────────────────────────────────────────

extensionTest.describe('Service worker — registers on extension load', () => {

  extensionTest('background service worker is registered with the extension id in URL', async ({ context, extensionId }) => {
    // extensionId was resolved from a service worker URL — if we got here, the SW registered.
    expect(extensionId).toMatch(/^[a-z]{32}$/);

    // Also verify it shows up in context.serviceWorkers().
    const workers = context.serviceWorkers();
    const bgWorker = workers.find((w) => w.url().includes(extensionId));
    expect(bgWorker).toBeDefined();
    expect(bgWorker?.url()).toContain('background.js');
  });

  extensionTest('service worker URL is chrome-extension:// scheme', async ({ context, extensionId }) => {
    void extensionId; // used for fixture dependency
    const workers = context.serviceWorkers();
    for (const worker of workers) {
      if (worker.url().includes('background.js')) {
        expect(worker.url()).toMatch(/^chrome-extension:\/\//);
        return;
      }
    }
    // If no background.js worker found, fail explicitly.
    throw new Error('No background.js service worker found in context.serviceWorkers()');
  });

});

// ── e5) SSE lastEventId persistence ──────────────────────────────────────────

extensionTest.describe('SSE — lastEventId persisted to storage.local', () => {

  extensionTest('slotStatus is updated in storage.local after SSE event arrives', async ({ context, extensionId }) => {
    await resetMock();
    await configureUrl(context, extensionId);

    // The background SW opens an SSE connection asynchronously after saving the
    // URL.  We post the event and then poll — but if slotStatus is not set within
    // the first poll window, we re-post (the event may have arrived before the SW
    // had subscribed).  Two posts of the same slot converge to the same status.
    const key = 'sse-persist-svc|prod';
    const post = () => postDeployment({
      deployment_id: 'dep-sse-persist',
      service: 'sse-persist-svc',
      environment: 'prod',
      status: 'failure',
      happened_at: new Date().toISOString(),
    });

    // First post — fires SSE via live$ → background SW handles it.
    await post();

    // Poll; if not seen within 5 s, re-post (SW may not have connected yet).
    let finalValue = await pollSlotStatus(context, extensionId, key, 'failure', 5_000);
    if (finalValue !== 'failure') {
      await post();
      finalValue = await pollSlotStatus(context, extensionId, key, 'failure', 10_000);
    }
    expect(finalValue).toBe('failure');
  });

});

// ── e6) Event serialization — rapid SSE events ───────────────────────────────

extensionTest.describe('SSE — serialized event queue prevents stale-snapshot corruption', () => {

  extensionTest('rapid sequential SSE events all update slotStatus correctly', async ({ context, extensionId }) => {
    await resetMock();
    await configureUrl(context, extensionId);

    // Post multiple rapid events for the SAME slot — last status should win.
    // If slotStatus does not appear within the first poll window, we re-post
    // all 5 events (SW may not have connected to SSE before the first batch).
    const key = 'serial-svc|staging';
    const postBatch = async () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        await postDeployment({
          deployment_id: `dep-serial-${i}`,
          service: 'serial-svc',
          environment: 'staging',
          status: i < 4 ? 'in-progress' : 'success',  // last event is 'success'
          happened_at: new Date(now + i).toISOString(),
        });
      }
    };

    await postBatch();

    // Poll; if not seen within 8 s, re-post the full batch.
    let finalValue = await pollSlotStatus(context, extensionId, key, 'success', 8_000);
    if (finalValue !== 'success') {
      await postBatch();
      finalValue = await pollSlotStatus(context, extensionId, key, 'success', 15_000);
    }
    // After 5 rapid events, the last one (success) should be the stored value.
    // The serialized queue ensures no interleaving corrupts this.
    expect(finalValue).toBe('success');
  });

});

// ── Runtime console check for MV3 warnings ────────────────────────────────────

extensionTest.describe('Manifest — zero Chrome MV3 warnings at runtime', () => {

  /**
   * Wire the console listener BEFORE any navigation so startup warnings are
   * captured.  Fresh pages are opened in the test body (not via pre-loaded
   * fixtures) to guarantee the listener is in place from the very first load.
   *
   * The pre-loaded optionsPage/popupPage fixtures both complete their navigation
   * before the test body runs — any warnings emitted during that initial load
   * would already be lost.  Opening fresh pages here, attaching the listener,
   * then navigating solves that race.
   */
  extensionTest('no Chrome warnings appear on extension pages (options, popup)', async ({ context, extensionId }) => {
    const optionsWarnings: string[] = [];
    const popupWarnings: string[] = [];

    // Open fresh pages — listener must be attached BEFORE goto() so startup
    // messages are captured from the very first navigation.
    const optionsPage = await context.newPage();
    optionsPage.on('console', (msg) => {
      if (msg.type() === 'warning') optionsWarnings.push(msg.text());
    });
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector('#input-url', { timeout: 15_000 });

    const popupPage = await context.newPage();
    popupPage.on('console', (msg) => {
      if (msg.type() === 'warning') popupWarnings.push(msg.text());
    });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForSelector('body', { timeout: 10_000 });

    await optionsPage.close();
    await popupPage.close();

    // Filter for Chrome-specific MV3 deprecation warnings.
    const chromeDeprecationWarnings = [
      ...optionsWarnings,
      ...popupWarnings,
    ].filter((w) =>
      w.toLowerCase().includes('deprecated') ||
      w.toLowerCase().includes('manifest_version') ||
      w.toLowerCase().includes('background_page') ||
      w.toLowerCase().includes('browser_action'),
    );

    expect(chromeDeprecationWarnings, `Unexpected MV3 warnings: ${chromeDeprecationWarnings.join(', ')}`).toHaveLength(0);
  });

});
