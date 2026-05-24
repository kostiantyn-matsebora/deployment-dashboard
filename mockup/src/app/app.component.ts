// Mockup-app shell — hand-authored header chrome + router-outlet.
// Selector: dd-mockup-root (prefix dd-mockup avoids collision with SPA's dd prefix).
// NO store bootstrap; NO SSE wiring; NO NgRx.

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
           Static: no store signals, no event handlers beyond nav links. -->
      <header class="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div class="px-6 py-3 flex items-center justify-between gap-4 flex-wrap">

          <!-- Brand + subtitle -->
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <div>
              <h1 class="text-base font-semibold text-gray-900 leading-tight">Deployment Dashboard</h1>
              <p class="text-xs text-gray-400 leading-tight">
                <span class="font-medium text-amber-600">Mockup</span>
                · 4 services · 5 environments
              </p>
            </div>
          </div>

          <!-- Nav + controls -->
          <div class="flex items-center gap-4 flex-wrap">

            <!-- Layout nav -->
            <nav class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" aria-label="Layout">
              <a
                routerLink="/swim-lane"
                routerLinkActive="bg-blue-600 text-white shadow-sm"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 transition-colors hover:bg-white"
              >Swim-lane</a>
              <a
                routerLink="/workflow-rows"
                routerLinkActive="bg-purple-600 text-white shadow-sm"
                [routerLinkActiveOptions]="{ exact: true }"
                class="px-3 py-1.5 rounded-md text-xs font-medium text-gray-600 transition-colors hover:bg-white"
              >Workflow-rows</a>
            </nav>

            <!-- View switcher (static — mockup shows 'detailed' as default) -->
            <div class="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5" data-testid="view-switcher">
              <span class="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 text-white shadow-sm"
                    data-testid="view-option-detailed">Detailed</span>
              <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
                    data-testid="view-option-compact">Compact</span>
              <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
                    data-testid="view-option-glance">Glance</span>
              <span class="px-2.5 py-1 rounded-md text-xs font-medium text-gray-600"
                    data-testid="view-option-focus">Focus</span>
            </div>

            <!-- Extras nav: invariants + variants -->
            <div class="flex items-center gap-2 border-l border-gray-200 pl-4">
              <a
                routerLink="/invariants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >Invariants</a>
              <span class="text-gray-300">·</span>
              <a
                routerLink="/variants"
                routerLinkActive="text-indigo-600 font-semibold"
                class="text-xs text-gray-500 hover:text-gray-800 transition-colors"
              >Variants</a>
            </div>

            <!-- Live indicator (static mockup badge) -->
            <span class="text-xs text-gray-400 border-l border-gray-200 pl-4" data-testid="live-indicator">
              Mockup · static fixtures
            </span>
          </div>
        </div>
      </header>

      <!-- Routed content -->
      <div class="flex-1">
        <router-outlet></router-outlet>
      </div>

      <!-- Footer -->
      <footer class="bg-white border-t border-gray-200 px-6 py-2 text-xs text-gray-400 flex items-center gap-2">
        <span>Deployment Dashboard — Angular mockup-app</span>
        <span class="text-gray-300">·</span>
        <span>Port 4201</span>
        <span class="text-gray-300">·</span>
        <span>Standalone · hardcoded fixtures · no SSE</span>
      </footer>
    </div>
  `
})
export class AppComponent {}
