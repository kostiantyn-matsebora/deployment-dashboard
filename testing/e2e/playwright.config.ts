// Playwright config for the Deployment Dashboard E2E suite.
//
// Owner: qa-engineer (.claude/agents/qa-engineer.md).
//
// `baseURL` is sourced from the DASHBOARD_READ_BASE_URL env var that
// `testing/e2e/run-tests.ps1` populates from the active target config
// file under `testing/config/` (default `testing/config/local.json`).
// Per the project's "Engineering principles" (CLAUDE.md), this config
// holds no URLs / tokens of its own — they are declarative data in the
// target config file. If DASHBOARD_READ_BASE_URL is missing the suite
// fails fast with a clear message rather than silently targeting a
// wrong stack.
//
// The `webServer` block is deliberately omitted: Playwright must NOT
// start the dashboard itself; the suite runs against the existing
// Compose stack so we exercise the real binaries and the real SSE
// fan-out path. See `testing/e2e/run-tests.ps1` for the reachability
// pre-flight.

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.DASHBOARD_READ_BASE_URL;
if (baseURL === undefined || baseURL.trim() === '') {
  throw new Error(
    "DASHBOARD_READ_BASE_URL is not set. Run the suite via 'pwsh -NoProfile -File testing/e2e/run-tests.ps1' " +
      'or export the variable explicitly. See testing/config/README.md.',
  );
}

export default defineConfig({
  testDir: './tests',
  // Specs under `tests/deferred-phase-2.0/` cover layouts/features parked
  // for a future phase (e.g. the Matrix layout, removed from MVP). They
  // remain in-tree (history-preserving git mv from `tests/`) so they can
  // be reactivated by simply lifting this ignore once the phase opens.
  testIgnore: ['deferred-phase-2.0/**'],
  fullyParallel: false,            // SSE + shared DB → keep deterministic
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                       // SSE / mutating tests on one worker
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  expect: {
    // NFR-03 says 5 s end-to-end; we keep individual expect() polls a bit
    // generous so a flaky Docker host doesn't blame the SUT.
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // The non-Chromium projects are present so a developer can opt in
    // via `--project=firefox` or `--project=webkit` (or CI can fan out
    // post-MVP), but they are not part of the default zero-arg run.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /@ci-extra/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@ci-extra/,
    },
  ],
});
