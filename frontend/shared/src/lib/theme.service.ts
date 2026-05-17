// Theme axis — `dashboard.theme` persistence + live OS-preference
// resolution + single-writer DOM mutation.
//
// SAD §7 "Visual layout" localStorage table + docs/ui/theme-options.md.
//
// Self-contained service — theme is a pure presentation concern with no
// data-contract implications, so unlike `LayoutPrefsService` /
// `CorrelationPrefsService` (which drive `DeploymentMatrixStore`), this
// service holds its own signals (`preference`, `effective`, `osDark`).
// Three reasons:
//   1. Palette swap never affects matrix data, derived signals, or any
//      box-state rendering — keeping it out of the store stops the store's
//      shape from leaking palette concerns into JSON wire payload tests.
//   2. The QA test oracle (theme.service.spec.ts) compiles against
//      `svc.preference()`, `svc.effective()`, `svc.osDark()`,
//      `svc.setPreference(...)`.
//   3. The matchMedia listener side effect is colocated with the consumers
//      of `effective()` — easier to reason about.
//
// SINGLE-WRITER guarantee: this service is the only code in the workspace
// that touches `document.documentElement.dataset.theme` and `.themePref`
// after Angular bootstraps. The FOIT-safe inline `<head>` script in
// `dashboard/src/index.html` paints the FIRST FRAME before this service
// exists; the service takes over thereafter.
//
// SAD load-time hardening (mirrors `correlation-prefs.service.ts`):
//   - missing key → DEFAULT_THEME_PREFERENCE (`'auto'`)
//   - unknown enum value → DEFAULT_THEME_PREFERENCE
//   - localStorage unreadable / disabled → DEFAULT_THEME_PREFERENCE; writes
//     silently ignored via `local-storage.ts`.

import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked
} from '@angular/core';
import { readEnum, writeString } from './local-storage';
import {
  DEFAULT_THEME_PREFERENCE,
  STORAGE_KEY_THEME,
  VALID_THEME_PREFERENCES,
  type EffectiveTheme,
  type ThemePreference
} from './view-config';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly destroyRef = inject(DestroyRef);

  /** Live OS `prefers-color-scheme: dark` value — updated by the MQL listener. */
  private readonly _osDark = signal<boolean>(readOsDarkSync());

  /** Readonly OS-dark signal. Drives the popover footer's "OS: dark/light" label. */
  readonly osDark = this._osDark.asReadonly();

  /** User preference — writable internally, readonly outside. Default `'auto'`. */
  private readonly _preference = signal<ThemePreference>(loadThemePreference());

  /** Readonly preference for consumers (popover radios, gear button tooltip). */
  readonly preference = this._preference.asReadonly();

  /**
   * Resolved palette — `auto` resolves against the live `osDark` signal so
   * OS-level flips re-render derived `effective()` consumers automatically.
   */
  readonly effective = computed<EffectiveTheme>(() =>
    resolveEffectiveTheme(this._preference(), this._osDark())
  );

  constructor() {
    // SINGLE-WRITER to <html data-theme> + <html data-theme-pref>.
    // Mirrors the mockup's `applyEffectiveTheme()` method
    // (docs/ui/deployment-dashboard.html lines 3512-3517). `untracked` so we
    // never accidentally depend on a signal we're about to mutate.
    effect(() => {
      const eff = this.effective();
      const pref = this._preference();
      untracked(() => {
        writeString(STORAGE_KEY_THEME, pref);
        applyThemeToDom(eff, pref);
      });
    });

    // Live OS-palette listener — re-resolve `effective()` whenever the OS
    // flips while the SPA is open. The effect above re-renders the DOM
    // attribute via the computed. The MQL is matched ONCE here, not on
    // every read, so listener-leaks are impossible.
    const mql = matchOsDarkQuery();
    if (mql) {
      const onChange = (ev: MediaQueryListEvent) => this._osDark.set(ev.matches);
      addMqlListener(mql, onChange);
      this.destroyRef.onDestroy(() => removeMqlListener(mql, onChange));
    }
  }

  /**
   * Set the user preference. Defensive — unknown ids are ignored. No-op
   * when unchanged so idempotent clicks don't trigger redundant
   * `localStorage.setItem` calls or DOM mutations.
   */
  setPreference(id: ThemePreference): void {
    if (!(VALID_THEME_PREFERENCES as readonly string[]).includes(id)) return;
    if (this._preference() === id) return;
    this._preference.set(id);
  }
}

// ----- pure helpers (also exported for unit tests) -------------------------

/**
 * Load the persisted theme preference. Returns DEFAULT_THEME_PREFERENCE
 * (`'auto'`) on missing / unknown / unreadable.
 */
export function loadThemePreference(): ThemePreference {
  return readEnum<ThemePreference>(
    STORAGE_KEY_THEME,
    VALID_THEME_PREFERENCES,
    DEFAULT_THEME_PREFERENCE
  );
}

/** Resolve `auto` against the OS-reported dark preference. Pure. */
export function resolveEffectiveTheme(
  pref: ThemePreference,
  osDark: boolean
): EffectiveTheme {
  if (pref === 'auto') return osDark ? 'dark' : 'light';
  return pref;
}

/** Synchronously read `prefers-color-scheme: dark`. Safe in test envs. */
export function readOsDarkSync(): boolean {
  const mql = matchOsDarkQuery();
  return mql ? mql.matches : false;
}

function matchOsDarkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
}

/** Cross-browser MQL listener attach. Safari < 14 used `addListener`. */
function addMqlListener(
  mql: MediaQueryList,
  fn: (ev: MediaQueryListEvent) => void
): void {
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', fn);
    return;
  }
  const legacyAdd = (mql as MediaQueryListLegacy).addListener;
  if (typeof legacyAdd === 'function') {
    legacyAdd.call(mql, fn);
  }
}

function removeMqlListener(
  mql: MediaQueryList,
  fn: (ev: MediaQueryListEvent) => void
): void {
  if (typeof mql.removeEventListener === 'function') {
    mql.removeEventListener('change', fn);
    return;
  }
  const legacyRemove = (mql as MediaQueryListLegacy).removeListener;
  if (typeof legacyRemove === 'function') {
    legacyRemove.call(mql, fn);
  }
}

interface MediaQueryListLegacy {
  addListener?: (fn: (ev: MediaQueryListEvent) => void) => void;
  removeListener?: (fn: (ev: MediaQueryListEvent) => void) => void;
}

/**
 * Apply the effective palette to `<html>`. Single-writer per the
 * `ThemeService` invariant — no other code in the workspace mutates
 * `data-theme` or `data-theme-pref` after Angular bootstraps. Safe in
 * SSR / test environments without a `document`.
 */
export function applyThemeToDom(eff: EffectiveTheme, pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', eff);
  root.setAttribute('data-theme-pref', pref);
}
