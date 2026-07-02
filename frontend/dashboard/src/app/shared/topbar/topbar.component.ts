import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SelectButton } from 'primeng/selectbutton';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';

import { AppStateService, ServiceFilterMode } from '../../core/services/app-state.service';
import { ThemeService } from '../../core/services/theme.service';
import {
  NotificationPrefsService,
  NOTIFICATION_STATUSES,
  NotifFilterMode,
} from '../../core/services/notification-prefs.service';
import { BrowserNotificationService } from '../../core/services/browser-notification.service';
import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  MATRIX_FIELDS,
  MatrixField,
  ProvidedPreset,
  RateLimitReport,
  SWIMLANE_FIELDS,
  Status,
  SwimlaneField,
  Theme,
} from '../../core/models/deployment.model';
import { PatternFilterComponent } from '../pattern-filter/pattern-filter.component';
import { matchesAny } from '../../core/utils/glob.util';
import { PresetsService, PresetEnvelope } from '../../core/services/presets.service';

interface ViewOption {
  label: string;
  value: string;
}

interface ThemeOption {
  label: string;
  value: Theme;
  title: string;
}

/**
 * TopbarComponent — persistent header bar.
 *
 * DOM order matches mockup exactly:
 *   brand → tabs → spacer → KPIs → hdr-filter(Matrix) →
 *   theme-switch → hdr-icons(fields+correlation) → live-pill
 *
 * Phase 3: fields picker + correlation picker wired with real state.
 *
 * Spec: docs/design/components.md §Topbar
 * position: relative; z-index: 30 — so popovers (z-index:20 inside this
 * stacking context) render above sibling matrix/vis shells that use
 * backdrop-filter.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    FormsModule,
    SelectButton,
    InputText,
    Popover,
    PatternFilterComponent,
  ],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  protected readonly state           = inject(AppStateService);
  protected readonly themeService    = inject(ThemeService);
  protected readonly notifPrefs      = inject(NotificationPrefsService);
  protected readonly notifService    = inject(BrowserNotificationService);
  protected readonly router          = inject(Router);
  protected readonly presetsService  = inject(PresetsService);

  // Popovers
  protected readonly fieldsPopover        = viewChild<Popover>('fieldsPopover');
  protected readonly columnsPopover       = viewChild<Popover>('columnsPopover');
  protected readonly correlationPopover   = viewChild<Popover>('correlationPopover');
  protected readonly legendPopover        = viewChild<Popover>('legendPopover');
  protected readonly notifPopover         = viewChild<Popover>('notifPopover');
  protected readonly servicesPopover      = viewChild<Popover>('servicesPopover');
  protected readonly presetsPopover       = viewChild<Popover>('presetsPopover');
  protected readonly rateLimitPopovers    = viewChildren<Popover>('rateLimitPopover');

  // Popover open state (for icon-btn.is-active highlight)
  protected readonly fieldsPopoverOpen      = signal(false);
  protected readonly columnsPopoverOpen     = signal(false);
  protected readonly correlationPopoverOpen = signal(false);
  protected readonly legendPopoverOpen      = signal(false);
  protected readonly notifPopoverOpen       = signal(false);
  protected readonly servicesPopoverOpen    = signal(false);
  protected readonly presetsPopoverOpen     = signal(false);
  protected readonly rateLimitPopoverOpen   = signal<Map<string, boolean>>(new Map());

  // ── Presets UI state ─────────────────────────────────────────────────────
  /** Name field for saving a new preset. */
  protected presetSaveName = '';
  /** Whether the save-new-preset input row is visible. */
  protected readonly presetSaveOpen = signal(false);
  /** Which preset is currently being renamed (null = none). */
  protected readonly renamingPreset = signal<PresetEnvelope | null>(null);
  /** Rename input value. */
  protected presetRenameValue = '';
  /** Error / info message shown in the popover (clears on next action). */
  protected readonly presetsMsg = signal<string | null>(null);

  // ── View tabs ─────────────────────────────────────────────
  protected readonly viewOptions: ViewOption[] = [
    { label: 'Matrix',     value: 'matrix' },
    { label: 'Swimlanes',  value: 'swimlanes' },
    { label: 'Analytics',  value: 'analytics' },
  ];

  protected readonly activeView = computed(() => this.state.activeView());

  protected onViewChange(value: string): void {
    if (value === 'matrix' || value === 'swimlanes' || value === 'analytics') {
      this.state.activeView.set(value);
      this.router.navigate(['/' + value]);
    }
  }

  // ── Theme options (☾ dark / ☼ light / Auto) ───────────────
  protected readonly themeOptions: ThemeOption[] = [
    { label: '☾', value: 'dark',  title: 'Dark'  },
    { label: '☼', value: 'light', title: 'Light' },
    { label: 'Auto', value: 'auto', title: 'Auto (follow system)' },
  ];

  protected readonly activeTheme = computed(() => this.themeService.theme());

  protected onThemeChange(value: Theme): void {
    this.themeService.setTheme(value);
  }

  // ── Filter ────────────────────────────────────────────────
  protected readonly serviceFilter = computed(() => this.state.serviceFilter());

  protected onFilterChange(value: string): void {
    this.state.serviceFilter.set(value);
  }

  // ── Failures toggle ───────────────────────────────────────
  protected readonly failuresOnly = computed(() => this.state.failuresOnly());

  protected onFailuresOnlyChange(value: boolean): void {
    this.state.failuresOnly.set(value);
  }

  // ── Services picker (glob include/exclude filter) ─────────
  /** Current glob filter mode for the services picker. */
  protected readonly serviceFilterMode = computed(() => this.state.serviceFilterMode());
  /** Current glob patterns for the services picker. */
  protected readonly servicePatterns   = computed(() => this.state.servicePatterns());

  /**
   * Autocomplete suggestions for the services pattern filter (issue #353).
   * Includes: bare service names, distinct namespaces, and `namespace/service` composites.
   * Bare names come first for backward compatibility; namespaced composites follow.
   */
  protected readonly allServiceNames = computed(() => {
    const rows = this.state.matrixData()?.rows ?? [];
    return this.state.buildServiceSuggestions(rows);
  });

  /**
   * Distinct matrix-row identities (namespace + service pairs).
   * Used as the denominator for badge/caption counts so that autocomplete
   * suggestions (bare names + namespaces + composites in allServiceNames) do
   * not inflate the total.
   */
  private readonly rowIdentities = computed(() =>
    this.state.matrixData()?.rows.map((r) => ({
      service:   r.service,
      namespace: r.namespace ?? null,
    })) ?? [],
  );

  /** Badge count: number of distinct matrix rows hidden by the current filter. */
  protected readonly svcHiddenCount = computed(() => {
    const all = this.rowIdentities();
    if (!all.length) return 0;
    const vis = this.state.visibleServiceIdentities(all);
    return all.length - vis.length;
  });

  /** Title / aria label for the Services button, reflecting hidden count. */
  protected readonly servicesBtnTitle = computed(() => {
    const n = this.svcHiddenCount();
    return n > 0
      ? `Services — ${n} service${n === 1 ? '' : 's'} hidden`
      : 'Services — filter services';
  });

  /** Caption line shown inside the services picker popover. */
  protected readonly servicesCaption = computed(() => {
    const all      = this.rowIdentities();
    const patterns = this.servicePatterns();
    if (!patterns.length) return `Showing all ${all.length} service${all.length === 1 ? '' : 's'}`;
    const vis    = this.state.visibleServiceIdentities(all);
    const hidden = all.length - vis.length;
    if (this.serviceFilterMode() === 'exclude') {
      return hidden === 0
        ? `Showing all ${all.length} services`
        : `Hiding ${hidden} of ${all.length} · showing ${vis.length}`;
    } else {
      return vis.length === all.length
        ? `Showing all ${all.length} services`
        : `Showing ${vis.length} of ${all.length} services`;
    }
  });

  protected onServiceFilterModeChange(mode: ServiceFilterMode): void {
    this.state.serviceFilterMode.set(mode);
  }

  protected onServicePatternsChange(patterns: string[]): void {
    this.state.servicePatterns.set(patterns);
  }

  protected resetServicesFilter(): void {
    this.state.servicePatterns.set([]);
    this.state.serviceFilterMode.set('exclude');
  }

  protected toggleServicesPopover(event: MouseEvent): void {
    const p = this.servicesPopover();
    if (p) {
      p.toggle(event);
      this.servicesPopoverOpen.update((v) => !v);
    }
  }

  // ── KPIs ──────────────────────────────────────────────────
  protected readonly kpi = computed(() => this.state.kpi());

  // ── Live indicator ────────────────────────────────────────
  protected readonly sseConnected = computed(() => this.state.sseConnected());

  // ── Rate-limit telemetry — per-adapter ───────────────────
  /**
   * Sorted array of [adapter, report] pairs from the per-adapter map.
   * Empty array until the first report arrives (chip is hidden).
   */
  protected readonly rateLimitEntries = computed<[string, RateLimitReport][]>(() => {
    const map = this.state.rateLimitMap();
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  /** Inline chip label for a given report: own_used/own_budget, or –/– for nulls. */
  protected chipLabel(r: RateLimitReport): string {
    const used   = r.own_used   ?? null;
    const budget = r.own_budget ?? null;
    if (used === null || budget === null) return '–/–';
    return `${used}/${budget}`;
  }

  /** Percentage of own budget used; null when budget is 0 or fields are null. */
  protected ownBudgetPct(r: RateLimitReport): number | null {
    if (r.own_budget == null || r.own_budget <= 0 || r.own_used == null) return null;
    return Math.min(100, Math.round((r.own_used / r.own_budget) * 100));
  }

  /** Whether the popover for the given adapter is open. */
  protected isRateLimitPopoverOpen(adapter: string): boolean {
    return this.rateLimitPopoverOpen().get(adapter) ?? false;
  }

  /** Format reset_at as a human-readable local time string, or em-dash if null. */
  protected formatResetAt(resetAt: string | null): string {
    if (!resetAt) return '—';
    try {
      return new Date(resetAt).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  /** Format a nullable number for display — returns em-dash for null. */
  protected fmtNum(v: number | null | undefined): string {
    return v != null ? String(v) : '—';
  }

  // ── View helpers ──────────────────────────────────────────
  protected readonly isMatrix    = computed(() => this.state.activeView() === 'matrix');
  protected readonly isSwimlanes = computed(() => this.state.activeView() === 'swimlanes');
  protected readonly isAnalytics = computed(() => this.state.activeView() === 'analytics');

  // ── Swimlanes collapse/expand controls (#309) ─────────────
  /** True when all lanes are expanded (collapsed set is empty). */
  protected readonly allExpanded = computed(() => this.state.collapsedLanes().size === 0);

  /**
   * True when at least one lane exists and all of them are collapsed.
   * Uses matrixData for service list since we don't own lanes directly.
   */
  protected readonly allCollapsed = computed(() => {
    const services = this.state.matrixData()?.rows.map(r => r.service) ?? [];
    if (!services.length) return false;
    const collapsed = this.state.collapsedLanes();
    return services.every(s => collapsed.has(s));
  });

  protected readonly autoScrollOnChange = computed(() => this.state.autoScrollOnChange());

  protected toggleCollapseAll(): void {
    const services = this.state.matrixData()?.rows.map(r => r.service) ?? [];
    if (this.allCollapsed()) {
      this.state.expandAllLanes();
    } else {
      this.state.collapseAllLanes(services);
    }
  }

  protected toggleAutoScroll(): void {
    this.state.autoScrollOnChange.set(!this.state.autoScrollOnChange());
  }

  // ── All environments from matrix data ─────────────────────
  protected readonly allEnvironments = computed(() =>
    this.state.matrixData()?.environments ?? []
  );

  // ── Column hidden count (badge for Columns button) ────────
  protected readonly colHiddenCount = computed(() =>
    this.state.matrixColHidden().size
  );

  /** Title / aria label for the Columns button, reflecting hidden count. */
  protected readonly columnsBtnTitle = computed(() => {
    const n = this.colHiddenCount();
    return n > 0
      ? `Columns — ${n} environment${n === 1 ? '' : 's'} hidden`
      : 'Columns — show/hide environments';
  });

  // ── Fields hidden count (per-view; badge for Fields button) ──────────────
  protected readonly fieldsHiddenCount = computed(() => {
    if (this.isMatrix()) {
      const visible = this.state.matrixVisibleFields();
      return MATRIX_FIELDS.length - visible.size;
    } else {
      const visible = this.state.swimlaneVisibleFields();
      return SWIMLANE_FIELDS.length - visible.size;
    }
  });

  /** Title / aria label for the Fields button, reflecting hidden count. */
  protected readonly fieldsBtnTitle = computed(() => {
    const n = this.fieldsHiddenCount();
    return n > 0
      ? `Fields — ${n} field${n === 1 ? '' : 's'} hidden`
      : 'Fields — toggle visible data fields';
  });

  // ── Fields picker ─────────────────────────────────────────
  /** Matrix field keys with display labels (parent_deployments removed — not shown in tiles). */
  protected readonly matrixFieldDefs: { key: MatrixField; label: string }[] = [
    { key: 'version',     label: 'version' },
    { key: 'run_url',     label: 'run url' },
    { key: 'sha',         label: 'sha' },
    { key: 'run_number',  label: 'run #' },
    { key: 'ref',         label: 'ref' },
    { key: 'actor',       label: 'actor' },
    { key: 'happened_at', label: 'time' },
  ];

  /** All 8 swimlane field keys with display labels. */
  protected readonly swimlaneFieldDefs: { key: SwimlaneField; label: string }[] = [
    { key: 'environment', label: 'environment' },
    { key: 'version',     label: 'version' },
    { key: 'run_url',     label: 'run url' },
    { key: 'sha',         label: 'sha' },
    { key: 'run_number',  label: 'run #' },
    { key: 'ref',         label: 'ref' },
    { key: 'actor',       label: 'actor' },
    { key: 'happened_at', label: 'time' },
  ];

  protected isMatrixFieldOn(key: MatrixField): boolean {
    return this.state.matrixVisibleFields().has(key);
  }

  protected isSwimlaneFieldOn(key: SwimlaneField): boolean {
    return this.state.swimlaneVisibleFields().has(key);
  }

  protected toggleMatrixField(key: MatrixField): void {
    this.state.toggleMatrixField(key);
  }

  protected toggleSwimlaneField(key: SwimlaneField): void {
    this.state.toggleSwimlaneField(key);
  }

  // ── Columns picker ────────────────────────────────────────
  protected isColVisible(env: string): boolean {
    return !this.state.matrixColHidden().has(env);
  }

  protected toggleColHidden(env: string): void {
    this.state.toggleColHidden(env, this.allEnvironments());
  }

  protected resetColumns(): void {
    this.state.resetColumns(this.allEnvironments());
  }

  // ── Correlation picker ────────────────────────────────────
  protected readonly correlationPredicates = CORRELATION_PREDICATES;

  protected readonly activePredicate = computed(() => this.state.correlationPredicate());

  protected onPredicateChange(pred: CorrelationPredicate): void {
    this.state.correlationPredicate.set(pred);
  }

  // ── Popover toggles ───────────────────────────────────────
  protected toggleFieldsPopover(event: MouseEvent): void {
    const p = this.fieldsPopover();
    if (p) {
      p.toggle(event);
      this.fieldsPopoverOpen.update(v => !v);
    }
  }

  protected toggleColumnsPopover(event: MouseEvent): void {
    const p = this.columnsPopover();
    if (p) {
      p.toggle(event);
      this.columnsPopoverOpen.update(v => !v);
    }
  }

  protected toggleCorrelationPopover(event: MouseEvent): void {
    const p = this.correlationPopover();
    if (p) {
      p.toggle(event);
      this.correlationPopoverOpen.update(v => !v);
    }
  }

  protected toggleLegendPopover(event: MouseEvent): void {
    const p = this.legendPopover();
    if (p) {
      p.toggle(event);
      this.legendPopoverOpen.update(v => !v);
    }
  }

  protected toggleRateLimitPopover(adapter: string, event: MouseEvent, index: number): void {
    const popovers = this.rateLimitPopovers();
    const p = popovers[index];
    if (p) {
      p.toggle(event);
      const current = new Map(this.rateLimitPopoverOpen());
      current.set(adapter, !(current.get(adapter) ?? false));
      this.rateLimitPopoverOpen.set(current);
    }
  }

  protected toggleNotifPopover(event: MouseEvent): void {
    const p = this.notifPopover();
    if (p) {
      p.toggle(event);
      this.notifPopoverOpen.update(v => !v);
    }
  }

  protected togglePresetsPopover(event: MouseEvent): void {
    const p = this.presetsPopover();
    if (p) {
      p.toggle(event);
      this.presetsPopoverOpen.update(v => !v);
      // Reset transient UI state when opening
      this.presetSaveOpen.set(false);
      this.presetSaveName = '';
      this.renamingPreset.set(null);
      this.presetRenameValue = '';
      this.presetsMsg.set(null);
      // Refresh the read-only provided-preset catalog each time the
      // popover opens (issue #391) — never on close.
      if (this.presetsPopoverOpen()) {
        this.presetsService.loadProvidedPresets();
      }
    }
  }

  // ── Notification prefs ────────────────────────────────────

  /** All 8 statuses in display order. */
  protected readonly notifStatuses: Status[] = NOTIFICATION_STATUSES;

  /** Derived: true when notifications are enabled (for badge-dot display). */
  protected readonly notifEnabled = computed(() => this.notifPrefs.prefs().enabled);

  protected toggleNotifEnabled(): void {
    const enabling = !this.notifPrefs.prefs().enabled;
    this.notifPrefs.updatePrefs({ enabled: enabling });
    // Request permission lazily on first explicit opt-in.
    if (enabling) {
      void this.notifService.requestPermission();
    }
  }

  protected isNotifStatusOn(s: Status): boolean {
    return this.notifPrefs.prefs().statuses.includes(s);
  }

  protected toggleNotifStatus(s: Status): void {
    const current = this.notifPrefs.prefs().statuses;
    const updated = current.includes(s)
      ? current.filter(x => x !== s)
      : [...current, s];
    this.notifPrefs.updatePrefs({ statuses: updated });
  }

  protected readonly notifServiceMode = computed(() => this.notifPrefs.prefs().serviceMode);
  protected readonly notifServiceChips = computed(() => this.notifPrefs.prefs().serviceChips);
  protected readonly notifServiceCaption = computed(() => {
    const p       = this.notifPrefs.prefs();
    const allSvcs = this.allServiceNames();
    if (!p.serviceChips.length) return 'Watching all services';
    const matched = allSvcs.filter((s) => matchesAny(s, p.serviceChips));
    if (p.serviceMode === 'watch-all-except') {
      const watching = allSvcs.length - matched.length;
      return watching === allSvcs.length
        ? 'Watching all services'
        : `Watching ${watching} of ${allSvcs.length} services`;
    } else {
      return matched.length === 0
        ? 'Watching no services'
        : matched.length === allSvcs.length
          ? 'Watching all services'
          : `Watching ${matched.length} of ${allSvcs.length} services`;
    }
  });

  protected setNotifServiceMode(mode: NotifFilterMode): void {
    this.notifPrefs.updatePrefs({ serviceMode: mode });
  }

  protected onNotifServicePatternsChange(chips: string[]): void {
    this.notifPrefs.updatePrefs({ serviceChips: chips });
  }

  protected removeNotifServiceChip(chip: string): void {
    this.notifPrefs.updatePrefs({
      serviceChips: this.notifPrefs.prefs().serviceChips.filter(x => x !== chip),
    });
  }

  protected readonly notifEnvMode = computed(() => this.notifPrefs.prefs().envMode);
  protected readonly notifEnvChips = computed(() => this.notifPrefs.prefs().envChips);
  protected readonly notifEnvCaption = computed(() => {
    const p       = this.notifPrefs.prefs();
    const allEnvs = this.allEnvironments();
    if (!p.envChips.length) return 'Watching all environments';
    const matched = allEnvs.filter((e) => matchesAny(e, p.envChips));
    if (p.envMode === 'watch-all-except') {
      const watching = allEnvs.length - matched.length;
      return watching === allEnvs.length
        ? 'Watching all environments'
        : `Watching ${watching} of ${allEnvs.length} environments`;
    } else {
      return matched.length === 0
        ? 'Watching no environments'
        : matched.length === allEnvs.length
          ? 'Watching all environments'
          : `Watching ${matched.length} of ${allEnvs.length} environments`;
    }
  });

  protected setNotifEnvMode(mode: NotifFilterMode): void {
    this.notifPrefs.updatePrefs({ envMode: mode });
  }

  protected onNotifEnvPatternsChange(chips: string[]): void {
    this.notifPrefs.updatePrefs({ envChips: chips });
  }

  protected removeNotifEnvChip(chip: string): void {
    this.notifPrefs.updatePrefs({
      envChips: this.notifPrefs.prefs().envChips.filter(x => x !== chip),
    });
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  /** Reactive list of saved presets from PresetsService. */
  protected readonly savedPresets = computed(() => this.presetsService.presets());

  /** Whether any presets are saved. */
  protected readonly hasPresets = computed(() => this.savedPresets().length > 0);

  /** The name of the last-applied preset (null = none). */
  protected readonly activePresetName = computed(() => this.presetsService.activePresetName());

  /** True when the given preset is the last-applied one. */
  protected isPresetActive(p: PresetEnvelope): boolean {
    return this.activePresetName() === p.name;
  }

  /** Open / close the save-new-preset name input. */
  protected togglePresetSaveInput(): void {
    this.presetSaveOpen.update(v => !v);
    if (this.presetSaveOpen()) {
      this.presetSaveName = '';
    }
    this.presetsMsg.set(null);
  }

  /** Confirm saving the new preset with the current name input. */
  protected confirmSavePreset(): void {
    const name = this.presetSaveName.trim();
    if (!name) {
      this.presetsMsg.set('Name cannot be blank.');
      return;
    }
    this.presetsService.save(name);
    this.presetSaveName = '';
    this.presetSaveOpen.set(false);
    this.presetsMsg.set(`Saved "${name}".`);
  }

  /** Apply a saved preset. */
  protected applyPreset(p: PresetEnvelope): void {
    this.presetsService.apply(p);
    this.presetsMsg.set(`Applied "${p.name}".`);
  }

  /** Export (download) a single saved preset as a JSON file. */
  protected exportPreset(p: PresetEnvelope): void {
    this.presetsService.exportPreset(p);
  }

  /** Export the current live settings as a JSON file (no save). */
  protected exportCurrentSettings(): void {
    const env: PresetEnvelope = {
      version: 1,
      name: 'current-settings',
      settings: this.presetsService.captureSettings(),
    };
    this.presetsService.exportPreset(env);
  }

  /** Begin renaming a preset — opens the inline rename input for that row. */
  protected beginRenamePreset(p: PresetEnvelope): void {
    this.renamingPreset.set(p);
    this.presetRenameValue = p.name;
    this.presetsMsg.set(null);
  }

  /** Confirm the rename for the currently-renaming preset. */
  protected confirmRenamePreset(): void {
    const target = this.renamingPreset();
    if (!target) return;
    const newName = this.presetRenameValue.trim();
    if (!newName) {
      this.presetsMsg.set('Name cannot be blank.');
      return;
    }
    // Invariant: clear the renaming signal BEFORE persist so that if
    // presetsService.rename() swallows a localStorage quota error the inline
    // input is never left pointing at a ghost object.
    this.renamingPreset.set(null);
    this.presetRenameValue = '';
    try {
      this.presetsService.rename(target, newName);
    } finally {
      this.presetsMsg.set(null);
    }
  }

  /** Cancel an in-progress rename. */
  protected cancelRenamePreset(): void {
    this.renamingPreset.set(null);
    this.presetRenameValue = '';
    this.presetsMsg.set(null);
  }

  /** Clone a preset — adds a copy with " (copy)" suffix. */
  protected clonePreset(p: PresetEnvelope): void {
    this.presetsService.clone(p, `${p.name} (copy)`);
    this.presetsMsg.set(`Cloned "${p.name}".`);
  }

  /** Update a preset — overwrites its stored settings with the current live settings after confirm. */
  protected updatePreset(p: PresetEnvelope): void {
    if (!confirm(`Update preset "${p.name}" with the current settings?\nThis will overwrite its stored settings.`)) return;
    this.presetsService.update(p);
    this.presetsMsg.set(`Updated "${p.name}".`);
  }

  /** Delete a preset — shows native confirm before proceeding. */
  protected deletePreset(p: PresetEnvelope): void {
    // Session decision #4: delete requires native confirm naming the preset.
    if (!confirm(`Delete preset "${p.name}"?\nThis cannot be undone.`)) return;
    this.presetsService.delete(p);
    this.presetsMsg.set(null);
  }

  /** Reset all settings to framework defaults after native confirm. */
  protected resetAllSettings(): void {
    if (!confirm('Reset ALL settings to defaults?\nThis will clear all filters, field choices, and preferences.')) return;
    this.presetsService.resetAllSettings();
    this.presetsMsg.set('All settings reset to defaults.');
  }

  /** Import a preset from a file chosen via a hidden <input type="file">. */
  protected triggerImportFile(): void {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { document.body.removeChild(input); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const result = this.presetsService.validateImport(text);
        if (typeof result === 'string') {
          this.presetsMsg.set(result);
        } else {
          this.presetsService.importPreset(result);
          this.presetsMsg.set(`Imported "${result.name}".`);
        }
        document.body.removeChild(input);
      };
      reader.onerror = () => {
        this.presetsMsg.set('Could not read file.');
        document.body.removeChild(input);
      };
      reader.readAsText(file);
    }, { once: true });
    input.click();
  }

  // ── Provided presets (repo/CI-sourced, read-only — issue #391) ────────────

  /** Reactive list of read-only provided presets from PresetsService. */
  protected readonly providedPresets = computed(() => this.presetsService.providedPresets());

  /** Whether any provided presets have loaded. */
  protected readonly hasProvidedPresets = computed(() => this.providedPresets().length > 0);

  /**
   * True when the given provided preset is the last-applied one. Compares by
   * name against the SAME activePresetName signal local presets use — the
   * "active" badge spans both lists (issue #391 gate).
   */
  protected isProvidedPresetActive(p: ProvidedPreset): boolean {
    return this.activePresetName() === p.name;
  }

  /** "provided by {source}" attribution line shown under a provided preset's name. */
  protected attributionLabel(p: ProvidedPreset): string {
    return `provided by ${p.source}`;
  }

  /** Apply a provided preset — converts to a PresetEnvelope and reuses apply() unchanged. */
  protected applyProvidedPreset(p: ProvidedPreset): void {
    this.presetsService.apply(this.presetsService.providedToEnvelope(p));
    this.presetsMsg.set(`Applied "${p.name}".`);
  }

  /**
   * Clone a provided preset into a new LOCAL editable preset (" (copy)"
   * suffix) — reuses clone() unchanged. The clone is a normal local preset:
   * renamable, updatable, deletable, exportable, persisted to dd:presets.
   */
  protected cloneProvidedPreset(p: ProvidedPreset): void {
    this.presetsService.clone(this.presetsService.providedToEnvelope(p), `${p.name} (copy)`);
    this.presetsMsg.set(`Cloned "${p.name}".`);
  }

}

