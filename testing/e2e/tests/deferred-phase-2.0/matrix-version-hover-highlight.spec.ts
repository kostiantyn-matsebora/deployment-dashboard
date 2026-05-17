// Implements testing/e2e/scenarios/matrix-version-hover-highlight.md
//
// Hovers a stage box, verifies the amber-ring class is applied and that
// the stats-bar hint surfaces the hovered version. Then verifies the
// highlight is removed on mouseleave.

import { test, expect } from '@playwright/test';

const TARGET_SERVICE = 'service-b';
const TARGET_ENV = 'dev';
const TARGET_VERSION = 'v2.3.0';
// Pick any other slot for the negative control. service-d/uat
// is a known running slot from the seeded corpus.
const CONTROL_SERVICE = 'service-d';
const CONTROL_ENV = 'uat';

test('Hovering a version amber-rings the box and surfaces the stats-bar hint', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  const target = page.getByTestId(`stage-box-${TARGET_SERVICE}-${TARGET_ENV}`);
  const control = page.getByTestId(`stage-box-${CONTROL_SERVICE}-${CONTROL_ENV}`);

  await expect(target).toBeVisible();
  await expect(control).toBeVisible();

  // Sanity: hint is not present before hover.
  await expect(page.getByTestId('highlight-hint')).toHaveCount(0);

  await target.hover();

  // Hint surfaces the hovered version.
  const hint = page.getByTestId('highlight-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText(TARGET_VERSION);

  // Target box carries the amber-ring class. We poll with a small timeout
  // because the directive-driven class update propagates through the
  // store -> computed signal -> render cycle.
  await expect.poll(async () => {
    const cls = (await target.getAttribute('class')) ?? '';
    return cls.includes('ring-amber-400');
  }).toBe(true);

  // Negative control — the unrelated box is not highlighted (its
  // current.version differs from v2.3.0 and v2.3.0 is not its
  // lastSuccessful either).
  const controlClass = (await control.getAttribute('class')) ?? '';
  expect(controlClass).not.toContain('ring-amber-400');

  // mouseleave clears the highlight + hint.
  // Moving to a neutral location forces the leave to fire.
  await page.mouse.move(0, 0);

  await expect(page.getByTestId('highlight-hint')).toHaveCount(0);
  await expect.poll(async () => {
    const cls = (await target.getAttribute('class')) ?? '';
    return cls.includes('ring-amber-400');
  }).toBe(false);
});
