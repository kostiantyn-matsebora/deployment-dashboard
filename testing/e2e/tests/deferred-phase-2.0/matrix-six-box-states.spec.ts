// Implements testing/e2e/scenarios/matrix-six-box-states.md
//
// Asserts every "Expected result" from that scenario file. Fixture corpus
// comes from testing/fixtures/seed-data.json via testing/scripts/seed.ps1
// (invoked by testing/e2e/run-tests.ps1 before this suite runs).

import { test, expect } from '@playwright/test';

interface BoxStateExpectation {
  service: string;
  environment: string;
  dataState: string;
  hasLastSuccessful: boolean;
  hasPrevFailedBadge: boolean;
  expectedVersion: string;
  /** Colour bucket the box must fall into. */
  colour: 'green' | 'red' | 'orange';
}

const EXPECTATIONS: readonly BoxStateExpectation[] = [
  {
    service: 'service-b',
    environment: 'dev',
    dataState: 'success',
    hasLastSuccessful: false,
    hasPrevFailedBadge: false,
    expectedVersion: 'v2.3.0',
    colour: 'green',
  },
  {
    service: 'service-a',
    environment: 'dev',
    dataState: 'running-with-last',
    hasLastSuccessful: true,
    hasPrevFailedBadge: false,
    expectedVersion: 'v2.3.2',
    colour: 'orange',
  },
  {
    service: 'service-c',
    environment: 'dev',
    dataState: 'running-prev-failed-with-last',
    hasLastSuccessful: true,
    hasPrevFailedBadge: true,
    expectedVersion: 'v3.1.2',
    colour: 'orange',
  },
  {
    service: 'service-b',
    environment: 'qa',
    dataState: 'failed-with-last',
    hasLastSuccessful: true,
    hasPrevFailedBadge: false,
    expectedVersion: 'v1.7.9',
    colour: 'red',
  },
  {
    service: 'service-d',
    environment: 'uat',
    dataState: 'running',
    hasLastSuccessful: false,
    hasPrevFailedBadge: false,
    expectedVersion: 'v4.0.4',
    colour: 'orange',
  },
  {
    service: 'service-d',
    environment: 'dev',
    dataState: 'running-prev-failed',
    hasLastSuccessful: false,
    hasPrevFailedBadge: true,
    expectedVersion: 'v4.0.3',
    colour: 'orange',
  },
];

const COLOUR_CLASS_TOKENS: Record<BoxStateExpectation['colour'], readonly string[]> = {
  // From frontend/matrix/src/lib/box-styles.ts and the mockup's
  // getBoxClass(). We assert any one of the tokens is present rather
  // than a literal class string so a future Tailwind class addition
  // (e.g. a layout helper) doesn't break the test.
  green: ['bg-green-50', 'border-green-300'],
  red: ['bg-red-50', 'border-red-300'],
  orange: ['bg-orange-50', 'border-orange-400', 'in-progress-box'],
};

test.describe('Pipeline matrix — six canonical box states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
  });

  for (const exp of EXPECTATIONS) {
    test(`${exp.service}/${exp.environment} renders state="${exp.dataState}"`, async ({ page }) => {
      const boxId = `stage-box-${exp.service}-${exp.environment}`;
      const box = page.getByTestId(boxId);

      await expect(box).toBeVisible();

      // data-state token must match the canonical six-state mapping.
      await expect(box).toHaveAttribute('data-state', exp.dataState);

      // Colour bucket check — at least one of the documented Tailwind
      // tokens for the colour must appear on the element.
      const className = (await box.getAttribute('class')) ?? '';
      const tokens = COLOUR_CLASS_TOKENS[exp.colour];
      expect(
        tokens.some(t => className.includes(t)),
        `Box ${boxId} class "${className}" missing any of [${tokens.join(', ')}]`
      ).toBe(true);

      // Current version text matches the fixture's latest event.
      const versionEl = page.getByTestId(`current-version-${exp.service}-${exp.environment}`);
      await expect(versionEl).toHaveText(exp.expectedVersion);

      // Last-successful split section is rendered iff the fixture expects it.
      const lastSuccessful = box.locator('[data-testid="last-successful-section"]');
      if (exp.hasLastSuccessful) {
        await expect(lastSuccessful).toBeVisible();
      } else {
        await expect(lastSuccessful).toHaveCount(0);
      }

      // ⚠ prev. failed badge is rendered iff the fixture expects it.
      const prevFailedBadge = box.locator('[data-testid="prev-failed-badge"]');
      if (exp.hasPrevFailedBadge) {
        await expect(prevFailedBadge).toBeVisible();
      } else {
        await expect(prevFailedBadge).toHaveCount(0);
      }
    });
  }
});
