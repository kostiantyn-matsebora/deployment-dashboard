/**
 * VisCardComponent — unit tests.
 *
 * Spec: docs/design/components.md §Swimlane Node Card + §Never-deployed slot
 *
 * Issue #268: never-deployed slot renders neutral/grey card + status chip.
 */
import { NO_ERRORS_SCHEMA }  from '@angular/core';
import { TestBed }           from '@angular/core/testing';
import { By }                from '@angular/platform-browser';

import { VisCardComponent }                  from './vis-card.component';
import { DeploymentEvent, SwimlaneField, SWIMLANE_FIELDS, Status } from '../../../core/models/deployment.model';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvent(
  status: Status,
  overrides: Partial<DeploymentEvent> = {},
): DeploymentEvent {
  return {
    id:            'evt-1',
    deployment_id: 'dep-1',
    service:       'svc-a',
    environment:   'qa',
    version:       'v1.0.0',
    status,
    happened_at:   '2026-06-06T08:00:00Z',
    ...overrides,
  };
}

async function createCard(
  event: DeploymentEvent,
  opts: {
    nextEvent?: DeploymentEvent | null;
    neverDeployed?: boolean;
    visibleFields?: Set<SwimlaneField>;
  } = {},
) {
  const { nextEvent = null, neverDeployed = false, visibleFields = new Set(SWIMLANE_FIELDS) } = opts;

  await TestBed.configureTestingModule({
    imports: [VisCardComponent],
    schemas: [NO_ERRORS_SCHEMA],
  }).compileComponents();

  const fixture = TestBed.createComponent(VisCardComponent);
  fixture.componentRef.setInput('event', event);
  fixture.componentRef.setInput('visibleFields', visibleFields);
  fixture.componentRef.setInput('nextEvent', nextEvent);
  fixture.componentRef.setInput('neverDeployed', neverDeployed);
  fixture.detectChanges();
  return fixture;
}

// ── Never-deployed — neverDeployed input = true (#268) ───────────────────────
//
// The `neverDeployed` input is set by the parent SwimlanesComponent, which
// has access to slot.last_successful. The vis-card cannot derive this alone.

const NEVER_DEPLOYED_STATUSES: Status[] = ['pending', 'queued', 'waiting', 'cancelled', 'rejected'];

describe('VisCardComponent — never-deployed: neverDeployed=true input', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const status of NEVER_DEPLOYED_STATUSES) {
    describe(`status = ${status}`, () => {
      it('card carries class s-never-deployed when neverDeployed=true', async () => {
        const fixture = await createCard(mkEvent(status), { neverDeployed: true });
        const card = fixture.debugElement.query(By.css('.vis-card'));
        expect(card.classes['s-never-deployed']).toBe(true);
      });

      it('does NOT carry s-success, s-progress, or s-failure', async () => {
        const fixture = await createCard(mkEvent(status), { neverDeployed: true });
        const card = fixture.debugElement.query(By.css('.vis-card'));
        expect(card.classes['s-success']).toBeFalsy();
        expect(card.classes['s-progress']).toBeFalsy();
        expect(card.classes['s-failure']).toBeFalsy();
      });

      it('renders a status chip with class cb-' + status, async () => {
        const fixture = await createCard(mkEvent(status), { neverDeployed: true });
        const chip = fixture.debugElement.query(By.css(`.ctx-badge.cb-${status}`));
        expect(chip).not.toBeNull();
      });

      it('chip text contains the status name', async () => {
        const fixture = await createCard(mkEvent(status), { neverDeployed: true });
        const chip = fixture.debugElement.query(By.css(`.ctx-badge.cb-${status}`));
        expect(chip.nativeElement.textContent).toContain(status);
      });
    });
  }
});

describe('VisCardComponent — never-deployed: version visible when present', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders version text when present and neverDeployed=true', async () => {
    const fixture = await createCard(
      mkEvent('waiting', { version: 'v2.0.0-beta.3' }),
      { neverDeployed: true },
    );
    const ver = fixture.debugElement.query(By.css('.vc-ver'));
    expect(ver).not.toBeNull();
    expect(ver.nativeElement.textContent.trim()).toBe('v2.0.0-beta.3');
  });
});

describe('VisCardComponent — neverDeployed=false: context event not treated as never-deployed', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('context-status event with neverDeployed=false (default) → NOT s-never-deployed', async () => {
    // This case represents a slot with last_successful — context status as current
    // but there IS an effective baseline (e.g. billing-webhook|prod waiting with last_successful).
    const fixture = await createCard(mkEvent('waiting'), { neverDeployed: false });
    const card = fixture.debugElement.query(By.css('.vis-card'));
    expect(card.classes['s-never-deployed']).toBeFalsy();
  });
});

// ── Effective states — not broken by the never-deployed change ────────────────

describe('VisCardComponent — effective states unchanged (no regression)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('success event → s-success class', async () => {
    const fixture = await createCard(mkEvent('success'));
    const card = fixture.debugElement.query(By.css('.vis-card'));
    expect(card.classes['s-success']).toBe(true);
    expect(card.classes['s-never-deployed']).toBeFalsy();
  });

  it('in-progress event → s-progress class', async () => {
    const fixture = await createCard(mkEvent('in-progress'));
    const card = fixture.debugElement.query(By.css('.vis-card'));
    expect(card.classes['s-progress']).toBe(true);
    expect(card.classes['s-never-deployed']).toBeFalsy();
  });

  it('failure event → s-failure class', async () => {
    const fixture = await createCard(mkEvent('failure'));
    const card = fixture.debugElement.query(By.css('.vis-card'));
    expect(card.classes['s-failure']).toBe(true);
    expect(card.classes['s-never-deployed']).toBeFalsy();
  });

  it('success + next context event renders ctx-badge (not s-never-deployed)', async () => {
    const fixture = await createCard(
      mkEvent('success'),
      { nextEvent: mkEvent('pending', { id: 'ctx-1', deployment_id: 'ctx-dep-1' }) },
    );
    const card = fixture.debugElement.query(By.css('.vis-card'));
    expect(card.classes['s-success']).toBe(true);
    expect(card.classes['s-never-deployed']).toBeFalsy();
    const badge = fixture.debugElement.query(By.css('.ctx-badge.cb-pending'));
    expect(badge).not.toBeNull();
  });
});
