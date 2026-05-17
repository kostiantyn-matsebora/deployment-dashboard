// Theme axis — `dashboard.theme` persistence + auto resolution +
// MediaQueryList live-flip behaviour.
//
// Contract under test (aligned with the implementation contract
// authored in parallel by frontend-engineer):
//   - localStorage key `dashboard.theme` ∈ {'light', 'dark', 'auto'},
//     default 'auto'
//   - `loadThemePreference()` (pure helper) — corruption-safe; falls
//     back to 'auto' on missing / unknown / unreadable storage
//   - `ThemeService` (Angular service, providedIn: 'root') —
//       preference: Signal<ThemePreference>     // user's persisted pick
//       effective:  Signal<'light' | 'dark'>    // resolved palette
//       osDark:     Signal<boolean>             // live OS-reported value
//       setPreference(pref: ThemePreference): void
//     Single source of mutation for <html data-theme> + <html data-theme-pref>.
//
// Sources of truth:
//   - docs/ui/theme-options.md — persistence table + auto resolution
//   - docs/ui/deployment-dashboard.html lines 187–198 (FOIT bootstrap)
//     and 3440–3461 (MQL change listener)
//   - docs/deployment-dashboard-architecture.md §7 — Theme axis +
//     `dashboard.theme` localStorage row
//
// Authored in parallel with frontend implementation per the
// parallel-by-default rule in CLAUDE.md "Cross-domain bugs —
// integration + compliance cycle".

import { TestBed } from '@angular/core/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { ThemeService } from './theme.service';
import { STORAGE_KEY_THEME } from './view-config';
import { loadThemePreference } from './theme.service';

// ----- matchMedia stub helpers ----------------------------------------

interface MqlStub {
  matches: boolean;
  readonly listeners: Array<(e: { matches: boolean }) => void>;
  addEventListener(type: 'change', cb: (e: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', cb: (e: { matches: boolean }) => void): void;
  /** Test helper — invokes every registered listener with the given value. */
  fire(matches: boolean): void;
}

function installMatchMediaStub(initialDark: boolean): MqlStub {
  const stub: MqlStub = {
    matches: initialDark,
    listeners: [],
    addEventListener(_type, cb) { this.listeners.push(cb); },
    removeEventListener(_type, cb) {
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

function prepare(): void {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()]
  });
}

function makeService(): ThemeService {
  prepare();
  return TestBed.inject(ThemeService);
}

function readDataset(): { theme: string | null; pref: string | null } {
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    pref: document.documentElement.getAttribute('data-theme-pref'),
  };
}

// ----- pure-helper coverage -------------------------------------------

describe('ThemeService — loadThemePreference()', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
  });

  it('returns the default "auto" when localStorage is empty', () => {
    expect(loadThemePreference()).toBe('auto');
  });

  it('returns "light" when the stored value is "light"', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'light');
    expect(loadThemePreference()).toBe('light');
  });

  it('returns "dark" when the stored value is "dark"', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    expect(loadThemePreference()).toBe('dark');
  });

  it('returns "auto" when the stored value is "auto"', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'auto');
    expect(loadThemePreference()).toBe('auto');
  });

  it('falls back to "auto" on an unknown enum value', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'system');
    expect(loadThemePreference()).toBe('auto');
  });

  it('falls back to "auto" on case-mismatched values (enum is case-sensitive)', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'Dark');
    expect(loadThemePreference()).toBe('auto');
  });

  it('falls back to "auto" on JSON garbage', () => {
    localStorage.setItem(STORAGE_KEY_THEME, '{"theme":"dark"}');
    expect(loadThemePreference()).toBe('auto');
  });

  it('falls back to "auto" on the empty string', () => {
    localStorage.setItem(STORAGE_KEY_THEME, '');
    expect(loadThemePreference()).toBe('auto');
  });
});

// ----- hydrate-on-construction ----------------------------------------

describe('ThemeService — hydrate on construction', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
    installMatchMediaStub(false);
  });

  it('seeds preference="auto" when nothing is persisted', () => {
    const svc = makeService();
    expect(svc.preference()).toBe('auto');
  });

  it('hydrates preference="light" from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'light');
    const svc = makeService();
    expect(svc.preference()).toBe('light');
  });

  it('hydrates preference="dark" from localStorage', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    const svc = makeService();
    expect(svc.preference()).toBe('dark');
  });

  it('falls back to "auto" when the persisted value is garbage', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'garbage');
    const svc = makeService();
    expect(svc.preference()).toBe('auto');
  });

  it('a corrupt persisted value does not throw on construction', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'not-a-theme');
    expect(() => makeService()).not.toThrow();
  });
});

// ----- write-back persistence -----------------------------------------

describe('ThemeService — write-back persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
    installMatchMediaStub(false);
  });

  it('writes "dark" to localStorage when setPreference("dark") is called', () => {
    const svc = makeService();
    svc.setPreference('dark');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_THEME)).toBe('dark');
  });

  it('writes "light" to localStorage', () => {
    const svc = makeService();
    svc.setPreference('light');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_THEME)).toBe('light');
  });

  it('writes "auto" to localStorage', () => {
    const svc = makeService();
    svc.setPreference('dark');
    TestBed.inject(ApplicationRef).tick();
    svc.setPreference('auto');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem(STORAGE_KEY_THEME)).toBe('auto');
  });
});

// ----- effective-theme derivation -------------------------------------

describe('ThemeService — effective theme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
  });

  it('effective === "dark" when preference === "auto" AND OS reports dark', () => {
    installMatchMediaStub(true);
    const svc = makeService();
    expect(svc.preference()).toBe('auto');
    expect(svc.effective()).toBe('dark');
  });

  it('effective === "light" when preference === "auto" AND OS reports light', () => {
    installMatchMediaStub(false);
    const svc = makeService();
    expect(svc.preference()).toBe('auto');
    expect(svc.effective()).toBe('light');
  });

  it('effective === "dark" when preference === "dark", regardless of OS=light', () => {
    installMatchMediaStub(false);
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    const svc = makeService();
    expect(svc.preference()).toBe('dark');
    expect(svc.effective()).toBe('dark');
  });

  it('effective === "light" when preference === "light", regardless of OS=dark', () => {
    installMatchMediaStub(true);
    localStorage.setItem(STORAGE_KEY_THEME, 'light');
    const svc = makeService();
    expect(svc.preference()).toBe('light');
    expect(svc.effective()).toBe('light');
  });
});

// ----- MQL change listener --------------------------------------------

describe('ThemeService — MediaQueryList live OS flip', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
  });

  it('flips effective theme when preference === "auto" and the MQL fires', () => {
    const mql = installMatchMediaStub(false);
    const svc = makeService();
    expect(svc.effective()).toBe('light');

    mql.fire(true);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('dark');

    mql.fire(false);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('light');
  });

  it('does NOT flip effective theme when preference === "dark" and the MQL fires', () => {
    const mql = installMatchMediaStub(false);
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    const svc = makeService();
    expect(svc.effective()).toBe('dark');

    mql.fire(true);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('dark');

    mql.fire(false);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('dark');
  });

  it('does NOT flip effective theme when preference === "light" and the MQL fires', () => {
    const mql = installMatchMediaStub(true);
    localStorage.setItem(STORAGE_KEY_THEME, 'light');
    const svc = makeService();
    expect(svc.effective()).toBe('light');

    mql.fire(false);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('light');

    mql.fire(true);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.effective()).toBe('light');
  });

  it('osDark signal tracks the MQL value regardless of preference', () => {
    const mql = installMatchMediaStub(false);
    localStorage.setItem(STORAGE_KEY_THEME, 'light');
    const svc = makeService();
    // Even when explicit preference is 'light', osDark should still reflect
    // the OS so the popover footer can show "OS: dark / OS: light".
    expect(svc.osDark()).toBe(false);

    mql.fire(true);
    TestBed.inject(ApplicationRef).tick();
    expect(svc.osDark()).toBe(true);
  });
});

// ----- <html data-theme> mutation -------------------------------------

describe('ThemeService — <html> dataset mutation (single writer)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['themePref'];
    installMatchMediaStub(false);
  });

  it('writes <html data-theme="dark"> when preference="dark"', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    makeService();
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().theme).toBe('dark');
  });

  it('writes <html data-theme-pref="dark"> when preference="dark"', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'dark');
    makeService();
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().pref).toBe('dark');
  });

  it('updates <html data-theme> when setPreference changes', () => {
    const svc = makeService();
    svc.setPreference('dark');
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().theme).toBe('dark');

    svc.setPreference('light');
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().theme).toBe('light');
  });

  it('updates <html data-theme> when MQL fires under preference="auto"', () => {
    const mql = installMatchMediaStub(false);
    makeService();
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().theme).toBe('light');

    mql.fire(true);
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().theme).toBe('dark');
  });

  it('normalises a corrupt persisted value: <html data-theme-pref="auto">', () => {
    localStorage.setItem(STORAGE_KEY_THEME, 'garbage');
    makeService();
    TestBed.inject(ApplicationRef).tick();
    expect(readDataset().pref).toBe('auto');
  });
});
