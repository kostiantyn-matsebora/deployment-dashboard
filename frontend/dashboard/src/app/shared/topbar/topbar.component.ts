import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SelectButton } from 'primeng/selectbutton';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';

import { LucideLayoutGrid, LucideSettings2 } from '@lucide/angular';

import { AppStateService } from '../../core/services/app-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { Theme } from '../../core/models/deployment.model';

interface SelectOption<T> {
  label: string;
  value: T;
}

/**
 * TopbarComponent — persistent header bar.
 *
 * Sub-components per docs/design/components.md §Topbar:
 *   - Brand mark + name
 *   - p-selectButton: Matrix / Swimlanes tabs
 *   - KPI strip (4 counters — data from AppStateService.kpi)
 *   - pInputText: service filter (Matrix-only)
 *   - p-toggleSwitch: failures-only pill (Matrix-only)
 *   - p-selectButton: theme switcher (☀ / ☾ / Auto)
 *   - Icon buttons: Fields picker, Correlation picker (Swimlanes-only)
 *   - Live indicator (SSE connection status)
 *
 * z-index: 30 — renders above matrix/vis shells that use backdrop-filter.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    FormsModule,
    SelectButton,
    ToggleSwitch,
    InputText,
    Popover,
    LucideLayoutGrid,
    LucideSettings2,
  ],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent {
  protected readonly state = inject(AppStateService);
  protected readonly themeService = inject(ThemeService);
  protected readonly router = inject(Router);

  // Popovers — toggled by icon buttons
  protected readonly fieldsPopover = viewChild<Popover>('fieldsPopover');
  protected readonly correlationPopover = viewChild<Popover>('correlationPopover');

  // ── View tab options ─────────────────────────────────────
  protected readonly viewOptions: SelectOption<string>[] = [
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

  // ── Theme options ────────────────────────────────────────
  protected readonly themeOptions: SelectOption<Theme>[] = [
    { label: '☀', value: 'light' },
    { label: '☾', value: 'dark' },
    { label: 'Auto', value: 'auto' },
  ];

  protected readonly activeTheme = computed(() => this.themeService.theme());

  protected onThemeChange(value: Theme): void {
    this.themeService.setTheme(value);
  }

  // ── Filter ───────────────────────────────────────────────
  protected readonly serviceFilter = computed(() => this.state.serviceFilter());

  protected onFilterChange(value: string): void {
    this.state.serviceFilter.set(value);
  }

  // ── Failures toggle ──────────────────────────────────────
  protected readonly failuresOnly = computed(() => this.state.failuresOnly());

  protected onFailuresOnlyChange(value: boolean): void {
    this.state.failuresOnly.set(value);
  }

  // ── KPIs ─────────────────────────────────────────────────
  protected readonly kpi = computed(() => this.state.kpi());

  // ── Live indicator ───────────────────────────────────────
  protected readonly sseConnected = computed(() => this.state.sseConnected());

  // ── View helpers ─────────────────────────────────────────
  protected readonly isMatrix = computed(() => this.state.activeView() === 'matrix');

  // ── Popover toggles ──────────────────────────────────────
  protected toggleFieldsPopover(event: MouseEvent): void {
    this.fieldsPopover()?.toggle(event);
  }

  protected toggleCorrelationPopover(event: MouseEvent): void {
    this.correlationPopover()?.toggle(event);
  }
}
