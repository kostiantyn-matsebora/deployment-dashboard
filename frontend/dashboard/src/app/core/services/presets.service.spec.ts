/**
 * PresetsService — unit tests.
 *
 * Strategy: real PresetsService injected by TestBed using the real
 * AppStateService, ThemeService, and NotificationPrefsService (no mocks).
 *
 * Because all three services are `providedIn: 'root'` and use no HTTP or
 * external deps, they can be used directly — only localStorage is stubbed
 * by clearing it before each test.
 *
 * Covers:
 *   - captureSettings: snapshots all signals from real services
 *   - save: stores a new envelope and refreshes signal
 *   - apply: writes all settings back to real service signals
 *   - apply fallback: missing/unknown fields leave existing values unchanged
 *   - clone: copies source settings under a new name
 *   - rename: renames a preset in-place
 *   - delete: removes the target preset
 *   - exportPreset: produces slug, serializes envelope (document.createElement patched)
 *   - validateImport: rejects array, rejects wrong version, accepts valid envelope
 *   - importPreset: appends to store
 *   - toSlug: lower-case hyphenation
 *   - loadFromStorage: hydrates on construct; ignores malformed data
 *   - no-preset state: presets() empty when storage is empty
 */
import { TestBed }      from '@angular/core/testing';
import { DOCUMENT }     from '@angular/common';
import { vi }           from 'vitest';

import { PresetsService, PresetEnvelope } from './presets.service';
import { AppStateService }                from './app-state.service';
import { ThemeService }                   from './theme.service';
import { NotificationPrefsService }       from './notification-prefs.service';

const STORAGE_KEY = 'dd:presets';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEnvelope(name = 'test', overrides: Partial<PresetEnvelope['settings']> = {}): PresetEnvelope {
  return {
    version: 1,
    name,
    settings: {
      theme:             'dark',
      notifEnabled:      false,
      notifStatuses:     ['success', 'failure'],
      notifServiceMode:  'watch-all-except',
      notifServiceChips: [],
      notifEnvMode:      'watch-all-except',
      notifEnvChips:     [],
      view:              'matrix',
      svcFilterMode:     'exclude',
      svcPatterns:       [],
      failOnly:          false,
      matFields:         ['version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at'],
      swFields:          ['environment', 'version', 'run_url', 'sha', 'run_number', 'ref', 'actor', 'happened_at'],
      colOrder:          [],
      colHidden:         [],
      swimCollapsed:     [],
      swimAutoScroll:    true,
      timeWindow:        '1 day',
      correlation:       'explicit parent',
      ...overrides,
    },
  };
}

// ── setup ─────────────────────────────────────────────────────────────────────

describe('PresetsService', () => {
  let service:       PresetsService;
  let state:         AppStateService;
  let themeService:  ThemeService;
  let notifPrefs:    NotificationPrefsService;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      providers: [
        PresetsService,
        AppStateService,
        ThemeService,
        NotificationPrefsService,
        {
          provide: DOCUMENT,
          useValue: document,
        },
      ],
    }).compileComponents();

    service      = TestBed.inject(PresetsService);
    state        = TestBed.inject(AppStateService);
    themeService = TestBed.inject(ThemeService);
    notifPrefs   = TestBed.inject(NotificationPrefsService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  // ── no-preset state ────────────────────────────────────────────────────────

  describe('no-preset state', () => {
    it('presets() is an empty array when storage is empty', () => {
      expect(service.presets()).toEqual([]);
    });
  });

  // ── captureSettings ────────────────────────────────────────────────────────

  describe('captureSettings()', () => {
    it('captures the current theme from ThemeService', () => {
      themeService.setTheme('light');
      const snap = service.captureSettings();
      expect(snap.theme).toBe('light');
    });

    it('captures failOnly from AppStateService', () => {
      state.failuresOnly.set(true);
      expect(service.captureSettings().failOnly).toBe(true);
    });

    it('captures view from AppStateService', () => {
      state.activeView.set('analytics');
      expect(service.captureSettings().view).toBe('analytics');
    });

    it('captures svcPatterns from AppStateService', () => {
      state.servicePatterns.set(['*-api', 'auth-bff']);
      expect(service.captureSettings().svcPatterns).toEqual(['*-api', 'auth-bff']);
    });

    it('captures notifEnabled from NotificationPrefsService', () => {
      notifPrefs.updatePrefs({ enabled: true });
      expect(service.captureSettings().notifEnabled).toBe(true);
    });

    it('captures notifStatuses from NotificationPrefsService', () => {
      notifPrefs.updatePrefs({ statuses: ['success'] });
      const snap = service.captureSettings();
      expect(snap.notifStatuses).toEqual(['success']);
    });

    it('captures swimAutoScroll from AppStateService', () => {
      state.autoScrollOnChange.set(false);
      expect(service.captureSettings().swimAutoScroll).toBe(false);
    });

    it('captures timeWindow from AppStateService', () => {
      state.timeWindow.set('7 days');
      expect(service.captureSettings().timeWindow).toBe('7 days');
    });

    it('captures correlation from AppStateService', () => {
      state.correlationPredicate.set('same sha');
      expect(service.captureSettings().correlation).toBe('same sha');
    });
  });

  // ── save ──────────────────────────────────────────────────────────────────

  describe('save()', () => {
    it('appends a new preset and refreshes the signal', () => {
      service.save('My Preset');
      const presets = service.presets();
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('My Preset');
      expect(presets[0].version).toBe(1);
    });

    it('trims the name', () => {
      service.save('  trimmed  ');
      expect(service.presets()[0].name).toBe('trimmed');
    });

    it('ignores blank names', () => {
      service.save('   ');
      expect(service.presets()).toHaveLength(0);
    });

    it('persists to localStorage', () => {
      service.save('Persistent');
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Persistent');
    });

    it('can save multiple presets', () => {
      service.save('Alpha');
      service.save('Beta');
      expect(service.presets()).toHaveLength(2);
    });
  });

  // ── apply ────────────────────────────────────────────────────────────────

  describe('apply()', () => {
    it('sets theme on ThemeService', () => {
      themeService.setTheme('dark');
      service.apply(makeEnvelope('t', { theme: 'light' }));
      expect(themeService.theme()).toBe('light');
    });

    it('sets activeView on AppStateService', () => {
      state.activeView.set('matrix');
      service.apply(makeEnvelope('t', { view: 'analytics' }));
      expect(state.activeView()).toBe('analytics');
    });

    it('sets failuresOnly on AppStateService', () => {
      state.failuresOnly.set(false);
      service.apply(makeEnvelope('t', { failOnly: true }));
      expect(state.failuresOnly()).toBe(true);
    });

    it('sets serviceFilterMode on AppStateService', () => {
      state.serviceFilterMode.set('exclude');
      service.apply(makeEnvelope('t', { svcFilterMode: 'include' }));
      expect(state.serviceFilterMode()).toBe('include');
    });

    it('sets svcPatterns on AppStateService', () => {
      state.servicePatterns.set([]);
      service.apply(makeEnvelope('t', { svcPatterns: ['*-api'] }));
      expect(state.servicePatterns()).toEqual(['*-api']);
    });

    it('sets swimAutoScroll on AppStateService', () => {
      state.autoScrollOnChange.set(true);
      service.apply(makeEnvelope('t', { swimAutoScroll: false }));
      expect(state.autoScrollOnChange()).toBe(false);
    });

    it('sets timeWindow on AppStateService', () => {
      state.timeWindow.set('1 day');
      service.apply(makeEnvelope('t', { timeWindow: '7 days' }));
      expect(state.timeWindow()).toBe('7 days');
    });

    it('sets correlationPredicate on AppStateService', () => {
      state.correlationPredicate.set('explicit parent');
      service.apply(makeEnvelope('t', { correlation: 'same sha' }));
      expect(state.correlationPredicate()).toBe('same sha');
    });

    it('sets notifEnabled on NotificationPrefsService', () => {
      notifPrefs.updatePrefs({ enabled: false });
      service.apply(makeEnvelope('t', { notifEnabled: true }));
      expect(notifPrefs.prefs().enabled).toBe(true);
    });

    it('sets notifStatuses on NotificationPrefsService, filtering invalid values', () => {
      notifPrefs.updatePrefs({ statuses: ['success', 'failure'] });
      service.apply(makeEnvelope('t', { notifStatuses: ['success', 'INVALID_STATUS'] }));
      expect(notifPrefs.prefs().statuses).toEqual(['success']);
    });

    it('sets matrixVisibleFields from matFields array', () => {
      service.apply(makeEnvelope('t', { matFields: ['version', 'actor'] }));
      const fields = state.matrixVisibleFields();
      expect(fields.has('version')).toBe(true);
      expect(fields.has('actor')).toBe(true);
      expect(fields.has('sha')).toBe(false);
    });

    it('falls back to all fields when matFields is empty array', () => {
      service.apply(makeEnvelope('t', { matFields: [] }));
      const fields = state.matrixVisibleFields();
      expect(fields.size).toBe(7); // all MATRIX_FIELDS
    });

    it('sets colHidden as Set from array', () => {
      service.apply(makeEnvelope('t', { colHidden: ['prod', 'preprod'] }));
      expect(state.matrixColHidden().has('prod')).toBe(true);
      expect(state.matrixColHidden().has('preprod')).toBe(true);
      expect(state.matrixColHidden().has('dev')).toBe(false);
    });

    it('leaves unknown fields unchanged (fallback)', () => {
      const currentTheme = themeService.theme();
      const env: PresetEnvelope = {
        version: 1,
        name: 'partial',
        settings: { failOnly: true }, // only sets failOnly; theme left alone
      };
      service.apply(env);
      expect(themeService.theme()).toBe(currentTheme);
      expect(state.failuresOnly()).toBe(true);
    });

    it('ignores invalid theme strings', () => {
      themeService.setTheme('dark');
      const env: PresetEnvelope = {
        version: 1,
        name: 'bad-theme',
        settings: { theme: 'neon' as never },
      };
      service.apply(env);
      expect(themeService.theme()).toBe('dark');
    });

    it('ignores invalid timeWindow strings', () => {
      state.timeWindow.set('1 day');
      const env: PresetEnvelope = {
        version: 1,
        name: 'bad-tw',
        settings: { timeWindow: 'forever' as never },
      };
      service.apply(env);
      expect(state.timeWindow()).toBe('1 day');
    });

    it('ignores invalid correlation predicate strings', () => {
      state.correlationPredicate.set('explicit parent');
      const env: PresetEnvelope = {
        version: 1,
        name: 'bad-corr',
        settings: { correlation: 'random' as never },
      };
      service.apply(env);
      expect(state.correlationPredicate()).toBe('explicit parent');
    });
  });

  // ── clone ────────────────────────────────────────────────────────────────

  describe('clone()', () => {
    it('creates a new preset with the given name and source settings', () => {
      service.save('Original');
      const original = service.presets()[0];
      service.clone(original, 'Copy');
      const all = service.presets();
      expect(all).toHaveLength(2);
      const copy = all.find((p) => p.name === 'Copy');
      expect(copy).toBeDefined();
      expect(copy?.settings).toEqual(original.settings);
    });

    it('ignores blank clone names', () => {
      service.save('A');
      const a = service.presets()[0];
      service.clone(a, '  ');
      expect(service.presets()).toHaveLength(1);
    });

    it('does not mutate the original', () => {
      service.save('Src');
      const src = service.presets()[0];
      service.clone(src, 'Dst');
      expect(service.presets()[0]).toBe(src);
    });
  });

  // ── rename ────────────────────────────────────────────────────────────────

  describe('rename()', () => {
    it('renames the target preset in-place', () => {
      service.save('OldName');
      const target = service.presets()[0];
      service.rename(target, 'NewName');
      expect(service.presets()[0].name).toBe('NewName');
    });

    it('trims whitespace from the new name', () => {
      service.save('A');
      const target = service.presets()[0];
      service.rename(target, '  Trimmed  ');
      expect(service.presets()[0].name).toBe('Trimmed');
    });

    it('ignores blank new names', () => {
      service.save('Keep');
      const target = service.presets()[0];
      service.rename(target, '');
      expect(service.presets()[0].name).toBe('Keep');
    });

    it('only renames the target, leaving other presets unchanged', () => {
      service.save('Alpha');
      service.save('Beta');
      const beta = service.presets().find((p) => p.name === 'Beta')!;
      service.rename(beta, 'Gamma');
      const names = service.presets().map((p) => p.name);
      expect(names).toContain('Alpha');
      expect(names).toContain('Gamma');
      expect(names).not.toContain('Beta');
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the target preset', () => {
      service.save('Del');
      const target = service.presets()[0];
      service.delete(target);
      expect(service.presets()).toHaveLength(0);
    });

    it('only removes the matching reference, leaving others', () => {
      service.save('A');
      service.save('B');
      const b = service.presets().find((p) => p.name === 'B')!;
      service.delete(b);
      expect(service.presets()).toHaveLength(1);
      expect(service.presets()[0].name).toBe('A');
    });

    it('deleting from an empty list is a no-op', () => {
      const phantom: PresetEnvelope = { version: 1, name: 'ghost', settings: {} };
      service.delete(phantom);
      expect(service.presets()).toHaveLength(0);
    });
  });

  // ── exportPreset ──────────────────────────────────────────────────────────

  describe('exportPreset()', () => {
    it('creates an <a> element and triggers download without throwing', () => {
      // Patch document.createElement to intercept the anchor creation.
      const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      const anchor = document.createElement('a');
      const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => {});
      const createSpy = vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);

      const env = makeEnvelope('My Config');
      expect(() => service.exportPreset(env)).not.toThrow();

      expect(createSpy).toHaveBeenCalledWith('a');
      expect(clickSpy).toHaveBeenCalled();
      expect(anchor.download).toBe('dd-preset-my-config.json');

      appendSpy.mockRestore();
      removeSpy.mockRestore();
      createSpy.mockRestore();
    });
  });

  // ── validateImport ────────────────────────────────────────────────────────

  describe('validateImport()', () => {
    it('returns a string error for invalid JSON', () => {
      const result = service.validateImport('{not-valid-json}');
      expect(typeof result).toBe('string');
    });

    it('returns a string error for JSON array', () => {
      const result = service.validateImport('[{"version":1,"name":"a","settings":{}}]');
      expect(typeof result).toBe('string');
      expect(result as string).toContain('array');
    });

    it('returns a string error for wrong version', () => {
      const result = service.validateImport('{"version":2,"name":"x","settings":{}}');
      expect(typeof result).toBe('string');
      expect(result as string).toContain('version');
    });

    it('returns a string error for missing name', () => {
      const result = service.validateImport('{"version":1,"name":"","settings":{}}');
      expect(typeof result).toBe('string');
    });

    it('returns a string error for missing settings', () => {
      const result = service.validateImport('{"version":1,"name":"x"}');
      expect(typeof result).toBe('string');
    });

    it('returns a PresetEnvelope for a valid single envelope', () => {
      const raw = JSON.stringify(makeEnvelope('Good'));
      const result = service.validateImport(raw);
      expect(typeof result).not.toBe('string');
      expect((result as PresetEnvelope).name).toBe('Good');
      expect((result as PresetEnvelope).version).toBe(1);
    });

    it('trims the name in the returned envelope', () => {
      const raw = JSON.stringify({ version: 1, name: '  spaces  ', settings: {} });
      const result = service.validateImport(raw);
      expect((result as PresetEnvelope).name).toBe('spaces');
    });
  });

  // ── importPreset ──────────────────────────────────────────────────────────

  describe('importPreset()', () => {
    it('appends the envelope to the presets list', () => {
      service.save('Existing');
      const imported = makeEnvelope('Imported');
      service.importPreset(imported);
      expect(service.presets()).toHaveLength(2);
      expect(service.presets()[1].name).toBe('Imported');
    });

    it('suffixes with " (2)" when a preset with the same name already exists', () => {
      service.save('Duplicate');
      service.importPreset(makeEnvelope('Duplicate'));
      expect(service.presets()).toHaveLength(2);
      expect(service.presets()[1].name).toBe('Duplicate (2)');
    });

    it('increments the counter until unique: " (3)" when " (2)" is also taken', () => {
      service.save('Duplicate');
      service.importPreset(makeEnvelope('Duplicate'));    // becomes 'Duplicate (2)'
      service.importPreset(makeEnvelope('Duplicate'));    // becomes 'Duplicate (3)'
      expect(service.presets()).toHaveLength(3);
      expect(service.presets()[2].name).toBe('Duplicate (3)');
    });

    it('does not suffix when the name is unique', () => {
      service.save('Alpha');
      service.importPreset(makeEnvelope('Beta'));
      expect(service.presets()[1].name).toBe('Beta');
    });
  });

  // ── toSlug ────────────────────────────────────────────────────────────────

  describe('toSlug()', () => {
    it('converts spaces to hyphens', () => {
      expect(service.toSlug('My Preset')).toBe('my-preset');
    });

    it('lowercases the result', () => {
      expect(service.toSlug('UPPER CASE')).toBe('upper-case');
    });

    it('strips leading and trailing hyphens', () => {
      expect(service.toSlug('  hello  ')).toBe('hello');
    });

    it('collapses multiple special chars into a single hyphen', () => {
      expect(service.toSlug('prod -- v2 (final!)')).toBe('prod-v2-final');
    });

    it('falls back to "preset" for a blank name', () => {
      expect(service.toSlug('')).toBe('preset');
    });
  });

  // ── loadFromStorage ────────────────────────────────────────────────────────

  describe('loadFromStorage / hydration', () => {
    it('hydrates stored presets on service construction', async () => {
      const stored: PresetEnvelope[] = [makeEnvelope('Hydrated')];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

      // Reset and rebuild the service so it reads from the pre-populated store.
      TestBed.resetTestingModule();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); // keep after reset
      await TestBed.configureTestingModule({
        providers: [PresetsService, AppStateService, ThemeService, NotificationPrefsService, { provide: DOCUMENT, useValue: document }],
      }).compileComponents();
      const freshService = TestBed.inject(PresetsService);

      expect(freshService.presets()).toHaveLength(1);
      expect(freshService.presets()[0].name).toBe('Hydrated');
    });

    it('ignores malformed localStorage entries gracefully', async () => {
      localStorage.setItem(STORAGE_KEY, 'not-json{{{');

      TestBed.resetTestingModule();
      localStorage.setItem(STORAGE_KEY, 'not-json{{{');
      await TestBed.configureTestingModule({
        providers: [PresetsService, AppStateService, ThemeService, NotificationPrefsService, { provide: DOCUMENT, useValue: document }],
      }).compileComponents();
      const freshService = TestBed.inject(PresetsService);

      expect(freshService.presets()).toEqual([]);
    });

    it('ignores array entries without required fields', async () => {
      const bad = [{ foo: 'bar' }, { version: 1 }]; // missing name / settings
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bad));

      TestBed.resetTestingModule();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bad));
      await TestBed.configureTestingModule({
        providers: [PresetsService, AppStateService, ThemeService, NotificationPrefsService, { provide: DOCUMENT, useValue: document }],
      }).compileComponents();
      const freshService = TestBed.inject(PresetsService);

      expect(freshService.presets()).toEqual([]);
    });
  });
});
