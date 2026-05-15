// FR-12 — Focus row: collapsed respects activeAttrs (cap 4); expanded
// always shows all 5 attributes regardless of the picker (the "Full-
// attribute disclosure rule"). Pin keeps the row expanded.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeploymentMatrixStore,
  FIXTURE_ENVIRONMENTS,
  FIXTURE_MATRIX,
  FIXTURE_SERVICES
} from '@dd/shared';
import { FocusRowComponent } from './focus-row.component';

function setup(svcId: string) {
  TestBed.configureTestingModule({
    imports: [FocusRowComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setServices(FIXTURE_SERVICES);
  store.setEnvironments(FIXTURE_ENVIRONMENTS);
  store.setMatrix(FIXTURE_MATRIX);
  store.setView('focus');
  const fixture = TestBed.createComponent(FocusRowComponent);
  fixture.componentRef.setInput('service', FIXTURE_SERVICES.find(s => s.id === svcId)!);
  fixture.componentRef.setInput('envs', FIXTURE_ENVIRONMENTS);
  fixture.detectChanges();
  return { fixture, store };
}

describe('FocusRowComponent', () => {
  it('renders collapsed by default — boxes carry data-view="focus-collapsed"', () => {
    const { fixture } = setup('service-a');
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-dev"]');
    expect(dev.getAttribute('data-view')).toBe('focus-collapsed');
  });

  it('collapsed rows respect the active-attrs picker', () => {
    const { fixture, store } = setup('service-a');
    // Default focus attrs do NOT include actor.
    expect(fixture.nativeElement.querySelector('[data-testid="current-actor-service-a-dev"]')).toBeNull();
    expect(store.attrs().focus).not.toContain('actor');
  });

  it('toggling expand changes the box rendering to the expanded stage-box', () => {
    const { fixture, store } = setup('service-a');
    store.toggleExpand('service-a');
    fixture.detectChanges();
    // Expanded row now uses dd-stage-box with data-view="expanded".
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-a-dev"]');
    expect(dev.getAttribute('data-view')).toBe('expanded');
  });

  it('expanded row renders all 7 attributes regardless of the picker', () => {
    const { fixture, store } = setup('service-a');
    // Strip the picker down to nothing.
    ['status', 'version', 'run', 'ago'].forEach(k =>
      store.toggleAttr('focus', k as never)
    );
    store.toggleExpand('service-a');
    fixture.detectChanges();
    // service-a/dev — every attribute should now render (full-disclosure).
    // In expanded mode the stage-box exposes focus-expanded-<attr>-... testids
    // so e2e oracles can disambiguate expanded-row anchors from collapsed-row
    // and Detailed-view anchors (which use current-<attr>-...). Verified
    // against testing/e2e/tests/full-attribute-disclosure.spec.ts.
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-status-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-version-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-run-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-ago-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-actor-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-ref-service-a-dev"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="focus-expanded-sha-service-a-dev"]')).not.toBeNull();
  });

  it('pinning a row expands it and marks it pinned', () => {
    const { fixture, store } = setup('service-b');
    const pin = fixture.nativeElement.querySelector(
      '[data-testid="focus-pin-service-b"]'
    ) as HTMLButtonElement;
    pin.click();
    fixture.detectChanges();
    expect(store.isPinned('service-b')()).toBeTrue();
    expect(store.isExpanded('service-b')()).toBeTrue();
    // Row receives the data-expanded attribute.
    const row = fixture.nativeElement.querySelector('[data-testid="service-row-service-b"]');
    expect(row.getAttribute('data-expanded')).toBe('true');
  });

  it('chevron toggle button exists and updates the store', () => {
    const { fixture, store } = setup('service-c');
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="focus-row-expand-service-c"]'
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    fixture.detectChanges();
    expect(store.isExpanded('service-c')()).toBeTrue();
  });

  it('renders always-on elements in collapsed rows too', () => {
    const { fixture } = setup('service-c');
    // service-c/dev — running-prev-failed-with-last.
    const dev = fixture.nativeElement.querySelector('[data-testid="stage-box-service-c-dev"]');
    expect(dev.querySelector('[data-testid="prev-failed-badge"]')).not.toBeNull();
    expect(dev.querySelector('[data-testid="last-successful-section"]')).not.toBeNull();
  });
});
