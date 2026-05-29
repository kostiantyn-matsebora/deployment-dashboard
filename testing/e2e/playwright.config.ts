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

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
