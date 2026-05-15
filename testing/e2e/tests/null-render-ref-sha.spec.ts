// Implements testing/e2e/scenarios/null-render-ref-sha.md
//
// SAD §7 "Null-render invariant for nullable attributes" — when the
// user selects ref or sha as a Display attribute and the underlying
// value is null/absent, the slot's render is EMPTY (no text, no
// placeholder, no literal "null" / "undefined"). The other attributes
// on the same slot continue to render normally.

import { test, expect, type Locator } from '@playwright/test';

// Regex that matches the literal token "null" or "undefined" as a
// stand-alone word. Avoids accidental matches inside semver / actor /
// version strings (e.g. "v2.3.null-test" or an actor named
// "undefined-bot" — there is no such fixture row, but the assertion
// should be precise either way).
const FORBIDDEN_LITERAL = /(^|\W)(null|undefined)(\W|$)/i;

async function assertNoForbiddenLiteral(box: Locator, label: string): Promise<void> {
  const text = (await box.textContent()) ?? '';
  expect(
    text,
    `${label}: slot must not contain the literal string 'null' or 'undefined' (SAD §7 null-render invariant). ` +
      `Got: '${text.replace(/\s+/g, ' ').trim().slice(0, 200)}'`,
  ).not.toMatch(FORBIDDEN_LITERAL);
}

async function assertEmptyOrAbsent(anchor: Locator, label: string): Promise<void> {
  // Two acceptable forms:
  //   1. The anchor is absent from the DOM (count = 0). This is the
  //      preferred shape — the SPA's x-show / *ngIf gate the entire
  //      render site.
  //   2. The anchor is present but its text is empty/whitespace-only.
  //      Allowed but suboptimal; still passes the invariant since the
  //      literal "null" never appears.
  // Either way, the literal "null" must never appear.
  const count = await anchor.count();
  if (count === 0) return;
  const text = (await anchor.textContent()) ?? '';
  expect(
    text.trim(),
    `${label}: render anchor present but must be empty (fixture stores null/absent). Got: '${text}'`,
  ).toBe('');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
});

test('Selecting `ref` does not render "null" for slots whose ref is null', async ({ page }) => {
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('6/7');
  await page.getByTestId('attribute-picker').click();

  // service-b/qa: fixture intentionally carries no ref + no sha.
  await assertEmptyOrAbsent(
    page.getByTestId('current-ref-service-b-qa'),
    'current-ref-service-b-qa (fixture: null ref)',
  );
  await assertNoForbiddenLiteral(
    page.getByTestId('stage-box-service-b-qa'),
    'stage-box-service-b-qa',
  );
  // Sanity: other attributes still render.
  await expect(page.getByTestId('current-version-service-b-qa')).toHaveText('v1.7.9');

  // service-d/uat: running-only, no ref, no sha.
  await assertEmptyOrAbsent(
    page.getByTestId('current-ref-service-d-uat'),
    'current-ref-service-d-uat (fixture: null ref)',
  );
  await assertNoForbiddenLiteral(
    page.getByTestId('stage-box-service-d-uat'),
    'stage-box-service-d-uat',
  );
  await expect(page.getByTestId('current-version-service-d-uat')).toHaveText('v4.0.4');
});

test('Selecting `sha` does not render "null" for slots whose sha is null', async ({ page }) => {
  // Pre-check ref so we can confirm selecting sha doesn't suppress
  // the unrelated ref render.
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').check();
  await page.getByTestId('attr-checkbox-sha').check();
  await expect(page.getByTestId('picker-counter')).toHaveText('7/7');
  await page.getByTestId('attribute-picker').click();

  // service-a/dev: latest event has ref="feature/login-revamp" but
  // NO sha. The ref anchor MUST render; the sha anchor MUST NOT
  // display the literal "null".
  await expect(page.getByTestId('current-ref-service-a-dev')).toHaveText('feature/login-revamp');
  await assertEmptyOrAbsent(
    page.getByTestId('current-sha-service-a-dev'),
    'current-sha-service-a-dev (fixture: null sha)',
  );
  await assertNoForbiddenLiteral(
    page.getByTestId('stage-box-service-a-dev'),
    'stage-box-service-a-dev',
  );

  // service-c/dev: running-with-prev-failed-and-last-success. Current
  // event is in-progress with neither ref nor sha; lastSuccessful is
  // v3.1.0 with neither. The intermediate failure had sha but is not
  // surfaced via current/lastSuccessful.
  await assertEmptyOrAbsent(
    page.getByTestId('current-ref-service-c-dev'),
    'current-ref-service-c-dev (fixture: null ref on current)',
  );
  await assertEmptyOrAbsent(
    page.getByTestId('current-sha-service-c-dev'),
    'current-sha-service-c-dev (fixture: null sha on current)',
  );
  await assertNoForbiddenLiteral(
    page.getByTestId('stage-box-service-c-dev'),
    'stage-box-service-c-dev',
  );
});

test('Slots that DO carry ref + sha still render correctly when both are selected (positive control)', async ({ page }) => {
  // This is the converse of the null-render invariant — verify the
  // SPA didn't over-suppress and is rendering populated values too.
  // Without this, the null-render assertions could pass on a SPA
  // that simply never renders ref/sha at all.
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-ref').check();
  await page.getByTestId('attr-checkbox-sha').check();
  await page.getByTestId('attribute-picker').click();

  // service-b/dev: BOTH populated per fixture.
  await expect(page.getByTestId('current-ref-service-b-dev')).toHaveText('main');
  const shaText = (await page.getByTestId('current-sha-service-b-dev').textContent()) ?? '';
  expect(shaText.trim().length).toBeGreaterThan(0);
  // The exact truncation is asserted by sha-truncation.spec.ts.
});
