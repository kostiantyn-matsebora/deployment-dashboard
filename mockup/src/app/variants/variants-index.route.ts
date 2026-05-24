// Variants index page — simple link list to each PoC variant route.
// Serves as a nav hub for the /variants/* sandbox routes.

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'dd-mockup-variants-index-route',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 py-6 max-w-2xl">
      <h2 class="text-base font-semibold text-gray-800 mb-1">PoC variant sandbox</h2>
      <p class="text-xs text-gray-500 mb-6">
        Isolated routes for testing topology and env-tag alignment variants.
        Each route uses hardcoded fixture data — no API, no store.
      </p>

      <div class="space-y-3">
        <div class="border border-gray-200 rounded-lg overflow-hidden">
          <div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <span class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Topology variants (swim-lane)</span>
          </div>
          <div class="divide-y divide-gray-100">
            <a
              routerLink="/variants/branching-dag"
              class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div class="mt-0.5 w-2 h-2 rounded-full bg-indigo-400 shrink-0"></div>
              <div>
                <p class="text-sm font-medium text-gray-800">Branching DAG</p>
                <p class="text-xs text-gray-500">
                  dev forks to qa + qahotfix; both converge to uat; uat &rarr; prod.
                  Issue #54 reporter topology.
                </p>
              </div>
            </a>
            <a
              routerLink="/variants/disconnected"
              class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div class="mt-0.5 w-2 h-2 rounded-full bg-purple-400 shrink-0"></div>
              <div>
                <p class="text-sm font-medium text-gray-800">Disconnected topology</p>
                <p class="text-xs text-gray-500">
                  Two independent sub-DAGs (alpha: linear, beta: short) + an orphan service
                  (gamma: prod only, no edges).
                </p>
              </div>
            </a>
          </div>
        </div>

        <div class="border border-gray-200 rounded-lg overflow-hidden">
          <div class="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <span class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Env-tag alignment variants (workflow-rows)</span>
          </div>
          <div class="divide-y divide-gray-100">
            <a
              routerLink="/variants/env-tag-a"
              class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div class="mt-0.5 w-2 h-2 rounded-full bg-amber-400 shrink-0"></div>
              <div>
                <p class="text-sm font-medium text-gray-800">Variant A — per-position width</p>
                <p class="text-xs text-gray-500">
                  <code class="font-mono bg-gray-100 px-1 rounded">--env-tag-col-&#123;n&#125;-width</code> per svc-block.
                  Each position column is as narrow as its widest env-tag at that position.
                  Mirrors swim-lane depth-slot behaviour.
                </p>
              </div>
            </a>
            <a
              routerLink="/variants/env-tag-b"
              class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div class="mt-0.5 w-2 h-2 rounded-full bg-blue-400 shrink-0"></div>
              <div>
                <p class="text-sm font-medium text-gray-800">Variant B — shared-max width</p>
                <p class="text-xs text-gray-500">
                  Single <code class="font-mono bg-gray-100 px-1 rounded">--env-tag-col-width</code> per svc-block.
                  All positions inflate to the widest env-tag anywhere in the block.
                  Simpler template; wider columns at narrow positions.
                </p>
              </div>
            </a>
          </div>
        </div>
      </div>

      <p class="mt-6 text-[10px] text-gray-400">
        Issue #23 env-tag CSS strategy.
        Issue #54 topology rendering.
        Variant data: hardcoded BRANCHING + DISCONNECTED fixtures.
      </p>
    </div>
  `
})
export class VariantsIndexRouteComponent {}
