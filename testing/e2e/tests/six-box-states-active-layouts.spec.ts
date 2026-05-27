// Implements testing/e2e/scenarios/six-box-states-active-layouts.md
//
// Asserts all six canonical box states (data-state token, colour-family
// Tailwind token, last-successful-section presence, prev-failed-badge
// presence, current-version text) against the seeded fixture corpus in
// the active swim-lane layout.
//
// Background: the only existing six-state spec
// (testing/e2e/tests/deferred-phase-2.0/matrix-six-box-states.spec.ts)
// targets the Matrix layout, which is deferred to Phase 2.0. This spec
// fills the AC gap against the active swim-lane layout.
//
// Citations:
//   - docs/architecture.md §4 FR-01, §7 "6 box states"
//   - docs/features.md § Box states
//   - testing/fixtures/seed-data.json (six-slot corpus)
//   - NFR-QA-01 — feature-coverage completeness gate

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

// Identical corpus to deferred/matrix-six-box-states.spec.ts — fixture
// parity is intentional. If seed-data.json changes, update both together.
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

// Tailwind token sets per colour bucket — at least one must appear on the
// box element. Mirrors the token set in matrix-six-box-states.spec.ts and
// frontend/matrix/src/lib/box-styles.ts.
const COLOUR_CLASS_TOKENS: Record<BoxStateExpectation['colour'], readonly string[]> = {
  green:  ['bg-green-50',  'border-green-300'],
  red:    ['bg-red-50',    'border-red-300'],
  orange: ['bg-orange-50', 'border-orange-400', 'in-progress-box'],
};

test.describe('Six canonical box states — swim-lane layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // Swim-lane is the MVP default layout; no explicit layout switch needed.
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
    await expect(page.getByTestId('pipeline-matrix')).toHaveAttribute('data-layout', 'swim-lane');
  });

  for (const exp of EXPECTATIONS) {
    test(`${exp.service}/${exp.environment} renders state="${exp.dataState}" in swim-lane`, async ({ page }) => {
      const boxId = `stage-box-${exp.service}-${exp.environment}`;
      const box = page.getByTestId(boxId);

      await expect(box).toBeVisible();

      // data-state token must match the canonical six-state mapping.
      await expect(box).toHaveAttribute('data-state', exp.dataState);

      // Colour-bucket check — at least one of the documented Tailwind tokens
      // for the bucket must appear on the element's class attribute.
      const className = (await box.getAttribute('class')) ?? '';
      const tokens = COLOUR_CLASS_TOKENS[exp.colour];
      expect(
        tokens.some(t => className.includes(t)),
        `Box ${boxId} class "${className}" missing any of [${tokens.join(', ')}]`,
      ).toBe(true);

      // Current-version text matches the fixture's latest event.
      const versionEl = page.getByTestId(`current-version-${exp.service}-${exp.environment}`);
      await expect(versionEl).toHaveText(exp.expectedVersion);

      // last-successful split section — present iff expected.
      const lastSuccessful = box.locator('[data-testid="last-successful-section"]');
      if (exp.hasLastSuccessful) {
        await expect(lastSuccessful).toBeVisible();
      } else {
        await expect(lastSuccessful).toHaveCount(0);
      }

      // prev-failed badge — present iff expected.
      const prevFailedBadge = box.locator('[data-testid="prev-failed-badge"]');
      if (exp.hasPrevFailedBadge) {
        await expect(prevFailedBadge).toBeVisible();
      } else {
        await expect(prevFailedBadge).toHaveCount(0);
      }
    });
  }
});
