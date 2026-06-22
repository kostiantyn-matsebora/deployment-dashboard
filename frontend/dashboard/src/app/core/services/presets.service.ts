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

/** Stored collection: array of envelopes. */
type PresetsStore = PresetEnvelope[];

const STORAGE_KEY = 'dd:presets';
const ENVELOPE_VERSION = 1 as const;

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
   */
  rename(target: PresetEnvelope, newName: string): void {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const updated = this.presets().map((p) =>
      p === target ? { ...p, name: trimmed } : p,
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
   */
  importPreset(envelope: PresetEnvelope): void {
    const updated = [...this.presets(), envelope];
    this.persist(updated);
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
