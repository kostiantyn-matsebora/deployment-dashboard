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
import { DeploymentEvent, MatrixSlot, Status } from '../../../core/models/deployment.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvent(
  status: Status,
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
  ctxStatus(): string | null;
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

// ── Context statuses — ctx-badge rendering via slot.next (#268) ───────────────

const CTX_STATUSES: Status[] = ['pending', 'queued', 'waiting', 'cancelled', 'rejected'];

/**
 * Build a slot with a success current + a next context event.
 * slot.next carries the context status; current stays as success.
 */
function mkCtxSlot(status: Status, version?: string): MatrixSlot {
  return {
    current: mkEvent('success'),
    next: mkEvent(status, { id: 'ctx-1', deployment_id: 'ctx-dep-1', version }),
  };
}

describe('MatrixTileComponent — context statuses render a ctx-badge (slot.next)', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const status of CTX_STATUSES) {
    describe(`status = ${status}`, () => {
      it(`ctxStatus() returns '${status}'`, async () => {
        const fixture = await createTile(mkCtxSlot(status));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((fixture.componentInstance as any).ctxStatus()).toBe(status);
      });

      it('renders a .ctx-badge element with correct class', async () => {
        const fixture = await createTile(mkCtxSlot(status));
        const badge = fixture.debugElement.query(By.css(`.ctx-badge.cb-${status}`));
        expect(badge).not.toBeNull();
      });

      it('does NOT render a spinner (primary state is success, not running)', async () => {
        const fixture = await createTile(mkCtxSlot(status));
        const spinner = fixture.debugElement.query(By.css('.spinner'));
        expect(spinner).toBeNull();
      });

      it('isRunning() is false (primary current is success)', async () => {
        const fixture = await createTile(mkCtxSlot(status));
        expect(priv(fixture.componentInstance).isRunning()).toBe(false);
      });

      it('boxState is s-success (primary current.status = success)', async () => {
        const fixture = await createTile(mkCtxSlot(status));
        expect(priv(fixture.componentInstance).boxState()).toBe('s-success');
        const el = fixture.debugElement.query(By.css('.slot'));
        expect(el.classes['s-success']).toBe(true);
      });
    });
  }
});

describe('MatrixTileComponent — ctx-badge shows version from slot.next', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('ctx-badge renders the next version when slot.next has one', async () => {
    const fixture = await createTile(mkCtxSlot('pending', 'v2.16.0-rc1'));
    const badge = fixture.debugElement.query(By.css('.ctx-badge.cb-pending'));
    expect(badge).not.toBeNull();
    expect(badge.nativeElement.textContent).toContain('v2.16.0-rc1');
  });

  it('ctx-badge renders without version when slot.next has none', async () => {
    const fixture = await createTile(mkCtxSlot('rejected'));
    const badge = fixture.debugElement.query(By.css('.ctx-badge.cb-rejected'));
    expect(badge).not.toBeNull();
  });
});

describe('MatrixTileComponent — no ctx-badge when slot.next is absent', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const status of ['success', 'failure', 'in-progress'] as Status[]) {
    it(`no ctx-badge when slot has no .next (primary status = ${status})`, async () => {
      const slot: MatrixSlot = { current: mkEvent(status) };
      const fixture = await createTile(slot);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((fixture.componentInstance as any).ctxStatus()).toBeNull();
      const badge = fixture.debugElement.query(By.css('.ctx-badge'));
      expect(badge).toBeNull();
    });
  }
});

// ── Never-deployed — context status current, no baseline (#268) ───────────────

const NEVER_DEPLOYED_STATUSES: Status[] = ['pending', 'queued', 'waiting', 'cancelled', 'rejected'];

describe('MatrixTileComponent — never-deployed: context current + no last_successful', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const status of NEVER_DEPLOYED_STATUSES) {
    describe(`status = ${status}`, () => {
      it(`boxState() returns 's-never-deployed'`, async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        expect(priv(fixture.componentInstance).boxState()).toBe('s-never-deployed');
      });

      it('the root .slot carries class s-never-deployed', async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        const el = fixture.debugElement.query(By.css('.slot'));
        expect(el.classes['s-never-deployed']).toBe(true);
      });

      it('does NOT carry any effective state class', async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        const el = fixture.debugElement.query(By.css('.slot'));
        expect(el.classes['s-success']).toBeFalsy();
        expect(el.classes['s-running-only']).toBeFalsy();
        expect(el.classes['s-fail-last']).toBeFalsy();
      });

      it('renders a status chip with correct class cb-' + status, async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        const chip = fixture.debugElement.query(By.css(`.ctx-badge.cb-${status}`));
        expect(chip).not.toBeNull();
      });

      it('does NOT render a spinner', async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        expect(fixture.debugElement.query(By.css('.spinner'))).toBeNull();
      });

      it('isRunning() is false', async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        expect(priv(fixture.componentInstance).isRunning()).toBe(false);
      });

      it('isSplit() is false', async () => {
        const slot: MatrixSlot = { current: mkEvent(status) };
        const fixture = await createTile(slot);
        expect(priv(fixture.componentInstance).isSplit()).toBe(false);
      });
    });
  }
});

describe('MatrixTileComponent — never-deployed: version visible when present', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders version span when version is present', async () => {
    const slot: MatrixSlot = { current: mkEvent('waiting', { version: 'v2.0.0-beta.3' }) };
    const fixture = await createTile(slot);
    const ver = fixture.debugElement.query(By.css('.ver'));
    expect(ver).not.toBeNull();
    expect(ver.nativeElement.textContent.trim()).toBe('v2.0.0-beta.3');
  });
});

// ── Change-emphasis flash — isFlashing input (#398) ────────────────────────

describe('MatrixTileComponent — isFlashing input (#398)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('defaults to false: .is-flashing class absent when isFlashing is not set', async () => {
    const slot: MatrixSlot = { current: mkEvent('success') };
    const fixture = await createTile(slot);
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['is-flashing']).toBeFalsy();
  });

  it('applies .is-flashing when isFlashing() is true', async () => {
    const slot: MatrixSlot = { current: mkEvent('success') };
    const fixture = await createTile(slot);
    fixture.componentRef.setInput('isFlashing', true);
    fixture.detectChanges();
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['is-flashing']).toBe(true);
  });

  it('removes .is-flashing when isFlashing() flips back to false', async () => {
    const slot: MatrixSlot = { current: mkEvent('success') };
    const fixture = await createTile(slot);
    fixture.componentRef.setInput('isFlashing', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('isFlashing', false);
    fixture.detectChanges();
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['is-flashing']).toBeFalsy();
  });

  it('.is-flashing composes with an existing box-state class (e.g. s-running-only + breathe)', async () => {
    const slot: MatrixSlot = { current: mkEvent('in-progress') };
    const fixture = await createTile(slot);
    fixture.componentRef.setInput('isFlashing', true);
    fixture.detectChanges();
    const el = fixture.debugElement.query(By.css('.slot'));
    expect(el.classes['s-running-only']).toBe(true);
    expect(el.classes['is-flashing']).toBe(true);
  });
});

describe('MatrixTileComponent — never-deployed does NOT affect existing effective states', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success with last_successful stays s-success (not s-never-deployed)', async () => {
    const slot: MatrixSlot = {
      current: mkEvent('success'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-success');
    expect(fixture.debugElement.query(By.css('.slot')).classes['s-never-deployed']).toBeFalsy();
  });

  it('context status WITH last_successful returns s-success (not s-never-deployed)', async () => {
    const slot: MatrixSlot = {
      current: mkEvent('waiting'),
      last_successful: mkEvent('success', { id: 'evt-2', deployment_id: 'dep-2' }),
    };
    const fixture = await createTile(slot);
    expect(priv(fixture.componentInstance).boxState()).toBe('s-success');
    expect(fixture.debugElement.query(By.css('.slot')).classes['s-never-deployed']).toBeFalsy();
  });
});
