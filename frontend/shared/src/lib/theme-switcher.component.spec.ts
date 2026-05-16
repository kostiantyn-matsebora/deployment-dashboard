// Theme switcher — gear icon + popover with Light / Dark / Auto radios.
//
// Contract under test (mirrors the mockup in docs/deployment-dashboard.html
// lines 1108–1145):
//   - Container: `[data-testid="theme-switcher"]`
//   - Gear:      `[data-testid="theme-gear"]` with `aria-expanded`
//   - Options:   `[data-testid="theme-option-{light|dark|auto}"]`
//   - Popover closes on Escape and on click outside.
//   - Clicking an option calls `ThemeService.setPreference(<value>)`.
//   - The active option is marked via the `checked` attribute on the
//     radio + `aria-checked="true"`.
//
// Authored in parallel with the frontend implementation. The spec
// lives next to the component (`shared/`) per Angular convention
// — unit tests co-locate with source. (See QA report: the switcher's
// LOCATION in `shared/` is debatable — header switchers usually live
// in `matrix/` alongside `view-switcher.component.ts` and
// `layout-switcher.component.ts`. Flagged for solution-architect /
// frontend-engineer triage.)

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ThemeService } from './theme.service';
import { ThemeSwitcherComponent } from './theme-switcher.component';

interface MqlStub {
  matches: boolean;
  listeners: Array<(e: { matches: boolean }) => void>;
  addEventListener(t: 'change', cb: (e: { matches: boolean }) => void): void;
  removeEventListener(t: 'change', cb: (e: { matches: boolean }) => void): void;
  fire(matches: boolean): void;
}

function installMatchMediaStub(initialDark: boolean): MqlStub {
  const stub: MqlStub = {
    matches: initialDark,
    listeners: [],
    addEventListener(_t, cb) { this.listeners.push(cb); },
    removeEventListener(_t, cb) {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    },
    fire(matches: boolean) {
      this.matches = matches;
      for (const l of [...this.listeners]) l({ matches });
    }
  };
  (window as unknown as { matchMedia: (q: string) => MqlStub }).matchMedia = () => stub;
  return stub;
}

function setup() {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['themePref'];
  installMatchMediaStub(false);
  TestBed.configureTestingModule({
    imports: [ThemeSwitcherComponent],
    providers: [provideZonelessChangeDetection()]
  });
  const theme = TestBed.inject(ThemeService);
  const fixture = TestBed.createComponent(ThemeSwitcherComponent);
  fixture.detectChanges();
  return { fixture, theme };
}

function gear(fixture: ReturnType<typeof setup>['fixture']): HTMLButtonElement {
  return fixture.nativeElement.querySelector('[data-testid="theme-gear"]') as HTMLButtonElement;
}

function option(
  fixture: ReturnType<typeof setup>['fixture'],
  id: 'light' | 'dark' | 'auto'
): HTMLInputElement | null {
  return fixture.nativeElement.querySelector(
    `[data-testid="theme-option-${id}"]`
  ) as HTMLInputElement | null;
}

function popoverOptions(fixture: ReturnType<typeof setup>['fixture']): HTMLInputElement[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('[data-testid^="theme-option-"]')
  ) as HTMLInputElement[];
}

describe('ThemeSwitcherComponent', () => {
  it('renders the gear with data-testid="theme-gear"', () => {
    const { fixture } = setup();
    expect(gear(fixture)).toBeTruthy();
  });

  it('renders a container with data-testid="theme-switcher" wrapping the gear', () => {
    const { fixture } = setup();
    const container = fixture.nativeElement.querySelector(
      '[data-testid="theme-switcher"]'
    );
    expect(container).toBeTruthy();
    expect(container.contains(gear(fixture))).toBeTrue();
  });

  it('popover is closed by default — aria-expanded="false" and no options visible', () => {
    const { fixture } = setup();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(popoverOptions(fixture).length).toBe(0);
  });

  it('clicking the gear opens the popover and sets aria-expanded="true"', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the popover with exactly three options in canonical order', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();

    const opts = popoverOptions(fixture);
    expect(opts.length).toBe(3);
    expect(opts.map(o => o.getAttribute('data-testid'))).toEqual([
      'theme-option-light',
      'theme-option-dark',
      'theme-option-auto'
    ]);
  });

  it('clicking "light" sets preference="light"', () => {
    const { fixture, theme } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    option(fixture, 'light')!.click();
    option(fixture, 'light')!.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(theme.preference()).toBe('light');
  });

  it('clicking "dark" sets preference="dark"', () => {
    const { fixture, theme } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    option(fixture, 'dark')!.click();
    option(fixture, 'dark')!.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(theme.preference()).toBe('dark');
  });

  it('clicking "auto" sets preference="auto"', () => {
    const { fixture, theme } = setup();
    theme.setPreference('dark');
    fixture.detectChanges();

    gear(fixture).click();
    fixture.detectChanges();
    option(fixture, 'auto')!.click();
    option(fixture, 'auto')!.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(theme.preference()).toBe('auto');
  });

  it('marks the active option (Light → input is checked + aria-checked="true")', () => {
    const { fixture, theme } = setup();
    theme.setPreference('light');
    fixture.detectChanges();
    gear(fixture).click();
    fixture.detectChanges();

    const light = option(fixture, 'light')!;
    expect(light.checked).toBeTrue();
    expect(light.getAttribute('aria-checked')).toBe('true');
  });

  it('marks the active option (Dark → input is checked)', () => {
    const { fixture, theme } = setup();
    theme.setPreference('dark');
    fixture.detectChanges();
    gear(fixture).click();
    fixture.detectChanges();
    expect(option(fixture, 'dark')!.checked).toBeTrue();
  });

  it('marks the active option (Auto → input is checked by default)', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    expect(option(fixture, 'auto')!.checked).toBeTrue();
  });

  it('gear title carries the current preference + effective theme', () => {
    const { fixture, theme } = setup();
    theme.setPreference('dark');
    fixture.detectChanges();
    const title = (gear(fixture).getAttribute('title') ?? '').toLowerCase();
    expect(title).toContain('dark');
  });

  it('Escape key closes the popover', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    fixture.detectChanges();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('false');
  });

  it('click outside the popover closes it', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('true');

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(gear(fixture).getAttribute('aria-expanded')).toBe('false');
  });

  it('popover footer shows the effective and OS palette labels', () => {
    const { fixture } = setup();
    gear(fixture).click();
    fixture.detectChanges();

    const effective = fixture.nativeElement.querySelector(
      '[data-testid="theme-effective"]'
    );
    const os = fixture.nativeElement.querySelector('[data-testid="theme-os"]');
    expect(effective).toBeTruthy();
    expect(os).toBeTruthy();
    // OS=light per the matchMedia stub installed in setup().
    expect((os.textContent ?? '').trim()).toBe('light');
  });
});
