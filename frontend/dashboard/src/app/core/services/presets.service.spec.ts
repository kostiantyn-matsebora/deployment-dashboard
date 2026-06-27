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

const STORAGE_KEY        = 'dd:presets';
const ACTIVE_STORAGE_KEY = 'dd:presetActive';

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
      svcFilter:         '',
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

    it('captures svcFilter from AppStateService', () => {
      state.serviceFilter.set('auth');
      expect(service.captureSettings().svcFilter).toBe('auth');
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

    it('sets serviceFilter on AppStateService', () => {
      state.serviceFilter.set('');
      service.apply(makeEnvelope('t', { svcFilter: 'auth' }));
      expect(state.serviceFilter()).toBe('auth');
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

  // ── update ────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('replaces the target preset settings with the current live settings', () => {
      service.save('Snapshot');
      const target = service.presets()[0];
      // Change a live signal so the re-capture differs from the original
      themeService.setTheme('light');
      service.update(target);
      const updated = service.presets()[0];
      expect(updated.name).toBe('Snapshot');
      expect(updated.version).toBe(1);
      expect(updated.settings.theme).toBe('light');
    });

    it('preserves the preset name and version after update', () => {
      service.save('StableName');
      const target = service.presets()[0];
      state.failuresOnly.set(true);
      service.update(target);
      const updated = service.presets()[0];
      expect(updated.name).toBe('StableName');
      expect(updated.version).toBe(1);
    });

    it('re-captures current settings into the existing envelope (replaced settings)', () => {
      service.save('ToUpdate');
      const target = service.presets()[0];
      const settingsBefore = target.settings.failOnly;
      state.failuresOnly.set(!settingsBefore);
      service.update(target);
      expect(service.presets()[0].settings.failOnly).toBe(!settingsBefore);
    });

    it('only updates the target preset, leaving others unchanged', () => {
      service.save('Alpha');
      service.save('Beta');
      const alpha = service.presets().find((p) => p.name === 'Alpha')!;
      themeService.setTheme('dark');
      service.update(alpha);
      const betaAfter = service.presets().find((p) => p.name === 'Beta')!;
      expect(betaAfter).toBeDefined();
      expect(service.presets()).toHaveLength(2);
    });

    it('persists the updated preset to localStorage', () => {
      service.save('Persist');
      const target = service.presets()[0];
      state.failuresOnly.set(true);
      service.update(target);
      const raw = localStorage.getItem('dd:presets');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed[0].settings.failOnly).toBe(true);
    });
  });

  // ── resetAllSettings ─────────────────────────────────────────────────────

  describe('resetAllSettings()', () => {
    it('resets theme to dark', () => {
      themeService.setTheme('light');
      service.resetAllSettings();
      expect(themeService.theme()).toBe('dark');
    });

    it('resets failuresOnly to false', () => {
      state.failuresOnly.set(true);
      service.resetAllSettings();
      expect(state.failuresOnly()).toBe(false);
    });

    it('resets servicePatterns to empty array', () => {
      state.servicePatterns.set(['*-api', 'bff']);
      service.resetAllSettings();
      expect(state.servicePatterns()).toEqual([]);
    });

    it('resets serviceFilter to empty string', () => {
      state.serviceFilter.set('auth');
      service.resetAllSettings();
      expect(state.serviceFilter()).toBe('');
    });

    it('resets serviceFilterMode to exclude', () => {
      state.serviceFilterMode.set('include');
      service.resetAllSettings();
      expect(state.serviceFilterMode()).toBe('exclude');
    });

    it('resets matrixVisibleFields to all fields', () => {
      state.matrixVisibleFields.set(new Set(['version']));
      service.resetAllSettings();
      expect(state.matrixVisibleFields().size).toBe(7); // all MATRIX_FIELDS
    });

    it('resets autoScrollOnChange to true', () => {
      state.autoScrollOnChange.set(false);
      service.resetAllSettings();
      expect(state.autoScrollOnChange()).toBe(true);
    });

    it('resets notif prefs to defaults', () => {
      notifPrefs.updatePrefs({ enabled: true, statuses: ['queued'], serviceChips: ['svc-a'] });
      service.resetAllSettings();
      const p = notifPrefs.prefs();
      expect(p.enabled).toBe(false);
      expect(p.statuses).toContain('success');
      expect(p.statuses).toContain('failure');
      expect(p.serviceChips).toEqual([]);
    });

    it('resets timeWindow to "1 day"', () => {
      state.timeWindow.set('7 days');
      service.resetAllSettings();
      expect(state.timeWindow()).toBe('1 day');
    });

    it('resets correlationPredicate to "explicit parent"', () => {
      state.correlationPredicate.set('same sha');
      service.resetAllSettings();
      expect(state.correlationPredicate()).toBe('explicit parent');
    });
  });

  // ── apply propagation regression ──────────────────────────────────────────
  //
  // Regression gate: apply() MUST write the preset's filter settings to the
  // live app-state signals — not just persist to localStorage.  A consumer
  // reading the signals (e.g. MatrixComponent.filteredRows) will reactively
  // see different data after apply().

  describe('apply() propagation regression', () => {
    it('applies svcPatterns and serviceFilterMode to app-state signals immediately', () => {
      // Start with no filter
      state.servicePatterns.set([]);
      state.serviceFilterMode.set('exclude');

      // Save a preset with a distinctive exclude pattern
      state.servicePatterns.set(['except-svc*']);
      state.serviceFilterMode.set('exclude');
      service.save('filter-preset');

      // Undo the filter (simulate user changing settings after saving)
      state.servicePatterns.set([]);
      state.serviceFilterMode.set('exclude');
      expect(state.servicePatterns()).toEqual([]);

      // Apply the preset — signals must change immediately
      service.apply(service.presets()[0]);

      expect(state.servicePatterns()).toEqual(['except-svc*']);
      expect(state.serviceFilterMode()).toBe('exclude');
    });

    it('applies failuresOnly change to app-state signal immediately', () => {
      // Save a preset with failOnly = true
      state.failuresOnly.set(true);
      service.save('fail-only');

      // Change it
      state.failuresOnly.set(false);
      expect(state.failuresOnly()).toBe(false);

      // Apply — the SIGNAL (not just localStorage) must reflect the change
      service.apply(service.presets()[0]);

      expect(state.failuresOnly()).toBe(true);
    });

    it('applies theme change to ThemeService signal immediately', () => {
      themeService.setTheme('dark');
      service.save('light-theme');
      // (captured theme is 'dark' in the preset just saved)

      // Switch to light, save a preset
      themeService.setTheme('light');
      service.save('light-theme-2');

      // Apply the first preset (dark) — ThemeService.theme() must change
      service.apply(service.presets()[0]);
      expect(themeService.theme()).toBe('dark');
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

  // ── activePresetName ─────────────────────────────────────────────────────

  describe('activePresetName', () => {
    it('is null when no preset has been applied', () => {
      expect(service.activePresetName()).toBeNull();
    });

    it('apply() marks the applied preset active', () => {
      service.save('Alpha');
      const alpha = service.presets()[0];
      service.apply(alpha);
      expect(service.activePresetName()).toBe('Alpha');
    });

    it('apply() persists the active name to localStorage', () => {
      service.save('Bravo');
      service.apply(service.presets()[0]);
      expect(localStorage.getItem(ACTIVE_STORAGE_KEY)).toBe('Bravo');
    });

    it('activePresetName survives a fresh service construction (persisted)', async () => {
      service.save('Charlie');
      service.apply(service.presets()[0]);

      TestBed.resetTestingModule();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(service.presets()));
      // dd:presetActive is already set by the apply() call above
      await TestBed.configureTestingModule({
        providers: [PresetsService, AppStateService, ThemeService, NotificationPrefsService, { provide: DOCUMENT, useValue: document }],
      }).compileComponents();
      const freshService = TestBed.inject(PresetsService);

      expect(freshService.activePresetName()).toBe('Charlie');
    });

    it('resetAllSettings() clears activePresetName', () => {
      service.save('Delta');
      service.apply(service.presets()[0]);
      expect(service.activePresetName()).toBe('Delta');

      service.resetAllSettings();
      expect(service.activePresetName()).toBeNull();
      expect(localStorage.getItem(ACTIVE_STORAGE_KEY)).toBeNull();
    });

    it('delete() of the active preset clears activePresetName', () => {
      service.save('Echo');
      const echo = service.presets()[0];
      service.apply(echo);
      expect(service.activePresetName()).toBe('Echo');

      service.delete(echo);
      expect(service.activePresetName()).toBeNull();
      expect(localStorage.getItem(ACTIVE_STORAGE_KEY)).toBeNull();
    });

    it('delete() of a non-active preset does not clear activePresetName', () => {
      service.save('Foxtrot');
      service.save('Golf');
      const foxtrot = service.presets()[0];
      const golf    = service.presets()[1];
      service.apply(foxtrot);

      service.delete(golf);
      expect(service.activePresetName()).toBe('Foxtrot');
    });

    it('rename() of the active preset follows the new name', () => {
      service.save('Hotel');
      const hotel = service.presets()[0];
      service.apply(hotel);
      expect(service.activePresetName()).toBe('Hotel');

      service.rename(hotel, 'India');
      expect(service.activePresetName()).toBe('India');
      expect(localStorage.getItem(ACTIVE_STORAGE_KEY)).toBe('India');
    });

    it('rename() of a non-active preset does not change activePresetName', () => {
      service.save('Juliet');
      service.save('Kilo');
      const juliet = service.presets()[0];
      const kilo   = service.presets()[1];
      service.apply(juliet);

      service.rename(kilo, 'Lima');
      expect(service.activePresetName()).toBe('Juliet');
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

// ── parseOrBundle ─────────────────────────────────────────────────────────────
//
// Covers:
//   - single valid envelope → [envelope]
//   - bundle valid → [envelope, ...] (N entries)
//   - bare top-level array rejected
//   - bundle with wrong/missing version rejected
//   - bundle with empty presets array rejected
//   - bundle entry with blank name rejected
//   - bundle entry with missing settings rejected
//   - single with bad version still rejected (via validateImport delegation)
//   - single with blank name still rejected
//   - single with missing settings still rejected
//   - invalid JSON rejected

describe('PresetsService — parseOrBundle()', () => {
  let service: PresetsService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [
        PresetsService,
        AppStateService,
        ThemeService,
        NotificationPrefsService,
        { provide: DOCUMENT, useValue: document },
      ],
    }).compileComponents();
    service = TestBed.inject(PresetsService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('parses a single valid envelope and returns a 1-element array', () => {
    const env = makeEnvelope('Single');
    const result = service.parseOrBundle(JSON.stringify(env));
    expect(Array.isArray(result)).toBe(true);
    expect((result as PresetEnvelope[]).length).toBe(1);
    expect((result as PresetEnvelope[])[0].name).toBe('Single');
  });

  it('parses a bundle and returns an array with all entries', () => {
    const bundle = {
      version: 1,
      presets: [
        { name: 'Alpha', settings: {} },
        { name: 'Beta',  settings: { theme: 'light' } },
      ],
    };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect(Array.isArray(result)).toBe(true);
    const envelopes = result as PresetEnvelope[];
    expect(envelopes.length).toBe(2);
    expect(envelopes[0].name).toBe('Alpha');
    expect(envelopes[1].name).toBe('Beta');
    expect(envelopes[0].version).toBe(1);
    expect(envelopes[1].version).toBe(1);
  });

  it('trims whitespace from bundle entry names', () => {
    const bundle = {
      version: 1,
      presets: [{ name: '  Trimmed  ', settings: {} }],
    };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect((result as PresetEnvelope[])[0].name).toBe('Trimmed');
  });

  it('rejects a bare top-level array', () => {
    const result = service.parseOrBundle(JSON.stringify([{ version: 1, name: 'a', settings: {} }]));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('array');
  });

  it('rejects a bundle with wrong version', () => {
    const bundle = { version: 2, presets: [{ name: 'x', settings: {} }] };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('version');
  });

  it('rejects a bundle with an empty presets array', () => {
    const bundle = { version: 1, presets: [] };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('empty');
  });

  it('rejects a bundle entry with a blank name', () => {
    const bundle = { version: 1, presets: [{ name: '  ', settings: {} }] };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('name');
  });

  it('rejects a bundle entry with missing settings', () => {
    const bundle = { version: 1, presets: [{ name: 'NoSettings' }] };
    const result = service.parseOrBundle(JSON.stringify(bundle));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('settings');
  });

  it('rejects a bundle entry that is not an object', () => {
    const raw = '{"version":1,"presets":["not-an-object"]}';
    const result = service.parseOrBundle(raw);
    expect(typeof result).toBe('string');
  });

  it('rejects a single envelope with wrong version (via validateImport delegation)', () => {
    const bad = { version: 2, name: 'x', settings: {} };
    const result = service.parseOrBundle(JSON.stringify(bad));
    expect(typeof result).toBe('string');
    expect(result as string).toContain('version');
  });

  it('rejects a single envelope with blank name (via validateImport delegation)', () => {
    const bad = { version: 1, name: '', settings: {} };
    const result = service.parseOrBundle(JSON.stringify(bad));
    expect(typeof result).toBe('string');
  });

  it('rejects a single envelope missing settings (via validateImport delegation)', () => {
    const bad = { version: 1, name: 'NoSettings' };
    const result = service.parseOrBundle(JSON.stringify(bad));
    expect(typeof result).toBe('string');
  });

  it('returns a string error for invalid JSON', () => {
    const result = service.parseOrBundle('{not-valid-json}');
    expect(typeof result).toBe('string');
  });

  // ── prototype-pollution regression ────────────────────────────────────────
  //
  // Importing a settings object containing {"__proto__":{"polluted":true}} must
  // NOT set Object.prototype.polluted — parseOrBundle strips the dangerous key
  // before returning any envelope.

  it('does not pollute Object.prototype when settings contain __proto__', () => {
    const malicious = {
      version: 1,
      name: 'evil',
      settings: JSON.parse('{"__proto__":{"polluted":true},"theme":"dark"}'),
    };
    const result = service.parseOrBundle(JSON.stringify(malicious));
    // Must parse successfully (shape is valid)
    expect(Array.isArray(result)).toBe(true);
    // The dangerous key must NOT have been applied to Object.prototype
    expect((({} as Record<string, unknown>)['polluted'])).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    // The safe settings key must still be present
    const settings = (result as PresetEnvelope[])[0].settings;
    expect(settings.theme).toBe('dark');
  });

  it('does not pollute Object.prototype via importFromUrl with __proto__ in settings', async () => {
    // Save originalFetch for cleanup
    const originalFetch = globalThis.fetch;
    const malicious = {
      version: 1,
      name: 'evil-url',
      settings: JSON.parse('{"__proto__":{"urlPolluted":true},"theme":"light"}'),
    };
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(malicious)),
      } as Response);
    try {
      const result = await service.importFromUrl('https://example.com/evil.json');
      expect(typeof result).not.toBe('string');
      expect((({} as Record<string, unknown>)['urlPolluted'])).toBeUndefined();
      expect((Object.prototype as Record<string, unknown>)['urlPolluted']).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ── importPresets ─────────────────────────────────────────────────────────────
//
// Covers:
//   - appends all envelopes in one call
//   - cross-bundle name deduplication (counter spans existing + batch)
//   - names returned in order
//   - persists to localStorage

describe('PresetsService — importPresets()', () => {
  let service: PresetsService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      providers: [
        PresetsService,
        AppStateService,
        ThemeService,
        NotificationPrefsService,
        { provide: DOCUMENT, useValue: document },
      ],
    }).compileComponents();
    service = TestBed.inject(PresetsService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('appends all envelopes and returns assigned names', () => {
    const names = service.importPresets([makeEnvelope('A'), makeEnvelope('B')]);
    expect(names).toEqual(['A', 'B']);
    expect(service.presets()).toHaveLength(2);
  });

  it('deduplicates names across existing presets', () => {
    service.save('A');
    const names = service.importPresets([makeEnvelope('A')]);
    expect(names).toEqual(['A (2)']);
    expect(service.presets()).toHaveLength(2);
    expect(service.presets()[1].name).toBe('A (2)');
  });

  it('deduplicates names within the same batch (cross-bundle dedup)', () => {
    const names = service.importPresets([makeEnvelope('X'), makeEnvelope('X')]);
    expect(names).toEqual(['X', 'X (2)']);
    expect(service.presets()).toHaveLength(2);
  });

  it('increments suffix counter past existing suffixed names', () => {
    service.save('Z');
    service.importPresets([makeEnvelope('Z')]); // creates 'Z (2)'
    const names = service.importPresets([makeEnvelope('Z')]);
    expect(names).toEqual(['Z (3)']);
  });

  it('persists all envelopes to localStorage', () => {
    service.importPresets([makeEnvelope('P1'), makeEnvelope('P2')]);
    const raw = localStorage.getItem('dd:presets');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.map((p: PresetEnvelope) => p.name)).toEqual(['P1', 'P2']);
  });
});

// ── importFromUrl ──────────────────────────────────────────────────────────────
//
// Covers:
//   - non-https URL rejected immediately (no fetch called)
//   - network/CORS failure (fetch throws) → string error
//   - non-OK HTTP response (404) → string error
//   - non-JSON body → string error
//   - invalid shape (valid JSON but wrong structure) → string error
//   - valid single preset → imported, names returned
//   - valid bundle (2 entries) → both imported, names returned
//   - fetch is injectable via globalThis.fetch override pattern

describe('PresetsService — importFromUrl()', () => {
  let service: PresetsService;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    localStorage.clear();
    originalFetch = globalThis.fetch;

    await TestBed.configureTestingModule({
      providers: [
        PresetsService,
        AppStateService,
        ThemeService,
        NotificationPrefsService,
        { provide: DOCUMENT, useValue: document },
      ],
    }).compileComponents();
    service = TestBed.inject(PresetsService);
  });

  afterEach(() => {
    localStorage.clear();
    globalThis.fetch = originalFetch;
    TestBed.resetTestingModule();
  });

  /** Helper: stub globalThis.fetch with a mock. */
  function stubFetch(mockFn: typeof globalThis.fetch): void {
    globalThis.fetch = mockFn;
  }

  it('rejects a non-https URL without calling fetch', async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy as unknown as typeof globalThis.fetch);

    const result = await service.importFromUrl('http://example.com/preset.json');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('HTTPS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a bare non-URL without calling fetch', async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy as unknown as typeof globalThis.fetch);

    const result = await service.importFromUrl('not-a-url');
    expect(typeof result).toBe('string');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL with the invalid-URL error message', async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy as unknown as typeof globalThis.fetch);

    const result = await service.importFromUrl('  https://  ');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('could not parse the address');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-https URL (e.g. ftp:) via URL parse with the https-only error', async () => {
    const fetchSpy = vi.fn();
    stubFetch(fetchSpy as unknown as typeof globalThis.fetch);

    const result = await service.importFromUrl('ftp://example.com/preset.json');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('HTTPS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a string error when fetch throws (network / CORS failure)', async () => {
    stubFetch(() => Promise.reject(new TypeError('Network error')));
    const result = await service.importFromUrl('https://example.com/preset.json');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('reach');
  });

  it('returns a string error for non-OK HTTP response (404)', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok:   false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/preset.json');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('404');
  });

  it('returns a string error for non-JSON body', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok:   true,
        status: 200,
        text: () => Promise.resolve('<html>not json</html>'),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/preset.json');
    expect(typeof result).toBe('string');
    // parseOrBundle returns the real error string for unparseable content
    expect(result as string).toContain('parse');
  });

  it('returns a string error for valid JSON with invalid shape', async () => {
    stubFetch(() =>
      Promise.resolve({
        ok:   true,
        status: 200,
        text: () => Promise.resolve('{"version":1,"name":"","settings":{}}'),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/preset.json');
    expect(typeof result).toBe('string');
  });

  it('imports a valid single preset and returns its name', async () => {
    const env = makeEnvelope('Remote Preset');
    stubFetch(() =>
      Promise.resolve({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(env)),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/preset.json');
    expect(typeof result).not.toBe('string');
    const r = result as { imported: string[] };
    expect(r.imported).toEqual(['Remote Preset']);
    expect(service.presets()).toHaveLength(1);
    expect(service.presets()[0].name).toBe('Remote Preset');
  });

  it('imports a valid bundle and returns all names', async () => {
    const bundle = {
      version: 1,
      presets: [
        { name: 'Prod',     settings: {} },
        { name: 'Staging',  settings: {} },
      ],
    };
    stubFetch(() =>
      Promise.resolve({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(bundle)),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/bundle.json');
    expect(typeof result).not.toBe('string');
    const r = result as { imported: string[] };
    expect(r.imported).toEqual(['Prod', 'Staging']);
    expect(service.presets()).toHaveLength(2);
  });

  it('applies name deduplication when importing from URL collides with existing', async () => {
    service.save('Existing');
    const bundle = {
      version: 1,
      presets: [{ name: 'Existing', settings: {} }],
    };
    stubFetch(() =>
      Promise.resolve({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(bundle)),
      } as Response),
    );
    const result = await service.importFromUrl('https://example.com/bundle.json');
    expect(typeof result).not.toBe('string');
    const r = result as { imported: string[] };
    expect(r.imported).toEqual(['Existing (2)']);
  });
});
