import { inject, Injectable, signal } from '@angular/core';

import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  MATRIX_FIELDS,
  MatrixField,
  SWIMLANE_FIELDS,
  SwimlaneField,
  Theme,
  TIME_WINDOWS,
  TimeWindow,
} from '../models/deployment.model';
import {
  AppStateService,
  ServiceFilterMode,
} from './app-state.service';
import {
  NOTIFICATION_STATUSES,
  NotifPrefs,
  NotificationPrefsService,
} from './notification-prefs.service';
import { ThemeService } from './theme.service';

/**
 * The settings payload stored in a preset.
 * All fields are optional — import falls back to current app defaults
 * for any missing or unknown field.
 */
export interface PresetSettings {
  theme?: Theme;
  notifEnabled?: boolean;
  notifStatuses?: string[];
  notifServiceMode?: string;
  notifServiceChips?: string[];
  notifEnvMode?: string;
  notifEnvChips?: string[];
  view?: string;
  svcFilter?: string;
  svcFilterMode?: string;
  svcPatterns?: string[];
  failOnly?: boolean;
  matFields?: string[];
  swFields?: string[];
  colOrder?: string[];
  colHidden?: string[];
  swimCollapsed?: string[];
  swimAutoScroll?: boolean;
  timeWindow?: string;
  correlation?: string;
}

/**
 * The versioned envelope stored under dd:presets.
 * Each preset = one envelope.
 */
export interface PresetEnvelope {
  version: 1;
  name: string;
  settings: PresetSettings;
}

/**
 * Parsed result from parseOrBundle(): either an array of envelopes (success)
 * or a string error message (failure).
 */
export type ParseOrBundleResult = PresetEnvelope[] | string;

/** Stored collection: array of envelopes. */
type PresetsStore = PresetEnvelope[];

const STORAGE_KEY        = 'dd:presets';
const ACTIVE_STORAGE_KEY = 'dd:presetActive';
const ENVELOPE_VERSION   = 1 as const;

/**
 * PresetsService — save, apply, clone, rename, delete, export, and import
 * named UI settings presets.
 *
 * Design contract: docs/design/mockup/index.html (feat/357-presets-mockup).
 * Session decisions:
 *   #2 — frontend-only; localStorage only, no backend.
 *   #3 — mockup is the artifact.
 *   #4 — export/import are per-preset (one JSON file = one envelope).
 *
 * Capture reads current signal values from AppStateService / ThemeService /
 * NotificationPrefsService.  Apply writes to those same signals — the
 * existing persistence effects in AppStateService handle re-saving to
 * localStorage automatically.  No parallel store.
 *
 * Spec: docs/design/mockup/index.html §presets
 */
@Injectable({ providedIn: 'root' })
export class PresetsService {
  private readonly state      = inject(AppStateService);
  private readonly themeService = inject(ThemeService);
  private readonly notifPrefs = inject(NotificationPrefsService);

  /** Reactive list of saved presets; refreshed on every mutating operation. */
  readonly presets = signal<PresetEnvelope[]>(this.loadFromStorage());

  /**
   * The name of the last-applied preset, persisted to localStorage under
   * dd:presetActive.  null when no preset has been applied, or after the
   * active preset is deleted or all settings are reset.
   * Active = LAST APPLIED — not auto-cleared when the user changes settings.
   */
  readonly activePresetName = signal<string | null>(this.loadActiveFromStorage());

  // ── Capture ─────────────────────────────────────────────────────────────

  /**
   * Snapshot the current UI settings into a PresetSettings payload.
   * Called by save() and when building an export from the current state.
   */
  captureSettings(): PresetSettings {
    const notif = this.notifPrefs.prefs();
    return {
      theme:             this.themeService.theme(),
      notifEnabled:      notif.enabled,
      notifStatuses:     [...notif.statuses],
      notifServiceMode:  notif.serviceMode,
      notifServiceChips: [...notif.serviceChips],
      notifEnvMode:      notif.envMode,
      notifEnvChips:     [...notif.envChips],
      view:              this.state.activeView(),
      svcFilter:         this.state.serviceFilter(),
      svcFilterMode:     this.state.serviceFilterMode(),
      svcPatterns:       [...this.state.servicePatterns()],
      failOnly:          this.state.failuresOnly(),
      matFields:         [...this.state.matrixVisibleFields()],
      swFields:          [...this.state.swimlaneVisibleFields()],
      colOrder:          [...this.state.matrixColOrder()],
      colHidden:         [...this.state.matrixColHidden()],
      swimCollapsed:     [...this.state.collapsedLanes()],
      swimAutoScroll:    this.state.autoScrollOnChange(),
      timeWindow:        this.state.timeWindow(),
      correlation:       this.state.correlationPredicate(),
    };
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  /**
   * Save the current UI state as a new named preset.
   * Rejects blank names.
   */
  save(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const envelope: PresetEnvelope = {
      version: ENVELOPE_VERSION,
      name: trimmed,
      settings: this.captureSettings(),
    };
    const updated = [...this.presets(), envelope];
    this.persist(updated);
  }

  // ── Apply ────────────────────────────────────────────────────────────────

  /**
   * Apply a saved preset by writing its settings to the live signals.
   * Fields not present in the preset (undefined) are left at their current
   * value — unknown/missing fields fall back to the current app default.
   */
  apply(envelope: PresetEnvelope): void {
    const s = envelope.settings;

    if (s.theme !== undefined && this.isTheme(s.theme)) {
      this.themeService.setTheme(s.theme);
    }

    if (s.notifEnabled !== undefined) {
      this.notifPrefs.updatePrefs({ enabled: s.notifEnabled });
    }

    const notifPatch: Partial<NotifPrefs> = {};
    if (s.notifStatuses !== undefined) {
      notifPatch.statuses = (s.notifStatuses as string[]).filter(
        (st): st is NotifPrefs['statuses'][number] =>
          (NOTIFICATION_STATUSES as string[]).includes(st),
      );
    }
    if (s.notifServiceMode !== undefined) {
      notifPatch.serviceMode =
        s.notifServiceMode === 'watch-only' ? 'watch-only' : 'watch-all-except';
    }
    if (s.notifServiceChips !== undefined) {
      notifPatch.serviceChips = this.parseStringArray(s.notifServiceChips);
    }
    if (s.notifEnvMode !== undefined) {
      notifPatch.envMode =
        s.notifEnvMode === 'watch-only' ? 'watch-only' : 'watch-all-except';
    }
    if (s.notifEnvChips !== undefined) {
      notifPatch.envChips = this.parseStringArray(s.notifEnvChips);
    }
    if (Object.keys(notifPatch).length > 0) {
      this.notifPrefs.updatePrefs(notifPatch);
    }

    if (s.view !== undefined && this.isView(s.view)) {
      this.state.activeView.set(s.view);
    }
    if (s.svcFilter !== undefined) {
      this.state.serviceFilter.set(s.svcFilter);
    }
    if (s.svcFilterMode !== undefined) {
      const mode: ServiceFilterMode =
        s.svcFilterMode === 'include' ? 'include' : 'exclude';
      this.state.serviceFilterMode.set(mode);
    }
    if (s.svcPatterns !== undefined) {
      this.state.servicePatterns.set(this.parseStringArray(s.svcPatterns));
    }
    if (s.failOnly !== undefined) {
      this.state.failuresOnly.set(Boolean(s.failOnly));
    }
    if (s.matFields !== undefined) {
      const fields = this.parseStringArray(s.matFields).filter(
        (f): f is MatrixField => (MATRIX_FIELDS as readonly string[]).includes(f),
      );
      this.state.matrixVisibleFields.set(new Set<MatrixField>(fields.length ? fields : MATRIX_FIELDS));
    }
    if (s.swFields !== undefined) {
      const fields = this.parseStringArray(s.swFields).filter(
        (f): f is SwimlaneField => (SWIMLANE_FIELDS as readonly string[]).includes(f),
      );
      this.state.swimlaneVisibleFields.set(new Set<SwimlaneField>(fields.length ? fields : SWIMLANE_FIELDS));
    }
    if (s.colOrder !== undefined) {
      this.state.matrixColOrder.set(this.parseStringArray(s.colOrder));
    }
    if (s.colHidden !== undefined) {
      this.state.matrixColHidden.set(new Set(this.parseStringArray(s.colHidden)));
    }
    if (s.swimCollapsed !== undefined) {
      this.state.collapsedLanes.set(new Set(this.parseStringArray(s.swimCollapsed)));
    }
    if (s.swimAutoScroll !== undefined) {
      this.state.autoScrollOnChange.set(Boolean(s.swimAutoScroll));
    }
    if (s.timeWindow !== undefined && this.isTimeWindow(s.timeWindow)) {
      this.state.timeWindow.set(s.timeWindow);
    }
    if (s.correlation !== undefined && this.isCorrelation(s.correlation)) {
      this.state.correlationPredicate.set(s.correlation);
    }

    this.persistActive(envelope.name);
  }

  // ── Clone ────────────────────────────────────────────────────────────────

  /**
   * Clone an existing preset under a new name.
   * The source preset's settings are copied exactly; the new name must not be blank.
   */
  clone(source: PresetEnvelope, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const cloned: PresetEnvelope = {
      version: ENVELOPE_VERSION,
      name: trimmed,
      settings: { ...source.settings },
    };
    const updated = [...this.presets(), cloned];
    this.persist(updated);
  }

  // ── Rename ───────────────────────────────────────────────────────────────

  /**
   * Rename a preset in-place by reference equality.
   * Rejects blank names.
   *
   * Invariant: callers MUST clear their renaming UI state BEFORE calling this
   * method (or wrap in try/finally) so that a swallowed localStorage quota
   * error cannot leave an inline input pointing at a ghost object.
   */
  rename(target: PresetEnvelope, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (this.activePresetName() === target.name) {
      this.persistActive(trimmed);
    }
    const updated = this.presets().map((p) =>
      p === target ? { ...p, name: trimmed } : p,
    );
    this.persist(updated);
  }

  // ── Reset all settings ───────────────────────────────────────────────────

  /**
   * Reset every captured UI setting to its framework default.
   * Callers are responsible for showing a native confirm dialog before
   * calling this method.
   *
   * Defaults mirror the AppStateService / ThemeService / NotificationPrefsService
   * signal initialisers:
   *   theme: 'dark' · notif: disabled, success+failure statuses, no filters ·
   *   view: 'matrix' · svcFilterMode: 'exclude' · svcPatterns: [] ·
   *   failOnly: false · matFields: all · swFields: all ·
   *   colOrder: [] · colHidden: {} · swimCollapsed: {} · swimAutoScroll: true ·
   *   timeWindow: '1 day' · correlation: 'explicit parent'
   */
  resetAllSettings(): void {
    this.themeService.setTheme('dark');

    this.notifPrefs.updatePrefs({
      enabled:      false,
      statuses:     ['success', 'failure'],
      serviceMode:  'watch-all-except',
      serviceChips: [],
      envMode:      'watch-all-except',
      envChips:     [],
    });

    this.state.activeView.set('matrix');
    this.state.serviceFilter.set('');
    this.state.serviceFilterMode.set('exclude');
    this.state.servicePatterns.set([]);
    this.state.failuresOnly.set(false);
    this.state.matrixVisibleFields.set(new Set(MATRIX_FIELDS));
    this.state.swimlaneVisibleFields.set(new Set(SWIMLANE_FIELDS));
    this.state.matrixColOrder.set([]);
    this.state.matrixColHidden.set(new Set());
    this.state.collapsedLanes.set(new Set());
    this.state.autoScrollOnChange.set(true);
    this.state.timeWindow.set('1 day' as TimeWindow);
    this.state.correlationPredicate.set('explicit parent' as CorrelationPredicate);
    this.persistActive(null);
  }

  // ── Update ───────────────────────────────────────────────────────────────

  /**
   * Overwrite an existing preset's settings with the current live UI state.
   * Preserves the preset's name and version (version stays 1).
   * Callers are responsible for showing the native confirm dialog before
   * calling this method.
   */
  update(target: PresetEnvelope): void {
    const updated = this.presets().map((p) =>
      p === target ? { ...p, settings: this.captureSettings() } : p,
    );
    this.persist(updated);
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  /**
   * Delete a preset by reference equality.
   * Callers are responsible for showing the native confirm dialog
   * (per session decision #4) before calling this method.
   */
  delete(target: PresetEnvelope): void {
    if (this.activePresetName() === target.name) {
      this.persistActive(null);
    }
    const updated = this.presets().filter((p) => p !== target);
    this.persist(updated);
  }

  // ── Export ───────────────────────────────────────────────────────────────

  /**
   * Export a single preset (or the current state as an unnamed preset) as a
   * downloadable JSON file.  File name: dd-preset-<slug>.json.
   * The file contains a single PresetEnvelope — NOT an array.
   *
   * @param envelope  The preset to export.  Pass the result of
   *   { version:1, name, settings: captureSettings() } to export the live state.
   */
  exportPreset(envelope: PresetEnvelope): void {
    const slug     = this.toSlug(envelope.name);
    const fileName = `dd-preset-${slug}.json`;
    const json     = JSON.stringify(envelope, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href  = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ── Import ───────────────────────────────────────────────────────────────

  /**
   * Parse and validate a JSON string as a single PresetEnvelope.
   * Returns the envelope on success, or a string error message on failure.
   * Per session decision #4 — import reads a SINGLE envelope (not an array).
   */
  validateImport(raw: string): PresetEnvelope | string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'Invalid JSON — could not parse the file.';
    }

    if (Array.isArray(parsed)) {
      return 'Invalid format — expected a single preset envelope, not an array.';
    }

    if (!parsed || typeof parsed !== 'object') {
      return 'Invalid format — expected a JSON object.';
    }

    const obj = parsed as Record<string, unknown>;

    if (obj['version'] !== 1) {
      return `Unsupported version: ${String(obj['version'])}. Only version 1 is supported.`;
    }

    if (typeof obj['name'] !== 'string' || !(obj['name'] as string).trim()) {
      return 'Invalid preset — missing or blank "name" field.';
    }

    if (!obj['settings'] || typeof obj['settings'] !== 'object' || Array.isArray(obj['settings'])) {
      return 'Invalid preset — missing or invalid "settings" field.';
    }

    return {
      version:  1,
      name:     (obj['name'] as string).trim(),
      settings: obj['settings'] as PresetSettings,
    };
  }

  /**
   * Import a validated preset, appending it to the stored list.
   * If a preset with the same name already exists, suffixes the name with
   * ' (2)', ' (3)', … until unique — matching the mockup's importPresets()
   * dedup loop (docs/design/mockup/index.html).
   */
  importPreset(envelope: PresetEnvelope): void {
    const existing = this.presets();
    const existingNames = new Set(existing.map((p) => p.name));
    let name = envelope.name;
    if (existingNames.has(name)) {
      let counter = 2;
      while (existingNames.has(`${name} (${counter})`)) {
        counter++;
      }
      name = `${name} (${counter})`;
    }
    const updated = [...existing, { ...envelope, name }];
    this.persist(updated);
  }

  /**
   * Parse a raw JSON string as either a single preset (SINGLE) or a bundle
   * (BUNDLE) and return an array of PresetEnvelopes.
   *
   * Accepted shapes:
   *   SINGLE  {version:1, name:string, settings:{}} → [envelope]
   *   BUNDLE  {version:1, presets:[{name,settings}, ...]} → [envelope, ...]
   *
   * Bare top-level arrays are rejected (backward-compat guard).
   * Each bundle entry inherits version:1.
   * Delegates single-envelope validation to validateImport so there is one
   * validation sink (no new sinks, prototype-pollution-safe per #357).
   *
   * Returns ParseOrBundleResult: PresetEnvelope[] on success, string on error.
   */
  parseOrBundle(raw: string): ParseOrBundleResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return 'Invalid JSON — could not parse the content.';
    }

    if (Array.isArray(parsed)) {
      return 'Invalid format — bare top-level arrays are not supported. Use a single preset envelope or a bundle object.';
    }

    if (!parsed || typeof parsed !== 'object') {
      return 'Invalid format — expected a JSON object.';
    }

    const obj = parsed as Record<string, unknown>;

    // BUNDLE: {version:1, presets:[...]}
    if (Array.isArray(obj['presets'])) {
      if (obj['version'] !== 1) {
        return `Unsupported version: ${String(obj['version'])}. Only version 1 is supported.`;
      }
      const entries = obj['presets'] as unknown[];
      if (entries.length === 0) {
        return 'Invalid bundle — "presets" array is empty.';
      }
      const envelopes: PresetEnvelope[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return `Invalid bundle — presets[${i}] is not an object.`;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e['name'] !== 'string' || !(e['name'] as string).trim()) {
          return `Invalid bundle — presets[${i}] has a missing or blank "name" field.`;
        }
        if (!e['settings'] || typeof e['settings'] !== 'object' || Array.isArray(e['settings'])) {
          return `Invalid bundle — presets[${i}] has a missing or invalid "settings" field.`;
        }
        envelopes.push({
          version:  1,
          name:     (e['name'] as string).trim(),
          settings: e['settings'] as PresetSettings,
        });
      }
      return envelopes;
    }

    // SINGLE — delegate to validateImport (single validation sink).
    const result = this.validateImport(raw);
    if (typeof result === 'string') {
      return result;
    }
    return [result];
  }

  /**
   * Import an array of validated PresetEnvelopes (from parseOrBundle), appending
   * each to the stored list with cross-bundle name deduplication: the dedup
   * counter spans the entire existing store plus all previously appended entries
   * in this batch, matching the mockup's importPresets() loop.
   *
   * Returns the array of final names assigned (after dedup).
   */
  importPresets(envelopes: PresetEnvelope[]): string[] {
    const existing = this.presets();
    const takenNames = new Set(existing.map((p) => p.name));
    const added: PresetEnvelope[] = [];
    const names: string[] = [];

    for (const envelope of envelopes) {
      let name = envelope.name;
      if (takenNames.has(name)) {
        let counter = 2;
        while (takenNames.has(`${name} (${counter})`)) {
          counter++;
        }
        name = `${name} (${counter})`;
      }
      takenNames.add(name);
      added.push({ ...envelope, name });
      names.push(name);
    }

    this.persist([...existing, ...added]);
    return names;
  }

  /**
   * Fetch a preset file from a URL and import all presets it contains.
   *
   * HTTPS-only — non-https URLs are rejected with a clear message about
   * browser mixed-content restrictions.
   *
   * Note: private-repo raw URLs (e.g. raw.githubusercontent.com on a private
   * repo) will fail with a CORS or 404 error by design — the SPA holds no
   * secrets and cannot inject auth headers.
   *
   * Returns {imported: string[]} with the final preset names on success,
   * or a string error message on failure.
   *
   * Error taxonomy (each returns a distinct user-readable string):
   *   - Non-https URL
   *   - Network / CORS failure (fetch() throws)
   *   - Non-OK HTTP response (e.g. 404)
   *   - Non-JSON body (response.json() throws)
   *   - Invalid shape (delegates to parseOrBundle)
   */
  async importFromUrl(url: string): Promise<{ imported: string[] } | string> {
    const trimmed = url.trim();
    if (!trimmed.startsWith('https://')) {
      return 'Only HTTPS URLs are supported — HTTP and other schemes are blocked by browser mixed-content policy.';
    }

    let response: Response;
    try {
      response = await fetch(trimmed);
    } catch {
      // Network failure, CORS rejection, or DNS failure — no status available.
      return 'Could not reach that URL — check the address or CORS policy (private-repo raw URLs require auth the browser cannot provide).';
    }

    if (!response.ok) {
      return `HTTP ${response.status} — the server returned an error for that URL.`;
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return 'Could not read the response body.';
    }

    const parseResult = this.parseOrBundle(text);
    if (typeof parseResult === 'string') {
      return parseResult;
    }

    const names = this.importPresets(parseResult);
    return { imported: names };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Convert a preset name to a URL/filename-safe slug.
   * Lowercases, replaces spaces and special chars with hyphens, collapses runs.
   */
  toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'preset';
  }

  /** Persist the active preset name to localStorage and refresh the signal. */
  private persistActive(name: string | null): void {
    try {
      if (name === null) {
        localStorage.removeItem(ACTIVE_STORAGE_KEY);
      } else {
        localStorage.setItem(ACTIVE_STORAGE_KEY, name);
      }
    } catch {
      // quota exceeded or private mode — silently ignore
    }
    this.activePresetName.set(name);
  }

  /** Load the last-applied preset name from localStorage. */
  private loadActiveFromStorage(): string | null {
    try {
      return localStorage.getItem(ACTIVE_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  /** Persist updated store to localStorage and refresh the signal. */
  private persist(store: PresetsStore): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // quota exceeded or private mode — silently ignore
    }
    this.presets.set(store);
  }

  /** Load and validate the stored presets array from localStorage. */
  private loadFromStorage(): PresetsStore {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is PresetEnvelope =>
          item !== null &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>)['version'] === 1 &&
          typeof (item as Record<string, unknown>)['name'] === 'string' &&
          typeof (item as Record<string, unknown>)['settings'] === 'object',
      );
    } catch {
      return [];
    }
  }

  private parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return (value as unknown[]).filter((x): x is string => typeof x === 'string');
  }

  private isTheme(v: string): v is Theme {
    return v === 'dark' || v === 'light' || v === 'auto';
  }

  private isView(v: string): v is 'matrix' | 'swimlanes' | 'analytics' {
    return v === 'matrix' || v === 'swimlanes' || v === 'analytics';
  }

  private isTimeWindow(v: string): v is TimeWindow {
    return (TIME_WINDOWS as readonly string[]).includes(v);
  }

  private isCorrelation(v: string): v is CorrelationPredicate {
    return (CORRELATION_PREDICATES as readonly string[]).includes(v);
  }
}
