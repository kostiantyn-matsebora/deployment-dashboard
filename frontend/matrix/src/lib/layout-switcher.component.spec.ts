// FR-13 — layout switcher renders 3 options; clicking one updates the store.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DeploymentMatrixStore } from '@dd/shared';
import { LayoutSwitcherComponent } from './layout-switcher.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [LayoutSwitcherComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  const fixture = TestBed.createComponent(LayoutSwitcherComponent);
  fixture.detectChanges();
  return { fixture, store };
}

describe('LayoutSwitcherComponent', () => {
  it('renders two options in canonical order (Matrix deferred to Phase 2.0)', () => {
    const { fixture } = setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="layout-option-"]')
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual([
      'layout-option-swim-lane',
      'layout-option-workflow-rows'
    ]);
  });

  it('marks the default Swim-lane option active on first paint', () => {
    const { fixture } = setup();
    const swim = fixture.nativeElement.querySelector(
      '[data-testid="layout-option-swim-lane"]'
    ) as HTMLButtonElement;
    expect(swim.getAttribute('data-active')).toBe('true');
  });

  it('clicking an option updates the store and re-marks the active button', () => {
    const { fixture, store } = setup();
    const wf = fixture.nativeElement.querySelector(
      '[data-testid="layout-option-workflow-rows"]'
    ) as HTMLButtonElement;
    wf.click();
    fixture.detectChanges();
    expect(store.layout()).toBe('workflow-rows');
    expect(wf.getAttribute('data-active')).toBe('true');
  });

  it('every option carries a title attribute carrying the intent', () => {
    const { fixture } = setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="layout-option-"]')
    ) as HTMLButtonElement[];
    for (const b of buttons) {
      expect(b.getAttribute('title')).toBeTruthy();
    }
  });
});
