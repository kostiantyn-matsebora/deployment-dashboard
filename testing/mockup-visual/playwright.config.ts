// Playwright config — mockup-visual harness.
//
// Owner: qa-engineer (.claude/agents/qa-engineer.md).
//
// This harness is INDEPENDENT of the running stack. It loads
// docs/ui/deployment-dashboard.html directly via file:// in a real Chromium
// browser and asserts geometric invariants (no overlap, connectors reach
// their targets, env labels not clipped, etc.). It does NOT depend on
// dev_env/start.ps1.
//
// All knobs (viewport, tolerances, combination matrix, selectors) live in
// harness.config.json — per CLAUDE.md "Configuration vs. data".

import { defineConfig, devices } from '@playwright/test';
import harnessConfig from './harness.config.json';

export default defineConfig({
  testDir: '.',
  testMatch: /mockup-invariants\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  // 'list' for human; 'json' captures the per-test status for the runner's
  // pass/fail table. The harness writes its own richer report into
  // __screenshots__/_report.json — the json reporter here is just a
  // backstop so a non-zero exit code is always observable.
  reporter: [['list'], ['json', { outputFile: '__screenshots__/_playwright-report.json' }]],
  use: {
    viewport: harnessConfig.viewport,
    trace: 'retain-on-failure',
    screenshot: 'off', // the spec writes its own deterministic screenshots
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: harnessConfig.viewport },
    },
  ],
});
