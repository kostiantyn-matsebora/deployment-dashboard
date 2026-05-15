// FR-12 — Detailed row renders the canonical stage box per environment,
// respects activeAttrs, and renders always-on elements regardless of
// picker state.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES
} from '@dd/shared';
import { DetailedRowComponent } from './detailed-row.component';

function setup(svcId: string) {
  TestBed.configureTestingModule({
    imports: [DetailedRowComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setServices(FIXTURE_SERVICES);
  store.setEnvironments(FIXTURE_ENVIRONMENTS);
  store.setMatrix(FIXTURE_MATRIX);
  const fixture = TestBed.createComponent(DetailedRowComponent);
  fixture.componentRef.setInput('service', FIXTURE_SERVICES.find(s => s.id === svcId)!);
  fixture.componentRef.setInput('envs', FIXTURE_ENVIRONMENTS);
  fixture.detectChanges();
  return { fixture, store };
}

describe('DetailedRowComponent', () => {
  it('renders one stage box per environment', () => {
    const { fixture } = setup('service-a');
    const boxes = fixture.nativeElement.querySelectorAll('[data-testid^="stage-box-service-a-"]');
    expect(boxes.length).toBe(FIXTURE_ENVIRONMENTS.length);
  });

  it('renders all 5 picker attributes by default (Detailed cap = 5/5)', () => {
    const { fixture } = setup('service-a');
    // service-a/dev — running-with-last fixture; should render version,
    // ago, actor, run, and the status badge.
    const env = 'dev';
    expect(fixture.nativeElement.querySelector(`[data-testid="current-version-service-a-${env}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`[data-testid="current-ago-service-a-${env}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`[data-testid="current-actor-service-a-${env}"]`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector(`[data-testid="run-link-current-service-a-${env}"]`)).not.toBeNull();
  });

  it('respects activeAttrs — hiding "actor" removes the actor span', () => {
    const { fixture, store } = setup('service-a');
    store.toggleAttr('detailed', 'actor');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="current-actor-service-a-dev"]')).toBeNull();
  });

  it('renders the always-on last-successful split section regardless of picker', () => {
    const { fixture, store } = setup('service-a');
    // Empty the picker entirely.
    ['status', 'version', 'run', 'ago', 'actor'].forEach(k =>
      store.toggleAttr('detailed', k as never)
    );
    fixture.detectChanges();
    // service-a/dev has lastSuccessful → split section must still render.
    expect(fixture.nativeElement.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
  });

  it('renders the always-on ⚠ prev-failed badge regardless of picker', () => {
    const { fixture, store } = setup('service-c');
    ['status', 'version', 'run', 'ago', 'actor'].forEach(k =>
      store.toggleAttr('detailed', k as never)
    );
    fixture.detectChanges();
    // service-c/dev — running-prev-failed-with-last.
    const box = fixture.nativeElement.querySelector('[data-testid="stage-box-service-c-dev"]');
    expect(box.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
  });

  it('renders the empty em-dash for null slots', () => {
    const { fixture } = setup('service-a');
    const empty = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-qahotfix"]');
    expect(empty.getAttribute('data-state')).toBe('empty');
    expect(empty.textContent).toContain('—');
  });
});
