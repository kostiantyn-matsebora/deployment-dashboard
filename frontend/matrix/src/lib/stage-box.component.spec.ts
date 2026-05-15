// Verifies all 6 box states render correctly from the canonical fixture
// data. Each state is keyed off the slot's data-state attribute and the
// presence/absence of the prev-failed badge + last-successful section.

import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotState
} from '@dd/shared';
import { StageBoxComponent } from './stage-box.component';

@Component({
  standalone: true,
  imports: [StageBoxComponent],
  template: `<dd-stage-box [service]="svc()" [env]="env()" [slot]="slot()"></dd-stage-box>`
})
class Host {
  svc = signal<ServiceDescriptor>(FIXTURE_SERVICES[0]);
  env = signal<EnvironmentDescriptor>(FIXTURE_ENVIRONMENTS[0]);
  slot = signal<SlotState | null>(null);
}

function render(svcId: string, envId: string) {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
  const fixture = TestBed.createComponent(Host);
  TestBed.inject(DeploymentMatrixStore);
  const service = FIXTURE_SERVICES.find(s => s.id === svcId)!;
  const env = FIXTURE_ENVIRONMENTS.find(e => e.id === envId)!;
  fixture.componentInstance.svc.set(service);
  fixture.componentInstance.env.set(env);
  fixture.componentInstance.slot.set(FIXTURE_MATRIX[svcId][envId]);
  fixture.detectChanges();
  return fixture;
}

function dataState(fixture: ReturnType<typeof render>): string | null {
  const el = fixture.nativeElement.querySelector('[data-testid^="stage-box-"]');
  return el?.getAttribute('data-state') ?? null;
}

describe('StageBoxComponent — 6 box states', () => {
  it('State 1: Success — full green box', () => {
    const f = render('service-b', 'dev');
    expect(dataState(f)).toBe('success');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).toBeNull();
  });

  it('State 2: Running + Last Successful', () => {
    const f = render('service-a', 'dev');
    expect(dataState(f)).toBe('running-with-last');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="spinner"]')).not.toBeNull();
  });

  it('State 3: Running + Failed + Last Successful', () => {
    const f = render('service-c', 'dev');
    expect(dataState(f)).toBe('running-prev-failed-with-last');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
  });

  it('State 4: Failed + Last Successful', () => {
    const f = render('service-b', 'qa');
    expect(dataState(f)).toBe('failed-with-last');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).toBeNull();
  });

  it('State 5: Running (no successful history)', () => {
    const f = render('service-d', 'uat');
    expect(dataState(f)).toBe('running');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="spinner"]')).not.toBeNull();
  });

  it('State 6: Running + Failed (no successful history)', () => {
    const f = render('service-d', 'dev');
    expect(dataState(f)).toBe('running-prev-failed');
    expect(f.nativeElement.querySelector('[data-testid="last-successful-section"]')).toBeNull();
    expect(f.nativeElement.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
  });

  it('Empty slot renders the em-dash', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(Host);
    TestBed.inject(DeploymentMatrixStore);
    fixture.componentInstance.svc.set(FIXTURE_SERVICES[0]);
    fixture.componentInstance.env.set(FIXTURE_ENVIRONMENTS.find(e => e.id === 'qahotfix')!);
    fixture.componentInstance.slot.set(null);
    fixture.detectChanges();
    expect(dataState(fixture)).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('—');
  });
});
