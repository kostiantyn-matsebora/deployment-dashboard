// Implements testing/e2e/scenarios/full-attribute-disclosure.md
//
// Validates SAD §7 "Full-attribute disclosure rule": the history
// drawer and the Focus view's expanded rows always render every FR-02
// attribute (status, version, run, ago, actor, ref, sha) regardless of
// the matrix attribute picker — including when the picker selection is
// empty. Nullable attributes (ref, sha) honour the SAD §7 null-render
// invariant: empty render, never the literal "null".

import { test, expect, type Page } from '@playwright/test';

// FR-02 vocabulary — seven attributes after the FR-05/§10 #10 cycle.
const FR02_ATTRS = ['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha'] as const;
type Attr = (typeof FR02_ATTRS)[number];

// Subset that may render empty in the drawer when the fixture stores
// null. Used to guard the "no literal 'null' text" assertion.
const NULLABLE_ATTRS: readonly Attr[] = ['ref', 'sha'];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('view-switcher')).toBeVisible();
});

test('Drawer renders every attribute plus absolute deployed_at, regardless of Glance cap-1 picker state', async ({ page }) => {
  // Default Detailed view (5/7); skip the picker click since Detailed
  // already has the legacy 5 attributes checked.
  await page.getByTestId('view-option-glance').click();
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('1/1');
  await expect(page.getByTestId('attr-checkbox-version')).toBeChecked();
  for (const a of ['status', 'run', 'ago', 'actor', 'ref', 'sha'] as const) {
    await expect(page.getByTestId(`attr-checkbox-${a}`)).toBeDisabled();
  }
  // Close the picker so it doesn't overlap the slot click.
  await page.getByTestId('attribute-picker').click();

  // service-b/qa is in the fixture corpus with a deployed current
  // slot. Per the fixture it intentionally carries NEITHER ref nor sha
  // (legacy shape) so the drawer must surface the slot AND render it
  // empty without the literal "null".
  await page.getByTestId('stage-box-service-b-qa').click();
  await expect(page.getByTestId('history-drawer')).toBeVisible();

  for (const a of FR02_ATTRS) {
    await expect(
      page.getByTestId(`drawer-current-${a}`),
      `drawer must always render current.${a} (full-attribute disclosure rule)`,
    ).toBeVisible();
  }
  // Absolute timestamp is drawer-only.
  await expect(page.getByTestId('drawer-current-deployed-at')).toBeVisible();
  // The run link must carry an href (run_url binding from FR-02).
  await expect(page.getByTestId('drawer-current-run')).toHaveAttribute('href', /.+/);

  // Null-render invariant: ref + sha for service-b/qa render empty
  // (zero non-whitespace characters) and NEVER the literal "null".
  for (const a of NULLABLE_ATTRS) {
    const text = (await page.getByTestId(`drawer-current-${a}`).textContent()) ?? '';
    expect(
      text.trim(),
      `drawer-current-${a} for service-b/qa must render empty (fixture stores null); got '${text}'`,
    ).toBe('');
    expect(
      text.toLowerCase(),
      `drawer-current-${a} must never contain the literal string 'null' or 'undefined' (SAD §7 null-render invariant)`,
    ).not.toMatch(/(^|\W)(null|undefined)(\W|$)/);
  }
});

test('Drawer renders ref + full sha (no truncation) when fixture populates them', async ({ page }) => {
  // service-b/dev fixture carries ref="main" and sha="9f1c0d2e8a".
  // The drawer must surface BOTH values verbatim — the matrix grid
  // MAY truncate sha, the drawer MUST NOT (full-attribute disclosure).
  await page.goto('/');
  await expect(page.getByTestId('pipeline-matrix')).toBeVisible();

  await page.getByTestId('stage-box-service-b-dev').click();
  await expect(page.getByTestId('history-drawer')).toBeVisible();

  await expect(page.getByTestId('drawer-current-ref')).toHaveText('main');
  // Full sha — not shortSha. If this assertion fails because only the
  // first 7 chars are visible, the drawer is leaking the matrix-grid
  // truncation into the full-fidelity surface — a regression of the
  // SAD §7 "Full-attribute disclosure rule".
  await expect(page.getByTestId('drawer-current-sha')).toHaveText('9f1c0d2e8a');
});

test('Focus expanded row renders every attribute even with the picker emptied', async ({ page }) => {
  await page.getByTestId('view-option-focus').click();
  await page.getByTestId('attribute-picker').click();
  await expect(page.getByTestId('picker-counter')).toHaveText('4/5');

  // Empty the picker; legitimate per SAD load-time hardening rules.
  for (const a of ['status', 'version', 'run', 'ago'] as const) {
    await page.getByTestId(`attr-checkbox-${a}`).uncheck();
  }
  await expect(page.getByTestId('picker-counter')).toHaveText('0/5');
  const stored = await page.evaluate(() => localStorage.getItem('dashboard.attrs.focus'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored!)).toEqual([]);

  // Close the picker so chevron interactions are not obscured.
  await page.getByTestId('attribute-picker').click();

  // Expand service-a and verify every FR-02 attribute renders for
  // every environment slot inside the expanded row.
  await page.getByTestId('focus-row-expand-service-a').click();
  const expandedRow = page.getByTestId('focus-row-service-a');
  await expect(expandedRow).toHaveAttribute('data-expanded', 'true');

  // Discover the environment ids by inspecting the stage-boxes nested
  // under service-a — the matrix renders every (service, env)
  // combination, so this is data-driven rather than hardcoded.
  const envs = await discoverEnvironmentsForService(page, 'service-a');
  expect(envs.length, 'service-a must have at least one environment in the fixture').toBeGreaterThan(0);

  for (const env of envs) {
    for (const attr of FR02_ATTRS) {
      const testid = `focus-expanded-${attr}-service-a-${env}`;
      await expect(
        page.getByTestId(testid),
        `expanded Focus row must render ${attr} for service-a/${env} regardless of empty picker`,
      ).toBeVisible();
      // For nullable attributes, when the fixture stores null the
      // render is empty (text "") — NEVER the literal "null".
      if (NULLABLE_ATTRS.includes(attr as Attr)) {
        const text = (await page.getByTestId(testid).textContent()) ?? '';
        expect(
          text.toLowerCase(),
          `${testid} must never contain the literal string 'null' (SAD §7 null-render invariant)`,
        ).not.toMatch(/(^|\W)(null|undefined)(\W|$)/);
      }
    }
  }
});

async function discoverEnvironmentsForService(page: Page, service: string): Promise<string[]> {
  // The matrix exposes one stage-box per (service, env), INCLUDING
  // empty cells for envs the service has never been deployed to (per
  // FR-09 the matrix is rectangular over all known envs). The
  // expanded-row attribute assertions only make sense where the slot
  // is actually populated — empty cells have no `current` and render
  // placeholder content. We therefore filter to stage-boxes with a
  // non-empty `data-state` token (one of: success, running, failed,
  // running-prev-failed, failed-with-last, running-with-last,
  // running-prev-failed-last). The 'empty' token is excluded.
  const handles = await page.locator(`[data-testid^="stage-box-${service}-"]`).all();
  const prefix = `stage-box-${service}-`;
  const envs: string[] = [];
  for (const h of handles) {
    const id = await h.getAttribute('data-testid');
    if (!id || !id.startsWith(prefix)) continue;
    const state = await h.getAttribute('data-state');
    if (!state || state === 'empty') continue;
    envs.push(id.slice(prefix.length));
  }
  return Array.from(new Set(envs));
}
