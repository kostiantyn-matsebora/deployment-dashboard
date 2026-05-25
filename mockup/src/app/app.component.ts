// Mockup-app shell — hand-authored header chrome + router-outlet.
// Selector: dd-mockup-root (prefix dd-mockup avoids collision with SPA's dd prefix).
// NO store bootstrap; NO SSE wiring; NO NgRx.
//
// Chrome parity history:
//   Pass 1 — header subtitle, filter row, segmented switchers, live indicator, footer
//   Pass 2 — checkboxes pointer-events-none, readonly search, larger live dot
//   Pass 3 — layout-switcher label readability fix (Tailwind !important override)
//   Pass 4 — view-switcher wired to ViewModeService signal; Display / Topology /
//             Settings popover panels restored; click-outside + Escape close logic.
//   Pass 5 — dark theme wired: Settings radio drives document.documentElement
//             data-theme attr; styles.css [data-theme="dark"] block handles palette.
//             Auto follows prefers-color-scheme media query.
//
// Popovers:
//   Three inline anchor panels (Display, Topology, Settings).
//   State: openPopover signal = 'display' | 'topology' | 'settings' | null.
//   Clicking a trigger toggles its panel; clicking another trigger swaps.
//   Click-outside handled via a full-screen transparent backdrop div.
//   Escape handled via @HostListener('document:keydown.escape').

import {
  ChangeDetectionStrategy, Component, HostListener, OnInit, inject, signal
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ViewModeService } from './view-mode.service';

type PopoverId = 'display' | 'topology' | 'settings';

@Component({
  selector: 'dd-mockup-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .popover-panel {
      position: absolute;
      top: calc(100% + 6px);
      z-index: 60;
      background: var(--theme-popover-bg, white);
      border: 1px solid var(--theme-popover-bd, #e5e7eb);
      color: var(--theme-popover-fg, #111827);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      min-width: 220px;
      padding: 12px 14px;
    }
    .popover-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--theme-popover-muted-fg, #9ca3af);
      text-transform: uppercase;
      margin-bottom: 10px;
    }
    .popover-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      font-size: 12px;
      color: var(--theme-popover-fg, #374151);
    }
    .popover-section-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--theme-popover-muted-fg, #6b7280);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 8px 0 4px;
    }
  `],
  template: `
    <div
      class="min-h-screen bg-gray-50 dark:bg-[#0d1117] flex flex-col"
    >

      <!-- Full-screen backdrop — closes any open popover on click-outside -->
      @if (openPopover() !== null) {
        <div
          class="fixed inset-0 z-50"
          style="background: transparent"
          data-testid="popover-backdrop"
          (click)="closePopover()"
        ></div>
      }

      <!-- App header -->
      <header class="bg-white dark:bg-[#161b22] border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40" data-testid="app-header">
        <div class="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">

          <!-- Brand + subtitle -->
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <div>
              <h1 class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">Deployment Dashboard</h1>
              <p class="text-xs text-gray-400 dark:text-gray-500 leading-tight" data-testid="header-subtitle">
                4 services · 5 environments
              </p>
            </div>
          </div>

          <!-- Controls row -->
          <div class="flex items-center gap-4 flex-wrap">

            <!-- Failures only toggle (static visual) -->
            <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 select-none cursor-default"
                   data-testid="failures-only-label">
              <input
                type="checkbox"
                data-testid="failures-only-toggle"
                class="rounded border-gray-300 text-red-500 pointer-events-none"
              />
              <span>Failures only</span>
            </label>

            <!-- Focus on last event toggle (checked by default) -->
            <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 select-none cursor-default"
                   title="When on, an incoming event scrolls the affected element into view"
                   data-testid="focus-on-last-event-label">
              <input
                type="checkbox"
                data-testid="focus-on-last-event-toggle"
                class="rounded border-gray-300 text-indigo-500 pointer-events-none"
                checked
              />
              <span>Focus on last event</span>
            </label>

            <!-- Filter services search (readonly visual) -->
            <div class="relative" data-testid="search-container">
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
                   fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                data-testid="search-input"
                placeholder="Filter services…"
                class="text-sm border border-gray-200 dark:border-gray-700 rounded-md pl-8 pr-3 py-1.5 w-44 focus:outline-none bg-white dark:bg-[#161b22] dark:text-gray-300 dark:placeholder-gray-600"
                readonly
              />
            </div>

            <!-- View switcher — wired to ViewModeService signal -->
            <div
              class="flex items-center text-xs border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden"
              data-testid="view-switcher"
              role="tablist"
              aria-label="Matrix layout view"
            >
              @for (opt of viewOpts; track opt.id) {
                <button
                  type="button"
                  class="px-2.5 py-1.5 font-medium transition-colors dark:border-gray-700"
                  [class.border-r]="!$last"
                  [class.border-gray-200]="!$last"
                  [class.bg-blue-600]="viewMode.mode() === opt.id"
                  [class.text-white]="viewMode.mode() === opt.id"
                  [class.bg-white]="viewMode.mode() !== opt.id"
                  [class.dark:bg-gray-800]="viewMode.mode() !== opt.id"
                  [class.text-gray-600]="viewMode.mode() !== opt.id"
                  [class.dark:text-gray-400]="viewMode.mode() !== opt.id"
                  [attr.data-active]="viewMode.mode() === opt.id"
                  [attr.data-testid]="'view-option-' + opt.id"
                  (click)="viewMode.set(opt.id)"
                >{{ opt.label }}</button>
              }
            </div>

            <!-- Layout switcher — purple active fill via routerLinkActive -->
            <div
              class="flex items-center text-xs border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden"
              data-testid="layout-switcher"
              role="tablist"
              aria-label="Dashboard layout"
            >
              <a
                routerLink="/swim-lane"
                routerLinkActive="!bg-purple-600 !text-white"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-2.5 py-1.5 font-medium border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors no-underline"
                data-testid="layout-option-swim-lane"
              >Swim-lane</a>
              <a
                routerLink="/workflow-rows"
                routerLinkActive="!bg-purple-600 !text-white"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-2.5 py-1.5 font-medium bg-white dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors no-underline"
                data-testid="layout-option-workflow-rows"
              >Workflow rows</a>
            </div>

            <!-- Display popover trigger + anchored panel -->
            <div class="relative z-[61]">
              <button
                type="button"
                class="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-[#161b22] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                [class.ring-2]="openPopover() === 'display'"
                [class.ring-blue-400]="openPopover() === 'display'"
                data-testid="attribute-picker"
                title="Choose which attributes to display on the matrix"
                (click)="togglePopover('display', $event)"
              >
                <svg class="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M3 12h18M3 20h18" />
                </svg>
                <span class="font-medium">Display</span>
                <span class="text-gray-400" data-testid="picker-counter">5/7</span>
                <svg class="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              @if (openPopover() === 'display') {
                <div class="popover-panel" data-testid="display-popover">
                  <p class="popover-title">Display: Box contents</p>
                  @for (item of displayItems; track item.id) {
                    <label class="popover-row select-none cursor-pointer">
                      <input
                        type="checkbox"
                        class="rounded border-gray-300 text-blue-500 w-3.5 h-3.5"
                        [checked]="item.checked"
                        [attr.data-testid]="'display-item-' + item.id"
                        (change)="item.checked = !item.checked"
                      />
                      <span>{{ item.label }}</span>
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Topology popover trigger + anchored panel -->
            <div class="relative z-[61]">
              <button
                type="button"
                class="flex items-center gap-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 bg-white dark:bg-[#161b22] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                [class.ring-2]="openPopover() === 'topology'"
                [class.ring-blue-400]="openPopover() === 'topology'"
                data-testid="topology-picker"
                title="Topology correlation attribute"
                (click)="togglePopover('topology', $event)"
              >
                <svg class="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M4 6h16M7 12h13M10 18h10" />
                </svg>
                <span class="font-medium">Topology</span>
                <span class="text-gray-400" data-testid="topology-picker-attr">Version</span>
                <svg class="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              @if (openPopover() === 'topology') {
                <div class="popover-panel" data-testid="topology-popover" style="min-width:290px">
                  <p class="popover-title">Topology: Version</p>
                  <div class="flex gap-4">
                    <div class="flex-1">
                      @for (item of topologyModes; track item.id) {
                        <label class="popover-row select-none cursor-pointer">
                          <input
                            type="radio"
                            name="topology-mode"
                            class="w-3.5 h-3.5 text-blue-500"
                            [checked]="topologyMode === item.id"
                            [value]="item.id"
                            [attr.data-testid]="'topology-mode-' + item.id"
                            (change)="topologyMode = item.id"
                          />
                          <span>{{ item.label }}</span>
                        </label>
                      }
                    </div>
                    @if (topologyMode === 'versions') {
                      <div class="flex-1 border-l border-gray-100 pl-4">
                        <p class="popover-section-label">Version source</p>
                        @for (item of topologyVersionSources; track item.id) {
                          <label class="popover-row select-none cursor-pointer">
                            <input
                              type="radio"
                              name="topology-version-source"
                              class="w-3.5 h-3.5 text-blue-500"
                              [checked]="topologyVersionSource === item.id"
                              [value]="item.id"
                              [attr.data-testid]="'topology-source-' + item.id"
                              (change)="topologyVersionSource = item.id"
                            />
                            <span>{{ item.label }}</span>
                          </label>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Settings popover trigger + anchored panel -->
            <div class="relative z-[61]">
              <button
                type="button"
                class="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent dark:border-gray-700 transition-colors"
                [class.ring-2]="openPopover() === 'settings'"
                [class.ring-blue-400]="openPopover() === 'settings'"
                data-testid="theme-switcher"
                title="Settings"
                aria-label="Settings"
                (click)="togglePopover('settings', $event)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              @if (openPopover() === 'settings') {
                <div class="popover-panel" data-testid="settings-popover" style="right:0; min-width:180px">
                  <p class="popover-title">Settings: {{ selectedThemeLabel }}</p>
                  @for (item of themeOptions; track item.id) {
                    <label class="popover-row select-none cursor-pointer">
                      <input
                        type="radio"
                        name="theme"
                        class="w-3.5 h-3.5 text-blue-500"
                        [checked]="selectedTheme === item.id"
                        [value]="item.id"
                        [attr.data-testid]="'theme-option-' + item.id"
                        (change)="selectedTheme = item.id"
                      />
                      <span>{{ item.label }}</span>
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Live indicator -->
            <span class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 border-l border-gray-200 dark:border-gray-700 pl-4"
                  data-testid="live-indicator">
              <span class="relative flex h-2.5 w-2.5 shrink-0">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              Live · updated just now
            </span>

            <!-- Mockup-specific sandbox links -->
            <div class="flex items-center gap-2 border-l border-gray-200 dark:border-gray-700 pl-3" data-testid="mockup-nav">
              <a
                routerLink="/invariants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              >Invariants</a>
              <span class="text-gray-300 dark:text-gray-700">·</span>
              <a
                routerLink="/variants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              >Variants</a>
            </div>

          </div>
        </div>
      </header>

      <!-- Routed content -->
      <div class="flex-1">
        <router-outlet></router-outlet>
      </div>

      <!-- Footer -->
      <footer class="border-t border-gray-100 dark:border-gray-800 px-6 py-1.5 text-[10px] text-gray-300 dark:text-gray-700 flex items-center gap-2 bg-white dark:bg-[#161b22]">
        <span>Mockup · Angular 20 standalone · port 4201 · hardcoded fixtures · no SSE</span>
      </footer>
    </div>
  `
})
export class AppComponent implements OnInit {
  readonly viewMode = inject(ViewModeService);

  readonly viewOpts: { id: 'detailed' | 'compact' | 'glance' | 'focus'; label: string }[] = [
    { id: 'detailed', label: 'Detailed' },
    { id: 'compact',  label: 'Compact'  },
    { id: 'glance',   label: 'Glance'   },
    { id: 'focus',    label: 'Focus'    },
  ];

  // ── Popover state ────────────────────────────────────────────────────────────
  readonly openPopover = signal<PopoverId | null>(null);

  togglePopover(id: PopoverId, event: MouseEvent): void {
    event.stopPropagation();
    this.openPopover.update(cur => cur === id ? null : id);
  }

  closePopover(): void {
    this.openPopover.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closePopover();
  }

  // ── Display popover items ────────────────────────────────────────────────────
  displayItems = [
    { id: 'status-badge',  label: 'Status badge',  checked: true  },
    { id: 'job-id',        label: 'Job ID',         checked: true  },
    { id: 'author',        label: 'Author',         checked: false },
    { id: 'actor',         label: 'Actor',          checked: true  },
    { id: 'id-number',     label: 'ID number',      checked: false },
    { id: 'source',        label: 'Source',         checked: false },
    { id: 'source-ref',    label: 'Source ref',     checked: true  },
    { id: 'active',        label: 'Active',         checked: true  },
    { id: 'source-url',    label: 'Source url',     checked: false },
    { id: 'commit-sha',    label: 'Commit SHA',     checked: true  },
  ];

  // ── Topology popover state ───────────────────────────────────────────────────
  topologyMode = 'versions';
  topologyVersionSource = 'last-successful';

  readonly topologyModes = [
    { id: 'system-default', label: 'System default' },
    { id: 'versions',       label: 'Versions'       },
    { id: 'ref',            label: 'Ref'            },
    { id: 'commit-sha',     label: 'Commit SHA'     },
    { id: 'elapsed-time',   label: 'Elapsed time'   },
  ];

  readonly topologyVersionSources = [
    { id: 'last-successful', label: 'Last successful version' },
    { id: 'run-number',      label: 'Run number'              },
    { id: 'ref',             label: 'Ref'                     },
  ];

  // ── Settings popover state ───────────────────────────────────────────────────
  private _selectedTheme = 'light';

  get selectedTheme(): string { return this._selectedTheme; }
  get selectedThemeLabel(): string {
    return this.themeOptions.find(t => t.id === this._selectedTheme)?.label ?? 'Light';
  }

  set selectedTheme(value: string) {
    this._selectedTheme = value;
    this.applyTheme(value);
  }

  private applyTheme(theme: string): void {
    if (typeof document === 'undefined') return; // SSR guard
    // Persist preference so the FOIT-safe bootstrap script picks it up on reload.
    try { localStorage.setItem('mockup.theme', theme); } catch(e) {}
    let effective: 'dark' | 'light';
    if (theme === 'dark') {
      effective = 'dark';
    } else if (theme === 'auto') {
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      effective = prefersDark ? 'dark' : 'light';
    } else {
      effective = 'light';
    }
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme-pref', theme);
  }

  /** Read persisted preference from localStorage on init. */
  ngOnInit(): void {
    try {
      const stored = localStorage.getItem('mockup.theme');
      if (stored === 'light' || stored === 'dark' || stored === 'auto') {
        this._selectedTheme = stored;
        // data-theme is already set by the inline script; no DOM write needed.
      }
    } catch(e) {}
  }

  readonly themeOptions = [
    { id: 'light', label: 'Light' },
    { id: 'dark',  label: 'Dark'  },
    { id: 'auto',  label: 'Auto'  },
  ];
}
