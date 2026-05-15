// FR-13 — topology picker.
//
// SAD §10 Decision #7 — the picker is localStorage-only. No PATCH wiring,
// no `X-Api-Key`. Selecting an option dispatches the new value to the
// store and emits `pickChanged`; selecting "system default" clears the
// override. The picker is always visible (no `allowUserOverride` gate
// anymore — that field is gone from the SAD).

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  ApiClientService,
  DeploymentMatrixStore,
  type CorrelationAttribute,
  type TopologyConfig
} from '@dd/shared';
import { TopologyPickerComponent } from './topology-picker.component';

function setup(opts: { config: TopologyConfig | null; pick?: CorrelationAttribute }) {
  // ApiClientService is no longer needed by the picker itself (no PATCH).
  // Provide a stub so DI doesn't trip on optional injectees from sibling
  // tests sharing the TestBed context.
  TestBed.configureTestingModule({
    imports: [TopologyPickerComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ApiClientService, useValue: {} }
    ]
  });
  const store = TestBed.inject(DeploymentMatrixStore);
  store.setTopologyConfig(opts.config);
  if (opts.pick !== undefined) store.setCorrelationAttribute(opts.pick);
  const fixture = TestBed.createComponent(TopologyPickerComponent);
  fixture.detectChanges();
  return { fixture, store };
}

describe('TopologyPickerComponent', () => {
  it('renders the picker even when the config has not loaded yet', () => {
    const { fixture } = setup({ config: null });
    expect(
      fixture.nativeElement.querySelector('[data-testid="topology-picker"]')
    ).not.toBeNull();
  });

  it('shows the system-default attribute label when no user pick is set', () => {
    const { fixture } = setup({
      config: { correlationAttribute: 'version', perServiceOverrides: {} }
    });
    const text = (fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-attr"]'
    ) as HTMLElement).textContent ?? '';
    expect(text.trim()).toBe('Version');
  });

  it('opens the popover on button click', () => {
    const { fixture } = setup({
      config: { correlationAttribute: 'version', perServiceOverrides: {} }
    });
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-button"]'
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="topology-picker-popover"]')
    ).not.toBeNull();
  });

  it('selecting a non-default attribute writes to the store and emits the new value', () => {
    const { fixture, store } = setup({
      config: { correlationAttribute: 'version', perServiceOverrides: {} }
    });
    const events: (CorrelationAttribute | undefined)[] = [];
    fixture.componentInstance.pickChanged.subscribe(v => events.push(v));
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-button"]'
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-option-ref"]'
    ) as HTMLInputElement).click();
    fixture.detectChanges();
    expect(store.correlationAttribute()).toBe('ref');
    expect(events).toEqual(['ref']);
  });

  it('selecting "system default" clears the store override and emits undefined', () => {
    const { fixture, store } = setup({
      config: { correlationAttribute: 'sha', perServiceOverrides: {} },
      pick: 'ref'
    });
    const events: (CorrelationAttribute | undefined)[] = [];
    fixture.componentInstance.pickChanged.subscribe(v => events.push(v));
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-button"]'
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-option-system-default"]'
    ) as HTMLInputElement).click();
    fixture.detectChanges();
    expect(store.correlationAttribute()).toBeUndefined();
    expect(events).toEqual([undefined]);
  });

  it('button label reflects the user pick when set, otherwise the system default', () => {
    const { fixture, store } = setup({
      config: { correlationAttribute: 'sha', perServiceOverrides: {} }
    });
    const attrEl = () => fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-attr"]'
    ) as HTMLElement;
    expect(attrEl().textContent?.trim()).toBe('SHA');
    store.setCorrelationAttribute('actor');
    fixture.detectChanges();
    expect(attrEl().textContent?.trim()).toBe('Actor');
  });

  it('exposes every allowed attribute as a radio option', () => {
    const { fixture } = setup({
      config: { correlationAttribute: 'version', perServiceOverrides: {} }
    });
    (fixture.nativeElement.querySelector(
      '[data-testid="topology-picker-button"]'
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    for (const key of ['version', 'ref', 'sha', 'actor', 'run', 'ago']) {
      expect(
        fixture.nativeElement.querySelector(`[data-testid="topology-option-${key}"]`)
      ).not.toBeNull();
    }
    // `id` is explicitly disallowed.
    expect(
      fixture.nativeElement.querySelector('[data-testid="topology-option-id"]')
    ).toBeNull();
  });
});
