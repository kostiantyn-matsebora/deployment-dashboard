// FR-12 — attribute picker: counter renders n/max, cap enforcement disables
// unchecked boxes, helper text mentions always-on elements + Focus-specific
// note when applicable.

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DeploymentMatrixStore } from '@dd/shared';
import { AttributePickerComponent } from './attribute-picker.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [AttributePickerComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  const fixture = TestBed.createComponent(AttributePickerComponent);
  fixture.detectChanges();
  return { fixture, store };
}

function openPopover(fixture: ReturnType<typeof setup>['fixture']): void {
  const btn = fixture.nativeElement.querySelector(
    '[data-testid="picker-button"]'
  ) as HTMLButtonElement;
  btn.click();
  fixture.detectChanges();
}

describe('AttributePickerComponent', () => {
  it('renders seven checkboxes, one per FR-02 attribute key (status, version, run, ago, actor, ref, sha)', () => {
    const { fixture } = setup();
    openPopover(fixture);
    const boxes = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid^="attr-checkbox-"]')
    ) as HTMLInputElement[];
    expect(boxes.length).toBe(7);
    const keys = boxes.map(b => b.getAttribute('data-testid')!.replace('attr-checkbox-', ''));
    expect(keys).toEqual(['status', 'version', 'run', 'ago', 'actor', 'ref', 'sha']);
  });

  it('counter on the button renders n/max for the active view (Detailed = 5/7)', () => {
    const { fixture } = setup();
    const counter = fixture.nativeElement.querySelector(
      '[data-testid="picker-counter"]'
    );
    expect(counter?.textContent?.trim()).toBe('5/7');
  });

  it('counter updates when an attribute is toggled off', () => {
    const { fixture, store } = setup();
    store.toggleAttr('detailed', 'actor');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="picker-counter"]').textContent.trim()
    ).toBe('4/7');
  });

  it('Detailed view can hold all seven attributes (cap 7)', () => {
    const { fixture, store } = setup();
    // Defaults are 5/7 — add ref + sha to hit the cap.
    store.toggleAttr('detailed', 'ref');
    store.toggleAttr('detailed', 'sha');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="picker-counter"]').textContent.trim()
    ).toBe('7/7');
  });

  it('disables unchecked boxes when the cap is reached (Compact = 5/5)', () => {
    const { fixture, store } = setup();
    store.setView('compact');
    // Default compact = 4/5 — add actor to reach the cap.
    store.toggleAttr('compact', 'actor');
    fixture.detectChanges();
    openPopover(fixture);
    // ref + sha are now disabled because cap is reached.
    const ref = fixture.nativeElement.querySelector(
      '[data-testid="attr-checkbox-ref"]'
    ) as HTMLInputElement;
    expect(ref.disabled).toBeTrue();
    const sha = fixture.nativeElement.querySelector(
      '[data-testid="attr-checkbox-sha"]'
    ) as HTMLInputElement;
    expect(sha.disabled).toBeTrue();
    // Already-selected boxes remain enabled even at the cap.
    const status = fixture.nativeElement.querySelector(
      '[data-testid="attr-checkbox-status"]'
    ) as HTMLInputElement;
    expect(status.disabled).toBeFalse();
  });

  it('toggling a checkbox dispatches store.toggleAttr', () => {
    const { fixture, store } = setup();
    openPopover(fixture);
    const actor = fixture.nativeElement.querySelector(
      '[data-testid="attr-checkbox-actor"]'
    ) as HTMLInputElement;
    actor.click();
    fixture.detectChanges();
    expect(store.attrs().detailed).not.toContain('actor');
  });

  it('helper text mentions the always-on elements', () => {
    const { fixture } = setup();
    openPopover(fixture);
    const note = fixture.nativeElement.querySelector(
      '[data-testid="picker-always-on-note"]'
    );
    expect(note?.textContent).toContain('Status colour');
    expect(note?.textContent).toContain('prev. failed');
    expect(note?.textContent).toContain('last-successful');
  });

  it('Focus view renders the "expanded rows always show all seven" note', () => {
    const { fixture, store } = setup();
    store.setView('focus');
    fixture.detectChanges();
    openPopover(fixture);
    const focusNote = fixture.nativeElement.querySelector(
      '[data-testid="picker-focus-note"]'
    );
    expect(focusNote?.textContent).toContain('Expanded rows');
    expect(focusNote?.textContent).toContain('all seven');
  });

  it('non-Focus view does not render the Focus-specific note', () => {
    const { fixture, store } = setup();
    store.setView('compact');
    fixture.detectChanges();
    openPopover(fixture);
    const focusNote = fixture.nativeElement.querySelector(
      '[data-testid="picker-focus-note"]'
    );
    expect(focusNote).toBeNull();
  });
});
