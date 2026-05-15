// Implements testing/e2e/scenarios/auth-write-rejection.md
//
// Validates FR-10 + SAD §7 REST constraints: unauthenticated /
// unauthorised writes return 401 with the documented error body, no
// matrix row appears, and no SSE event is emitted.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { READ_BASE_URL, WRITE_BASE_URL } from './support/env';

const SERVICE = 'qa-bot-401-reject';
const ENV = 'e2e-rejected';

const VALID_PAYLOAD = {
  service: SERVICE,
  environment: ENV,
  version: 'v0.0.1',
  status: 'success',
  run_url: 'https://example.com/runs/401-reject',
  run_number: 90003,
  actor: 'qa.bot',
};

test('Writes without a valid X-Api-Key are rejected and produce no matrix update', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  // Sanity: target slot is absent before the test.
  await expect(page.getByTestId(`stage-box-${SERVICE}-${ENV}`)).toHaveCount(0);

  // --- Missing API key entirely ---
  const noKey = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });
  const respNoKey = await noKey.post('/api/deployments', { data: VALID_PAYLOAD });
  expect(respNoKey.status()).toBe(401);
  const bodyNoKey = await respNoKey.json();
  expect(bodyNoKey.error).toBe('Missing X-Api-Key header.');

  // --- Wrong API key ---
  const wrongKey = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      'X-Api-Key': 'obviously-wrong',
    },
  });
  const respWrong = await wrongKey.post('/api/deployments', { data: VALID_PAYLOAD });
  expect(respWrong.status()).toBe(401);
  const bodyWrong = await respWrong.json();
  expect(bodyWrong.error).toBe('Invalid API key.');

  // Wait 3 s (well below NFR-03's 5 s budget) — no SSE event should
  // arrive because no row was inserted, so the matrix DOM must remain
  // free of the rejected slot.
  await page.waitForTimeout(3_000);
  await expect(page.getByTestId(`stage-box-${SERVICE}-${ENV}`)).toHaveCount(0);

  // Read API confirms no history row was persisted.
  const readApi = await playwrightRequest.newContext({ baseURL: READ_BASE_URL });
  const history = await readApi.get(`/api/deployments/${SERVICE}/${ENV}/history`);
  expect(history.status()).toBe(404);

  await noKey.dispose();
  await wrongKey.dispose();
  await readApi.dispose();
});
