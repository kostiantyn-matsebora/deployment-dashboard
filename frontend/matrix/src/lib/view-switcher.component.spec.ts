// FR-12 — view switcher renders 4 options; clicking one updates the store.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DeploymentMatrixStore } from '@dd/shared';
import { ViewSwitcherComponent } from './view-switcher.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [ViewSwitcherComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  const fixture = TestBed.createComponent(ViewSwitcherComponent);
  fixture.detectChanges();
  return { fixture, store };
}

describe('ViewSwitcherComponent', () => {
  it('renders four options in canonical order', () => {
    const { fixture } = setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="view-option-"]')
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(4);
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual([
      'view-option-detailed',
      'view-option-compact',
      'view-option-glance',
      'view-option-focus'
    ]);
  });

  it('marks the active option with data-active=true', () => {
    const { fixture } = setup();
    const detailed = fixture.nativeElement.querySelector(
      '[data-testid="view-option-detailed"]'
    ) as HTMLButtonElement;
    expect(detailed.getAttribute('data-active')).toBe('true');
  });

  it('clicking an option updates the store and re-marks the active button', () => {
    const { fixture, store } = setup();
    const glance = fixture.nativeElement.querySelector(
      '[data-testid="view-option-glance"]'
    ) as HTMLButtonElement;
    glance.click();
    fixture.detectChanges();
    expect(store.view()).toBe('glance');
    expect(glance.getAttribute('data-active')).toBe('true');
  });

  it('every option carries a title attribute carrying the description', () => {
    const { fixture } = setup();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="view-option-"]')
    ) as HTMLButtonElement[];
    for (const b of buttons) {
      expect(b.getAttribute('title')).toBeTruthy();
    }
  });
});
