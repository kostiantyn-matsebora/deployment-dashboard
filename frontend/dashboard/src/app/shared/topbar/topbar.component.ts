import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SelectButton } from 'primeng/selectbutton';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';

import { AppStateService } from '../../core/services/app-state.service';
import { ThemeService } from '../../core/services/theme.service';
import {
  CORRELATION_PREDICATES,
  CorrelationPredicate,
  MATRIX_FIELDS,
  MatrixField,
  RateLimitReport,
  SWIMLANE_FIELDS,
  SwimlaneField,
  Theme,
} from '../../core/models/deployment.model';

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
  ],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  protected readonly state        = inject(AppStateService);
  protected readonly themeService = inject(ThemeService);
  protected readonly router       = inject(Router);

  // Popovers
  protected readonly fieldsPopover        = viewChild<Popover>('fieldsPopover');
  protected readonly columnsPopover       = viewChild<Popover>('columnsPopover');
  protected readonly correlationPopover   = viewChild<Popover>('correlationPopover');
  protected readonly legendPopover        = viewChild<Popover>('legendPopover');
  protected readonly rateLimitPopovers    = viewChildren<Popover>('rateLimitPopover');

  // Popover open state (for icon-btn.is-active highlight)
  protected readonly fieldsPopoverOpen      = signal(false);
  protected readonly columnsPopoverOpen     = signal(false);
  protected readonly correlationPopoverOpen = signal(false);
  protected readonly legendPopoverOpen      = signal(false);
  protected readonly rateLimitPopoverOpen   = signal<Map<string, boolean>>(new Map());

  // ── View tabs ─────────────────────────────────────────────
  protected readonly viewOptions: ViewOption[] = [
    { label: 'Matrix', value: 'matrix' },
    { label: 'Swimlanes', value: 'swimlanes' },
  ];

  protected readonly activeView = computed(() => this.state.activeView());

  protected onViewChange(value: string): void {
    if (value === 'matrix' || value === 'swimlanes') {
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
  protected readonly isMatrix = computed(() => this.state.activeView() === 'matrix');

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
}
