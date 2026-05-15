// Implements testing/e2e/scenarios/sha-truncation.md
//
// SAD §7 "Attribute vocabulary" — sha row: "The SPA MAY truncate the
// rendered value for display (e.g. first 7 chars) without altering the
// underlying stored value; the full value remains in the history
// drawer." Tested as: first 7 chars + ellipsis on the grid, title
// attribute carries the full value, drawer renders the full value.

import { test, expect } from '@playwright/test';
import { WRITE_BASE_URL, API_KEY, buildDeploymentPayload, runSuffix } from './support/env';

const ELLIPSIS = '…'; // …

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
});

test('Long sha (10 chars) renders as first-7-chars + ellipsis on the grid; title carries the full value', async ({ page }) => {
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-sha').check();
  await page.getByTestId('attribute-picker').click();

  // service-b/dev: sha="9f1c0d2e8a" (10 chars, per testing/fixtures/seed-data.json).
  const sha = page.getByTestId('current-sha-service-b-dev');
  await expect(sha).toBeVisible();

  // Rendered text on the grid: first 7 chars + ellipsis.
  await expect(sha).toHaveText(`9f1c0d2${ELLIPSIS}`);

  // Length sanity (8 = 7 + 1 ellipsis char). This catches the
  // "three-ASCII-dots" pitfall — the rendered length would be 10
  // (7 + 3) instead of 8 in that case.
  const rendered = (await sha.textContent()) ?? '';
  expect(rendered.length).toBe(8);
  expect(rendered.endsWith(ELLIPSIS)).toBe(true);

  // Tooltip carries the full value.
  await expect(sha).toHaveAttribute('title', '9f1c0d2e8a');
});

test('Exactly-7-char sha renders verbatim with no ellipsis (boundary case)', async ({ page }) => {
  // POST a fresh ephemeral row with a 7-char sha. We use a unique
  // (service, environment) so the assertion is isolated from the
  // canonical corpus.
  const suffix = runSuffix();
  const service = `qa-bot-sha-7char-${suffix}`;
  const environment = 'fn-sha7';
  const SHA_7 = 'abc1234';
  const body = buildDeploymentPayload({
    service,
    environment,
    version: 'v0.0.1',
    status: 'success',
    run_url: 'https://example.com/runs/sha7',
    run_number: 900_001,
    actor: 'qa.bot',
    sha: SHA_7,
  });
  const resp = await fetch(`${WRITE_BASE_URL}/api/deployments`, {
    method: 'POST',
    headers: {
      'X-Api-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  expect(
    resp.status,
    `POST /api/deployments for the 7-char-sha row must return 201, got ${resp.status}`,
  ).toBe(201);

  // Force a reload so the SPA picks up the new row (the seeded
  // corpus exists but the SPA hasn't seen the ephemeral row yet).
  await page.reload();
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  // Select sha so the value renders.
  await page.getByTestId('attribute-picker').click();
  await page.getByTestId('attr-checkbox-sha').check();
  await page.getByTestId('attribute-picker').click();

  const anchor = page.getByTestId(`current-sha-${service}-${environment}`);
  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveText(SHA_7);
  // No ellipsis when the value is ≤ 7 chars.
  const rendered = (await anchor.textContent()) ?? '';
  expect(rendered.endsWith(ELLIPSIS)).toBe(false);
  expect(rendered.length).toBe(7);

  // Title equals the value (no truncation either way).
  await expect(anchor).toHaveAttribute('title', SHA_7);
});

test('Drawer renders the full sha value untruncated (full-attribute disclosure)', async ({ page }) => {
  // service-b/dev — 10-char sha "9f1c0d2e8a". The grid truncates;
  // the drawer must NOT.
  await page.getByTestId('stage-box-service-b-dev').click();
  await expect(page.getByTestId('history-drawer')).toBeVisible();

  await expect(page.getByTestId('drawer-current-sha')).toHaveText('9f1c0d2e8a');
});
