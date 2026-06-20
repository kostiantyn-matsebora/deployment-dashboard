/**
 * Extension test fixtures.
 *
 * Launches the runner's system Google Chrome (channel: 'chrome') via launchPersistentContext
 * with the built, unpacked MV3 extension loaded.  Resolves the extension id from the
 * registered service worker, then navigates the options page to configure the mock
 * backend URL (http://localhost:3002).
 *
 * channel: 'chrome' uses the OS-installed Google Chrome (preinstalled on ubuntu-latest
 * GitHub runners), avoiding the unreliable Playwright CDN download.  MV3 extension
 * loading via --load-extension works the same on branded Chrome.
 *
 * All extension tests extend the `extensionTest` fixture exported from this file.
 */

import { test as base, BrowserContext, chromium, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const MOCK_URL = 'http://localhost:3002';
const EXTENSION_DIST = path.resolve(__dirname, '../../../../frontend/extension/dist');

export interface ExtensionFixtures {
  /** A Chrome persistent context with the extension loaded. */
  context: BrowserContext;
  /** The resolved chrome-extension:// ID. */
  extensionId: string;
  /** Options page (chrome-extension://<id>/options.html). */
  optionsPage: Page;
  /** Popup page (chrome-extension://<id>/popup.html). */
  popupPage: Page;
}

/**
 * Resolve the extension id by polling the service worker list on the
 * background page until we see the extension's service worker.
 * Chromium may take a few hundred ms to register it.
 */
async function resolveExtensionId(context: BrowserContext): Promise<string> {
  // Wait for the extension's service worker to appear.
  for (let attempt = 0; attempt < 40; attempt++) {
    const workers = context.serviceWorkers();
    for (const worker of workers) {
      const url = worker.url();
      if (url.startsWith('chrome-extension://')) {
        // URL format: chrome-extension://<id>/background.js
        const match = url.match(/chrome-extension:\/\/([a-z]+)\//);
        if (match) return match[1];
      }
    }
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  throw new Error('Could not resolve extension id — service worker did not register within 10 s');
}

/**
 * Configure the extension via the real options page.
 * Sets Dashboard URL to MOCK_URL and saves the settings.
 * This exercises the persistence path and is the canonical way to supply
 * the backend URL to the extension (no mocks, no storage overrides).
 */
async function configureViaOptionsPage(page: Page): Promise<void> {
  // Wait for the options page JS to finish initialising.
  await page.waitForSelector('#input-url', { timeout: 15_000 });
  // Wait for init() to resolve getSettings() before filling the input, so the
  // value we write is not overwritten by a late async storage read.
  await page.waitForFunction(
    () => (document.getElementById('input-url') as HTMLInputElement | null)?.value !== undefined,
    { timeout: 5_000 },
  );

  // Fill the dashboard URL and submit.
  await page.fill('#input-url', MOCK_URL);
  await page.click('#btn-save');

  // Wait for 'Saved.' confirmation to appear.
  await page.waitForFunction(
    () => (document.getElementById('save-status')?.textContent ?? '').includes('Saved'),
    { timeout: 5_000 },
  );
}

export const extensionTest = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // Each test run gets its own temporary user-data-dir so storage is isolated.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: true,
      args: [
        `--disable-extensions-except=${EXTENSION_DIST}`,
        `--load-extension=${EXTENSION_DIST}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    await use(context);
    await context.close();

    // Clean up temp user data dir.
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  },

  extensionId: async ({ context }, use) => {
    const id = await resolveExtensionId(context);
    await use(id);
  },

  optionsPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await configureViaOptionsPage(page);
    await use(page);
    await page.close();
  },

  popupPage: async ({ context, extensionId, optionsPage: _ }, use) => {
    // optionsPage is declared as a dependency so that the URL is always configured
    // before the popup is opened.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Wait for the popup container to be attached, which confirms JS has loaded
    // and the DOM is ready.  State panels are always present in the DOM (some
    // hidden), so we wait for the popup root element to be attached rather than
    // waiting for a specific panel to be visible (all panels may be hidden
    // while the initial async render pass completes).
    await page.waitForSelector('#state-loading', { state: 'attached', timeout: 10_000 });
    await use(page);
    await page.close();
  },
});

export const { expect } = extensionTest;

/** Helpers used across multiple extension specs */

/** MOCK_URL exported so specs can construct API endpoints if needed */
export const MOCK_BASE = MOCK_URL;

/**
 * Reset the mock store to its deterministic state via POST /_mock/reset.
 * Call at the start of tests that seed their own data.
 */
export async function resetMock(): Promise<void> {
  const res = await fetch(`${MOCK_URL}/_mock/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`_mock/reset failed: ${res.status}`);
}

/**
 * Post a deployment event to the mock via POST /api/deployments.
 * Returns the created event (wire shape).
 */
export async function postDeployment(event: {
  deployment_id: string;
  service: string;
  environment: string;
  status: string;
  happened_at: string;
  version?: string;
  run_url?: string;
  run_number?: string;
  actor?: string;
}): Promise<{ id: string; service: string; environment: string; status: string; [k: string]: unknown }> {
  const res = await fetch(`${MOCK_URL}/api/deployments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env['API_KEY'] ?? 'dev-secret',
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /api/deployments failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<{ id: string; service: string; environment: string; status: string; [k: string]: unknown }>;
}
