// FR-12 — Glance row: one pill per environment, cap 1, status icon always
// rendered, last-successful stripe always rendered when present.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES
} from '@dd/shared';
import { GlanceRowComponent } from './glance-row.component';

function setup(svcId: string) {
  TestBed.configureTestingModule({
    imports: [GlanceRowComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setServices(FIXTURE_SERVICES);
  store.setEnvironments(FIXTURE_ENVIRONMENTS);
  store.setMatrix(FIXTURE_MATRIX);
  store.setView('glance');
  const fixture = TestBed.createComponent(GlanceRowComponent);
  fixture.componentRef.setInput('service', FIXTURE_SERVICES.find(s => s.id === svcId)!);
  fixture.componentRef.setInput('envs', FIXTURE_ENVIRONMENTS);
  fixture.detectChanges();
  return { fixture, store };
}

describe('GlanceRowComponent', () => {
  it('renders one pill (or empty pill) per environment with data-view="glance"', () => {
    const { fixture } = setup('service-a');
    const items = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="stage-box-service-a-"]')
    ) as HTMLElement[];
    expect(items.length).toBe(FIXTURE_ENVIRONMENTS.length);
    for (const el of items) expect(el.getAttribute('data-view')).toBe('glance');
  });

  it('shows the version (default Glance attribute, cap 1)', () => {
    const { fixture } = setup('service-a');
    expect(fixture.nativeElement.querySelector('[data-testid="current-version-service-a-dev"]')).not.toBeNull();
  });

  it('cap of 1 — toggling a second attribute is rejected', () => {
    const { fixture, store } = setup('service-a');
    const ok = store.toggleAttr('glance', 'status');
    fixture.detectChanges();
    expect(ok).toBeFalse();
    // version stays as the single visible attribute span.
    expect(fixture.nativeElement.querySelector('[data-testid="current-version-service-a-dev"]')).not.toBeNull();
  });

  it('renders status icon (always-on) even when the picker is empty', () => {
    const { fixture, store } = setup('service-a');
    store.toggleAttr('glance', 'version'); // empties the picker
    fixture.detectChanges();
    // Pill still contains an icon — for the in-progress dev slot, that's a spinner.
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-dev"]');
    expect(dev.querySelector('[data-testid="spinner"]')).not.toBeNull();
  });

  it('renders the last-successful stripe when lastSuccessful is non-null', () => {
    const { fixture } = setup('service-b');
    const qa = fixture.nativeElement.querySelector('[data-testid="stage-box-service-b-qa"]');
    expect(qa.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
  });

  it('renders the ⚠ prev-failed indicator when applicable', () => {
    const { fixture } = setup('service-d');
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-d-dev"]');
    expect(dev.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
  });

  it('renders the empty pill for null slots', () => {
    const { fixture } = setup('service-a');
    const empty = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-qahotfix"]');
    expect(empty.getAttribute('data-state')).toBe('empty');
  });

  it('NFR-09 Glance exception — renders env-tag INSIDE the pill', () => {
    const { fixture } = setup('service-a');
    // The dev pill should embed an env-tag span as a descendant of
    // .pill-current; the outside-pill env-tag is suppressed.
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-dev"]');
    const inside = dev.querySelector('[data-testid="env-tag-inside-service-a-dev"]');
    expect(inside).not.toBeNull();
    expect(inside.textContent?.toUpperCase()).toContain('DEV');
  });

  it('switching the single attribute changes which span renders', () => {
    const { fixture, store } = setup('service-a');
    store.toggleAttr('glance', 'version'); // empties
    store.toggleAttr('glance', 'run');     // now shows run
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="current-version-service-a-dev"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="current-run-service-a-dev"]')).not.toBeNull();
  });
});
