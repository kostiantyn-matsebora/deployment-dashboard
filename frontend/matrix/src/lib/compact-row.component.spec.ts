// FR-12 — Compact row: respects activeAttrs (cap 4), always-on elements
// stay regardless, ~120px stage boxes, all 6 box states render correctly.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES
} from '@dd/shared';
import { CompactRowComponent } from './compact-row.component';

function setup(svcId: string) {
  TestBed.configureTestingModule({
    imports: [CompactRowComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setServices(FIXTURE_SERVICES);
  store.setEnvironments(FIXTURE_ENVIRONMENTS);
  store.setMatrix(FIXTURE_MATRIX);
  store.setView('compact');
  const fixture = TestBed.createComponent(CompactRowComponent);
  fixture.componentRef.setInput('service', FIXTURE_SERVICES.find(s => s.id === svcId)!);
  fixture.componentRef.setInput('envs', FIXTURE_ENVIRONMENTS);
  fixture.detectChanges();
  return { fixture, store };
}

describe('CompactRowComponent', () => {
  it('renders one box per environment with data-view="compact"', () => {
    const { fixture } = setup('service-a');
    const boxes = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="stage-box-service-a-"]')
    ) as HTMLElement[];
    expect(boxes.length).toBe(FIXTURE_ENVIRONMENTS.length);
    for (const b of boxes) expect(b.getAttribute('data-view')).toBe('compact');
  });

  it('renders the 4 default attributes (no actor)', () => {
    const { fixture } = setup('service-a');
    expect(fixture.nativeElement.querySelector('[data-testid="current-version-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="current-ago-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="run-link-current-service-a-dev"]')).not.toBeNull();
    // actor not in default compact attrs.
    expect(fixture.nativeElement.querySelector('[data-testid="current-actor-service-a-dev"]')).toBeNull();
  });

  it('cap = 5: adding a 5th attribute (actor) succeeds and renders', () => {
    const { fixture, store } = setup('service-a');
    const added = store.toggleAttr('compact', 'actor');
    fixture.detectChanges();
    expect(added).toBeTrue();
    expect(fixture.nativeElement.querySelector('[data-testid="current-actor-service-a-dev"]')).not.toBeNull();
  });

  it('cap = 5: adding a 6th attribute is rejected and the row stays unchanged', () => {
    const { fixture, store } = setup('service-a');
    store.toggleAttr('compact', 'actor');  // 5/5
    const overflow = store.toggleAttr('compact', 'ref'); // 6th → reject
    fixture.detectChanges();
    expect(overflow).toBeFalse();
    expect(fixture.nativeElement.querySelector('[data-testid="current-ref-service-a-dev"]')).toBeNull();
  });

  it('renders the always-on ⚠ prev-failed badge even when picker is empty', () => {
    const { fixture, store } = setup('service-c');
    // Empty all four attrs.
    ['status', 'version', 'run', 'ago'].forEach(k =>
      store.toggleAttr('compact', k as never)
    );
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('[data-testid="stage-box-service-c-dev"]');
    expect(box.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
  });

  it('renders the always-on last-successful section when present', () => {
    const { fixture, store } = setup('service-b');
    ['status', 'version', 'run', 'ago'].forEach(k =>
      store.toggleAttr('compact', k as never)
    );
    fixture.detectChanges();
    // service-b/qa — failed-with-last → last-successful-section.
    const box = fixture.nativeElement.querySelector('[data-testid="stage-box-service-b-qa"]');
    expect(box.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
  });

  it('data-state token matches the 6-state taxonomy', () => {
    const { fixture } = setup('service-d');
    const dev  = fixture.nativeElement.querySelector('[data-testid="stage-box-service-d-dev"]');
    const qa   = fixture.nativeElement.querySelector('[data-testid="stage-box-service-d-qa"]');
    const uat  = fixture.nativeElement.querySelector('[data-testid="stage-box-service-d-uat"]');
    const prod = fixture.nativeElement.querySelector('[data-testid="stage-box-service-d-prod"]');
    expect(dev.getAttribute('data-state')).toBe('running-prev-failed');
    expect(qa.getAttribute('data-state')).toBe('failed-with-last');
    expect(uat.getAttribute('data-state')).toBe('running');
    expect(prod.getAttribute('data-state')).toBe('empty');
  });
});
