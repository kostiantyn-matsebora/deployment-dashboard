// Implements testing/e2e/scenarios/discovery-no-hardcoding.md
//
// Validates GET /api/environments and GET /api/services return derived
// (not hardcoded) lists and that introducing a brand-new
// (service, environment) pair via POST flows through to discovery and to
// the matrix header.

import { test, expect, request as playwrightRequest } from '@playwright/test';
import { READ_BASE_URL, WRITE_BASE_URL, API_KEY, runSuffix, buildDeploymentPayload } from './support/env';

const SEEDED_ENVIRONMENTS = ['dev', 'qa', 'uat'] as const;
const SEEDED_SERVICES = ['service-a', 'service-b', 'service-c', 'service-d'] as const;

test('Environments and services are discovered from stored data, not hardcoded', async ({ page }) => {
  const readApi = await playwrightRequest.newContext({ baseURL: READ_BASE_URL });

  // ----- Baseline discovery from the seed corpus -----
  const envsResp = await readApi.get('/api/environments');
  expect(envsResp.status()).toBe(200);
  const envs: string[] = await envsResp.json();
  expect(Array.isArray(envs)).toBe(true);
  for (const e of SEEDED_ENVIRONMENTS) {
    expect(envs).toContain(e);
  }

  const servicesResp = await readApi.get('/api/services');
  expect(servicesResp.status()).toBe(200);
  const services: string[] = await servicesResp.json();
  expect(Array.isArray(services)).toBe(true);
  for (const s of SEEDED_SERVICES) {
    expect(services).toContain(s);
  }

  // SPA shows discovered environments in the matrix. The deferred Matrix
  // layout uses env-header-{id} column headers; the current active layouts
  // (swim-lane, workflow-rows) show environments inline as env-tag spans.
  // We verify env discovery by checking that known stage-boxes from the seed
  // corpus are rendered for seeded (service, environment) pairs:
  //   dev  — service-b/dev (success), service-a/dev (in-progress)
  //   qa   — service-b/qa (failure)
  //   uat  — service-d/uat (in-progress)
  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
  await expect(page.getByTestId('stage-box-service-b-dev')).toHaveCount(1);
  await expect(page.getByTestId('stage-box-service-b-qa')).toHaveCount(1);
  await expect(page.getByTestId('stage-box-service-d-uat')).toHaveCount(1);

  // ----- Introduce a brand-new (service, environment) -----
  const suffix = runSuffix();
  const NEW_SERVICE = 'qa-bot-discovery';
  const NEW_ENV = 'e2e-discovery-env';

  const writeApi = await playwrightRequest.newContext({
    baseURL: WRITE_BASE_URL,
    extraHTTPHeaders: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  });

  const postResp = await writeApi.post('/api/deployments', {
    data: buildDeploymentPayload({
      service: NEW_SERVICE,
      environment: NEW_ENV,
      version: `v0.${suffix}`,
      status: 'success',
      run_url: 'https://example.com/runs/discovery',
      run_number: 90002,
    }),
  });
  expect(postResp.status()).toBe(201);

  // Discovery endpoints reflect the addition within the NFR-03 5 s budget
  // (LISTEN/NOTIFY + Distinct query is effectively instantaneous, but we
  // poll to absorb container scheduling jitter).
  await expect.poll(async () => {
    const r = await readApi.get('/api/environments');
    const list: string[] = await r.json();
    return list.includes(NEW_ENV);
  }, { timeout: 5_000 }).toBe(true);

  await expect.poll(async () => {
    const r = await readApi.get('/api/services');
    const list: string[] = await r.json();
    return list.includes(NEW_SERVICE);
  }, { timeout: 5_000 }).toBe(true);

  // SPA gets the new (service, env) slot via the SSE-driven re-render and
  // shows the new stage-box within the NFR-03 5 s budget.
  await expect(page.getByTestId(`stage-box-${NEW_SERVICE}-${NEW_ENV}`)).toBeVisible({ timeout: 5_000 });

  await readApi.dispose();
  await writeApi.dispose();
});
