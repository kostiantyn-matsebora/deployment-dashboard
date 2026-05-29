import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SelectButton } from 'primeng/selectbutton';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';

import { AppStateService } from '../../core/services/app-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { Theme } from '../../core/models/deployment.model';

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
  protected readonly state = inject(AppStateService);
  protected readonly themeService = inject(ThemeService);
  protected readonly router = inject(Router);

  // Popovers
  protected readonly fieldsPopover = viewChild<Popover>('fieldsPopover');
  protected readonly correlationPopover = viewChild<Popover>('correlationPopover');

  // Popover open state (for icon-btn.is-active highlight)
  protected readonly fieldsPopoverOpen = signal(false);
  protected readonly correlationPopoverOpen = signal(false);

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

  // ── View helpers ──────────────────────────────────────────
  protected readonly isMatrix = computed(() => this.state.activeView() === 'matrix');

  // ── Popover toggles ───────────────────────────────────────
  protected toggleFieldsPopover(event: MouseEvent): void {
    const p = this.fieldsPopover();
    if (p) {
      p.toggle(event);
      this.fieldsPopoverOpen.update(v => !v);
    }
  }

  protected toggleCorrelationPopover(event: MouseEvent): void {
    const p = this.correlationPopover();
    if (p) {
      p.toggle(event);
      this.correlationPopoverOpen.update(v => !v);
    }
  }
}
