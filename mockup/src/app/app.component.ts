// Mockup-app shell — hand-authored header chrome + router-outlet.
// Selector: dd-mockup-root (prefix dd-mockup avoids collision with SPA's dd prefix).
// NO store bootstrap; NO SSE wiring; NO NgRx.
//
// Pass 1 chrome parity — mirrors frontend/matrix/src/lib/dashboard-header.component.ts:
//   - subtitle: "N services · M environments" (no "Mockup" prefix)
//   - filter row: "Failures only" checkbox, "Focus on last event" checkbox,
//     "Filter services…" search input (all static/visual-only in mockup)
//   - view switcher: segmented control with blue active fill, border-outlined
//   - layout switcher: segmented control with purple active fill, correct labels
//   - Display N/M dropdown button (static closed state)
//   - Topology Version dropdown button (static closed state)
//   - Settings gear icon (static)
//   - Live indicator: "Live · updated just now" with green pulse dot
//   - Mockup-specific links (Invariants · Variants) preserved, relocated after gear
//   - Footer: demoted to lighter stripe (mockup identity, less prominent)

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'dd-mockup-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="min-h-screen bg-gray-50 flex flex-col">

      <!-- App header — visual mirror of <dd-header> chrome.
           Static controls: checkboxes, search input, dropdowns all render
           their closed / default state. No store; no event wiring. -->
      <header class="bg-white border-b border-gray-200 sticky top-0 z-40" data-testid="app-header">
        <div class="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">

          <!-- Brand + subtitle -->
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <div>
              <h1 class="text-base font-semibold text-gray-900 leading-tight">Deployment Dashboard</h1>
              <p class="text-xs text-gray-400 leading-tight" data-testid="header-subtitle">
                4 services · 5 environments
              </p>
            </div>
          </div>

          <!-- Controls row -->
          <div class="flex items-center gap-4 flex-wrap">

            <!-- Failures only toggle (static visual — pointer-events-none preserves checkbox appearance) -->
            <label class="flex items-center gap-2 text-sm text-gray-600 select-none cursor-default"
                   data-testid="failures-only-label">
              <input
                type="checkbox"
                data-testid="failures-only-toggle"
                class="rounded border-gray-300 text-red-500 pointer-events-none"
              />
              <span>Failures only</span>
            </label>

            <!-- Focus on last event toggle (static visual, checked by default) -->
            <label class="flex items-center gap-2 text-sm text-gray-600 select-none cursor-default"
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

            <!-- Filter services search (static visual) -->
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
                class="text-sm border border-gray-200 rounded-md pl-8 pr-3 py-1.5 w-44 focus:outline-none bg-white"
                readonly
              />
            </div>

            <!-- View switcher — segmented control, blue active fill -->
            <div
              class="flex items-center text-xs border border-gray-200 rounded-md overflow-hidden"
              data-testid="view-switcher"
              role="tablist"
              aria-label="Matrix layout view"
            >
              <span
                class="px-2.5 py-1.5 font-medium bg-blue-600 text-white border-r border-gray-200"
                data-testid="view-option-detailed"
                data-active="true"
              >Detailed</span>
              <span
                class="px-2.5 py-1.5 font-medium bg-white text-gray-600 hover:bg-gray-50 border-r border-gray-200"
                data-testid="view-option-compact"
              >Compact</span>
              <span
                class="px-2.5 py-1.5 font-medium bg-white text-gray-600 hover:bg-gray-50 border-r border-gray-200"
                data-testid="view-option-glance"
              >Glance</span>
              <span
                class="px-2.5 py-1.5 font-medium bg-white text-gray-600 hover:bg-gray-50"
                data-testid="view-option-focus"
              >Focus</span>
            </div>

            <!-- Layout switcher — segmented control, purple active fill -->
            <div
              class="flex items-center text-xs border border-gray-200 rounded-md overflow-hidden"
              data-testid="layout-switcher"
              role="tablist"
              aria-label="Dashboard layout"
            >
              <a
                routerLink="/swim-lane"
                routerLinkActive="bg-purple-600 text-white"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-2.5 py-1.5 font-medium border-r border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors no-underline"
                data-testid="layout-option-swim-lane"
              >Swim-lane</a>
              <a
                routerLink="/workflow-rows"
                routerLinkActive="bg-purple-600 text-white"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-2.5 py-1.5 font-medium bg-white text-gray-600 hover:bg-gray-50 transition-colors no-underline"
                data-testid="layout-option-workflow-rows"
              >Workflow rows</a>
            </div>

            <!-- Display N/M dropdown button (static closed state) -->
            <button
              type="button"
              class="flex items-center gap-1.5 text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 hover:bg-gray-50"
              data-testid="attribute-picker"
              title="Choose which attributes to display on the matrix"
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

            <!-- Topology Version dropdown button (static closed state) -->
            <button
              type="button"
              class="flex items-center gap-1.5 text-xs border border-gray-200 rounded-md px-2.5 py-1.5 bg-white text-gray-700 hover:bg-gray-50"
              data-testid="topology-picker"
              title="Topology correlation attribute"
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

            <!-- Settings gear (static decorative) -->
            <button
              type="button"
              class="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              data-testid="theme-switcher"
              title="Settings"
              aria-label="Settings"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <!-- Live indicator -->
            <span class="flex items-center gap-1.5 text-xs text-gray-400 border-l border-gray-200 pl-4"
                  data-testid="live-indicator">
              <span class="relative flex h-2.5 w-2.5 shrink-0">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
              </span>
              Live · updated just now
            </span>

            <!-- Mockup-specific sandbox links (kept after live indicator) -->
            <div class="flex items-center gap-2 border-l border-gray-200 pl-3" data-testid="mockup-nav">
              <a
                routerLink="/invariants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >Invariants</a>
              <span class="text-gray-300">·</span>
              <a
                routerLink="/variants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >Variants</a>
            </div>

          </div>
        </div>
      </header>

      <!-- Routed content -->
      <div class="flex-1">
        <router-outlet></router-outlet>
      </div>

      <!-- Footer — mockup identity stripe (demoted: light text, thin border) -->
      <footer class="border-t border-gray-100 px-6 py-1.5 text-[10px] text-gray-300 flex items-center gap-2 bg-white">
        <span>Mockup · Angular 20 standalone · port 4201 · hardcoded fixtures · no SSE</span>
      </footer>
    </div>
  `
})
export class AppComponent {}
