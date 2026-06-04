/**
 * MatrixTileComponent — unit tests.
 *
 * Spec: docs/design/components.md §Matrix Tile + §6 Box States
 *
 * Critical regression: a slot with current.status='failure' and no
 * last_successful must render as a non-split failed (S4) tile — NOT an
 * in-progress spinner tile. Covers the isSplit + isRunning guards.
 */
import { NO_ERRORS_SCHEMA }  from '@angular/core';
import { TestBed }           from '@angular/core/testing';
import { By }                from '@angular/platform-browser';

import { MatrixTileComponent }              from './matrix-tile.component';
import { DeploymentEvent, MatrixSlot }      from '../../../core/models/deployment.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvent(
  status: DeploymentEvent['status'],
  overrides: Partial<DeploymentEvent> = {},
): DeploymentEvent {
  return {
    id:            'evt-1',
    deployment_id: 'dep-1',
    service:       'svc-a',
    environment:   'production',
    version:       'v1.2.3',
    status,
    happened_at:   '2026-06-04T10:00:00Z',
    ...overrides,
  };
}

/** Accessor for a protected computed/method via type escape. */
function priv(c: MatrixTileComponent): {
  boxState(): string;
  isSplit():  boolean;
  isRunning(): boolean;
  lastSucc():  DeploymentEvent | undefined;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return c as any;
}

// ── TestBed factory ───────────────────────────────────────────────────────────

async function createTile(slot: MatrixSlot) {
  await TestBed.configureTestingModule({
    imports: [MatrixTileComponent],
    // Suppress pipe/child resolution errors; we test component logic only.
    schemas: [NO_ERRORS_SCHEMA],
  }).compileComponents();

  const fixture = TestBed.createComponent(MatrixTileComponent);
  fixture.componentRef.setInput('slot', slot);
  fixture.detectChanges();
  return fixture;
}

// ── S4 failure — no last_successful (bug-fix regression) ─────────────────────

describe('MatrixTileComponent — failure with no last_successful (bug fix)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('boxState is s-fail-last (NOT s-running-only)', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-fail-last');
    expect(priv(fixture.componentInstance).boxState()).not.toBe('s-running-only');
  });

  it('isRunning() is false — no spinner for a failed slot', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isRunning()).toBe(false);
  });

  it('isSplit is false — no bottom section when last_successful is absent', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isSplit()).toBe(false);
  });

  it('the root .slot element carries class s-fail-last', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['s-fail-last']).toBe(true);
  });

  it('the root .slot element does NOT carry class s-running-only', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['s-running-only']).toBeFalsy();
  });

  it('no spinner element is rendered', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    const spinner = fixture.debugElement.query(By.css('.spinner'));
    expect(spinner).toBeNull();
  });

  it('no tile-divider (split bottom section) is rendered', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    const divider = fixture.debugElement.query(By.css('.tile-divider'));
    expect(divider).toBeNull();
  });

  it('the Failed badge IS rendered', async () => {
    const slot: MatrixSlot = { current: mkEvent('failure') };
    const fixture = await createTile(slot);
    const badge = fixture.debugElement.query(By.css('.failed-tag'));
    expect(badge).not.toBeNull();
    expect(badge.nativeElement.textContent.trim()).toBe('Failed');
  });
});

// ── S4 failure — WITH last_successful (split tile; existing behaviour) ────────

describe('MatrixTileComponent — failure with last_successful (S4 split, existing)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('isSplit is true when last_successful is present', async () => {
    const slot: MatrixSlot = {
      current:         mkEvent('failure'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2', run_url: 'https://ci/runs/99', run_number: '99' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isSplit()).toBe(true);
  });

  it('isRunning() is still false for a failure slot with last_successful', async () => {
    const slot: MatrixSlot = {
      current:         mkEvent('failure'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isRunning()).toBe(false);
  });
});

// ── S2: in-progress + last_successful — isSplit stays true ───────────────────

describe('MatrixTileComponent — S2 in-progress + last_successful (no regression)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('isSplit is true for s-run-last (last_successful present)', async () => {
    const slot: MatrixSlot = {
      current:         mkEvent('in-progress'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-run-last');
    expect(priv(fixture.componentInstance).isSplit()).toBe(true);
  });

  it('isRunning() is true for s-run-last', async () => {
    const slot: MatrixSlot = {
      current:         mkEvent('in-progress'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isRunning()).toBe(true);
  });
});

// ── S3: in-progress + last_successful + prev_failed — isSplit stays true ─────

describe('MatrixTileComponent — S3 in-progress + last_successful + prev_failed (no regression)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('isSplit is true for s-run-fail-last (last_successful present)', async () => {
    const slot: MatrixSlot = {
      current:         mkEvent('in-progress'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
      prev_failed:     true,
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-run-fail-last');
    expect(priv(fixture.componentInstance).isSplit()).toBe(true);
  });
});

// ── S5: in-progress, no last_successful — no split, spinner visible ───────────

describe('MatrixTileComponent — S5 in-progress only (no regression)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('isSplit is false for s-running-only', async () => {
    const slot: MatrixSlot = { current: mkEvent('in-progress') };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-running-only');
    expect(priv(fixture.componentInstance).isSplit()).toBe(false);
  });

  it('isRunning() is true for s-running-only', async () => {
    const slot: MatrixSlot = { current: mkEvent('in-progress') };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).isRunning()).toBe(true);
  });
});
