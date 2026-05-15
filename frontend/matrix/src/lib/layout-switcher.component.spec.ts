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
  it('renders three options in canonical order', () => {
    const { fixture } = setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="layout-option-"]')
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual([
      'layout-option-matrix',
      'layout-option-swim-lane',
      'layout-option-workflow-rows'
    ]);
  });

  it('marks the active option with data-active=true', () => {
    const { fixture } = setup();
    const matrix = fixture.nativeElement.querySelector(
      '[data-testid="layout-option-matrix"]'
    ) as HTMLButtonElement;
    expect(matrix.getAttribute('data-active')).toBe('true');
  });

  it('clicking an option updates the store and re-marks the active button', () => {
    const { fixture, store } = setup();
    const swim = fixture.nativeElement.querySelector(
      '[data-testid="layout-option-swim-lane"]'
    ) as HTMLButtonElement;
    swim.click();
    fixture.detectChanges();
    expect(store.layout()).toBe('swim-lane');
    expect(swim.getAttribute('data-active')).toBe('true');
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
