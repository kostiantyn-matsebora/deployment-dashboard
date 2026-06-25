/**
 * Playwright configuration for the MV3 browser extension E2E suite.
 *
 * Self-bootstrapping:
 *   - globalSetup builds the unpacked extension (npm --prefix ../../frontend/extension run build)
 *     so the dist/ directory is always up-to-date before any test opens a browser.
 *   - webServer boots the mock backend on http://localhost:3002 (reuses the same entry as
 *     playwright.config.ts; the Angular SPA on :4200 is NOT needed for extension tests).
 *
 * Extension loading:
 *   A fixtures module (tests/extension/fixtures.ts) launches Chromium via
 *   launchPersistentContext with --load-extension and --disable-extensions-except so
 *   only the extension under test is loaded. Extension id is resolved from the registered
 *   service worker.
 *
 * PINNED INTERFACE — infrastructure lane depends on these names verbatim:
 *   - npm script "test:extension" in testing/e2e/package.json
 *   - this file: playwright.extension.config.ts
 */

import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests/extension',

  /** Per-test timeout — extension pages are slower to boot than a regular page. */
  timeout: 45_000,

  /** No retries — tests must be deterministic. */
  retries: 0,

  /** Extension tests MUST run serially (one persistent context per worker). */
  workers: 1,

  /** Run each spec file in isolation — a fresh persistent context per file. */
  fullyParallel: false,

  globalSetup: path.resolve(__dirname, 'tests/extension/global-setup.ts'),

  /**
   * webServer: only the mock backend is needed.
   * Reuses the same command as playwright.config.ts.
   * reuseExistingServer allows local runs to skip a cold boot when the mock is
   * already running; CI always does a fresh start.
   */
  webServer: {
    command: 'npm --prefix ../../frontend/mock run start:dev',
    url: 'http://localhost:3002/readyz',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },

  projects: [
    {
      name: 'extension',
      /**
       * Extension tests use a custom fixture that opens a launchPersistentContext
       * with the built extension loaded. No standard browser config here —
       * the fixture handles all browser launch options.
       */
      use: {
        // baseURL is set inside fixtures.ts after options-page configuration.
      },
      testMatch: /extension-.*\.spec\.ts/,
    },
  ],
});
