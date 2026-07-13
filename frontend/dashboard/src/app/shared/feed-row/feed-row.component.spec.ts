/**
 * FeedRowComponent — unit tests.
 *
 * Covers:
 *   - flat row: no chevron, no ×N badge
 *   - group row: chevron present, ×N badge shown only when count > 1
 *   - child row: no chevron, no ×N badge (same as flat, distinct only by CSS class)
 *   - toggle emits on group-row click, not on flat/child rows
 *   - clicking the run link does not emit toggle
 *   - run link renders only when run_url is present
 *   - every wire field except id and parent_deployments is rendered
 *   - serviceLabel: overrides the bare service when provided, falls back when omitted
 */
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { FeedRowComponent } from './feed-row.component';
import { DeploymentEvent } from '../../core/models/deployment.model';

function mkEvent(overrides: Partial<DeploymentEvent> = {}): DeploymentEvent {
  return {
    id:            'evt-1',
    deployment_id: 'dep-1',
    service:       'payments-api',
    environment:   'prod',
    version:       'v2.14.3',
    status:        'success',
    happened_at:   '2026-06-04T10:00:00Z',
    run_url:       'https://ci.internal/runs/4821',
    run_number:    '4821',
    actor:         'mreyes',
    ref:           'main',
    sha:           '7d3e2a1',
    ...overrides,
  };
}

function createRow(inputs: Partial<{
  event: DeploymentEvent; variant: 'flat' | 'group' | 'child'; count: number; expanded: boolean; flash: boolean; serviceLabel: string;
}>) {
  const fixture = TestBed.createComponent(FeedRowComponent);
  fixture.componentRef.setInput('event', inputs.event ?? mkEvent());
  if (inputs.variant !== undefined) fixture.componentRef.setInput('variant', inputs.variant);
  if (inputs.count !== undefined) fixture.componentRef.setInput('count', inputs.count);
  if (inputs.expanded !== undefined) fixture.componentRef.setInput('expanded', inputs.expanded);
  if (inputs.flash !== undefined) fixture.componentRef.setInput('flash', inputs.flash);
  if (inputs.serviceLabel !== undefined) fixture.componentRef.setInput('serviceLabel', inputs.serviceLabel);
  fixture.detectChanges();
  return fixture;
}

describe('FeedRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FeedRowComponent] }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders every wire field except id and parent_deployments', async () => {
    const fixture = await createRow({});
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('payments-api');
    expect(text).toContain('prod');
    expect(text).toContain('success');
    expect(text).toContain('v2.14.3');
    expect(text).toContain('main');
    expect(text).toContain('7d3e2a1');
    expect(text).toContain('#4821');
    expect(text).toContain('mreyes');
    expect(text).toContain('dep-1');
    expect(text).not.toContain('evt-1');
  });

  it('flat row: no chevron, no ×N badge', async () => {
    const fixture = await createRow({ variant: 'flat' });
    expect(fixture.debugElement.query(By.css('.feed-chevron'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-count-badge'))).toBeNull();
  });

  it('child row: no chevron, no ×N badge', async () => {
    const fixture = await createRow({ variant: 'child' });
    expect(fixture.debugElement.query(By.css('.feed-chevron'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-count-badge'))).toBeNull();
  });

  it('group row: shows a chevron', async () => {
    const fixture = await createRow({ variant: 'group', count: 1 });
    expect(fixture.debugElement.query(By.css('.feed-chevron'))).not.toBeNull();
  });

  it('group row: ×N badge shown only when count > 1', async () => {
    const single = await createRow({ variant: 'group', count: 1 });
    expect(single.debugElement.query(By.css('.feed-count-badge'))).toBeNull();

    const multi = await createRow({ variant: 'group', count: 3 });
    expect(multi.debugElement.query(By.css('.feed-count-badge'))?.nativeElement.textContent).toContain('×3');
  });

  it('chevron reflects the expanded input', async () => {
    const fixture = await createRow({ variant: 'group', count: 2, expanded: true });
    const chevron = fixture.debugElement.query(By.css('.feed-chevron')).nativeElement as HTMLElement;
    expect(chevron.classList.contains('is-expanded')).toBe(true);
  });

  it('emits toggle when a group row is clicked', async () => {
    const fixture = await createRow({ variant: 'group', count: 2 });
    let toggled = false;
    fixture.componentInstance.toggle.subscribe(() => (toggled = true));
    fixture.debugElement.query(By.css('.feed-row')).nativeElement.click();
    expect(toggled).toBe(true);
  });

  it('does not emit toggle when a flat row is clicked', async () => {
    const fixture = await createRow({ variant: 'flat' });
    let toggled = false;
    fixture.componentInstance.toggle.subscribe(() => (toggled = true));
    fixture.debugElement.query(By.css('.feed-row')).nativeElement.click();
    expect(toggled).toBe(false);
  });

  it('does not emit toggle when the run link is clicked', async () => {
    const fixture = await createRow({ variant: 'group', count: 2 });
    let toggled = false;
    fixture.componentInstance.toggle.subscribe(() => (toggled = true));
    const link = fixture.debugElement.query(By.css('.hist-link')).nativeElement as HTMLElement;
    link.click();
    expect(toggled).toBe(false);
  });

  it('renders no run link when run_url is absent', async () => {
    const fixture = await createRow({ event: mkEvent({ run_url: undefined }) });
    expect(fixture.debugElement.query(By.css('.hist-link'))).toBeNull();
  });

  it('falls back to the bare event().service when serviceLabel is omitted', async () => {
    const fixture = await createRow({ event: mkEvent({ service: 'gateway' }) });
    const cell = fixture.debugElement.query(By.css('.feed-service')).nativeElement as HTMLElement;
    expect(cell.textContent?.trim()).toBe('gateway');
  });

  it('renders the caller-supplied serviceLabel (e.g. namespace-prefixed on collision) instead of the bare service', async () => {
    const fixture = await createRow({ event: mkEvent({ service: 'gateway', namespace: 'org-a' }), serviceLabel: 'org-a/gateway' });
    const cell = fixture.debugElement.query(By.css('.feed-service')).nativeElement as HTMLElement;
    expect(cell.textContent?.trim()).toBe('org-a/gateway');
  });
});
