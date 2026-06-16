import { defineConfig, devices } from '@playwright/test';
import { pathToFileURL } from 'url';
import path from 'path';

/**
 * Absolute file:// URL to the design mockup.
 * Exported so tests can import it directly from this config rather than
 * re-computing the path independently.
 */
export const MOCKUP_URL = pathToFileURL(
  path.resolve(__dirname, '../../docs/design/mockup/index.html'),
).href;

export default defineConfig({
  testDir: './tests',

  /** Per-test timeout — includes page load + JS layout passes. */
  timeout: 30_000,

  /** No automatic retries — tests must be deterministic. */
  retries: 0,

  use: {
    /** 1600×1200 matches the reference viewport used in existing capture scripts. */
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
  },

  /**
   * webServer array: starts mock backend + Angular app for the live-app project.
   * reuseExistingServer: !CI means local runs reuse already-running servers,
   * CI always does a fresh boot.
   */
  webServer: [
    {
      command: 'npm --prefix ../../frontend/mock run start:dev',
      url: 'http://localhost:3002/readyz',
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    {
      command: 'npm --prefix ../../frontend/dashboard start',
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],

  projects: [
    /**
     * mockup — file:// tests against the static design mockup.
     * These tests navigate to MOCKUP_URL directly and do NOT use baseURL.
     * The webServer block runs regardless; that is acceptable overhead.
     */
    {
      name: 'mockup',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /mockup-.*\.spec\.ts|overlap-invariants\.spec\.ts/,
    },

    /**
     * live-app — tests against the running Angular SPA at http://localhost:4200.
     * baseURL is set so tests can use page.goto('/') instead of full URLs.
     */
    {
      name: 'live-app',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4200',
      },
      testMatch: /app-.*\.spec\.ts/,
    },
  ],
});
