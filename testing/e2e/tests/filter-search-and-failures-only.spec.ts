// Implements testing/e2e/scenarios/filter-search-and-failures-only.md
//
// Verifies the header's search input + "Failures only" toggle filter the
// matrix as the mockup's filteredServices() getter prescribes, including
// the empty-state when filters match nothing.

import { test, expect } from '@playwright/test';

const SEEDED_SERVICES = ['service-a', 'service-b', 'service-c', 'service-d'] as const;
// Per docs/ui/deployment-dashboard.html `filteredServices` getter, the
// "Failures only" toggle keeps a service iff some env has
// `current.status === 'failure'`. `previousFailed === true` on an
// in-progress slot does NOT count. In the seeded corpus only
// `service-b/qa` has `current.status === 'failure'`.
const SERVICES_WITH_FAILURES = ['service-b'] as const;

test.describe('Header filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('pipeline-matrix')).toBeVisible();
    // Every seeded service is rendered on first paint.
    for (const id of SEEDED_SERVICES) {
      await expect(page.getByTestId(`service-row-${id}`)).toBeVisible();
    }
  });

  test('Search filter narrows to the matching service (case-insensitive)', async ({ page }) => {
    const search = page.getByTestId('search-input');

    // Seeded service names use hyphens (service-a, service-b, …) per
    // testing/fixtures/seed-data.json. The search filter is a
    // case-insensitive substring match on the literal service name
    // (mockup §filteredServices), so the query must contain the
    // hyphen to match.
    await search.fill('service-a');
    await expect(page.getByTestId('service-row-service-a')).toBeVisible();
    await expect(page.getByTestId('service-row-service-b')).toHaveCount(0);
    await expect(page.getByTestId('service-row-service-c')).toHaveCount(0);
    await expect(page.getByTestId('service-row-service-d')).toHaveCount(0);

    await search.fill('');
    await search.fill('SERVICE-B');
    await expect(page.getByTestId('service-row-service-b')).toBeVisible();
    await expect(page.getByTestId('service-row-service-a')).toHaveCount(0);

    await search.fill('');
    for (const id of SEEDED_SERVICES) {
      await expect(page.getByTestId(`service-row-${id}`)).toBeVisible();
    }
  });

  test('Failures-only toggle narrows to services with at least one failure', async ({ page }) => {
    const toggle = page.getByTestId('failures-only-toggle');

    await toggle.check();
    for (const id of SERVICES_WITH_FAILURES) {
      await expect(page.getByTestId(`service-row-${id}`)).toBeVisible();
    }
    // service-a, service-c, and service-d have no slot with
    // `current.status === 'failure'` in the seeded corpus.
    // (service-d has an in-progress slot with
    // `previousFailed: true`, which the mockup's filter intentionally
    // does NOT count.)
    await expect(page.getByTestId('service-row-service-a')).toHaveCount(0);
    await expect(page.getByTestId('service-row-service-c')).toHaveCount(0);
    await expect(page.getByTestId('service-row-service-d')).toHaveCount(0);

    await toggle.uncheck();
    for (const id of SEEDED_SERVICES) {
      await expect(page.getByTestId(`service-row-${id}`)).toBeVisible();
    }
  });

  test('Combination that matches nothing reveals the empty state', async ({ page }) => {
    await page.getByTestId('search-input').fill('zzz-no-such-service');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    // No service rows rendered.
    const rows = page.locator('[data-testid^="service-row-"]');
    await expect(rows).toHaveCount(0);
  });
});
