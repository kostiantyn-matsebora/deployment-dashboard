// History drawer — current state panel, last-successful panel (when distinct),
// and the history list. History is fetched lazily via GET /api/deployments/
// {service}/{environment}/history when the drawer opens.

import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ApiClientService,
  DeploymentMatrixStore,
  formatDateTime,
  relativeTime,
  type DeploymentEvent,
  type HistoryEntry,
  type SlotState
} from '@dd/shared';

@Component({
  selector: 'dd-history-drawer',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.drawerOpen()) {
      <div
        class="fixed inset-y-0 right-0 w-[26rem] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-50"
        data-testid="history-drawer"
        [attr.data-drawer-slot]="drawerSlotToken()"
      >
        <!-- Header -->
        <div class="flex items-start justify-between p-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 class="font-semibold text-gray-900"
                data-testid="drawer-service-name"
            >{{ store.drawerService()?.name }}</h2>
            <p class="text-sm text-gray-500 mt-0.5">
              <span data-testid="drawer-env-label">{{ store.drawerEnv()?.label }}</span> environment
            </p>
          </div>
          <button
            (click)="store.closeDrawer()"
            class="text-gray-400 hover:text-gray-700 p-1 rounded-md hover:bg-gray-100 transition-colors ml-4 shrink-0"
            aria-label="Close drawer"
            data-testid="drawer-close"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Current + last successful panels -->
        @if (slot(); as s) {
          <div class="p-4 border-b border-gray-200">
            <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">Current deployment</p>
            <div
              class="rounded-lg border-2 p-3"
              [class.border-green-200]="s.current.status === 'success'"
              [class.bg-green-50]="s.current.status === 'success'"
              [class.border-red-200]="s.current.status === 'failure'"
              [class.bg-red-50]="s.current.status === 'failure'"
              [class.in-progress-box]="s.current.status === 'in-progress'"
              [class.border-orange-300]="s.current.status === 'in-progress'"
              [class.bg-orange-50]="s.current.status === 'in-progress'"
              data-testid="drawer-current"
            >
              <div class="flex items-center justify-between mb-1">
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold"
                    [class.bg-green-100]="s.current.status === 'success'"
                    [class.text-green-700]="s.current.status === 'success'"
                    [class.bg-red-100]="s.current.status === 'failure'"
                    [class.text-red-700]="s.current.status === 'failure'"
                    [class.bg-orange-100]="s.current.status === 'in-progress'"
                    [class.text-orange-700]="s.current.status === 'in-progress'"
                    data-testid="drawer-current-status"
                  >
                    @if (s.current.status === 'in-progress') {
                      <span class="spinner"></span><span>running…</span>
                    } @else if (s.current.status === 'success') {
                      <span>✓</span><span>success</span>
                    } @else {
                      <span>✗</span><span>failed</span>
                    }
                  </span>
                  <span class="text-lg font-bold text-gray-900 font-mono"
                        data-testid="drawer-current-version"
                  >{{ s.current.version }}</span>
                </div>
                <a [href]="s.current.runUrl"
                   class="text-sm text-blue-600 hover:underline font-mono font-medium"
                   data-testid="drawer-current-run"
                >#{{ s.current.runNumber }}</a>
              </div>
              <p class="text-xs text-gray-500" data-testid="drawer-current-ago">{{ relDt(s.current.deployedAt) }}</p>
              <p class="text-xs text-gray-600" data-testid="drawer-current-deployed-at">{{ formatDt(s.current.deployedAt) }}</p>
              <p class="text-xs text-gray-500 mt-0.5" data-testid="drawer-current-actor">{{ s.current.actor }}</p>
              <!-- Full-attribute disclosure (SAD section 7): ref + sha always
                   shown in the drawer, regardless of the matrix attribute
                   picker. The drawer renders the FULL untruncated sha
                   (truncation is a matrix-grid affordance only). The testid
                   wraps the value only - the ref / sha label sits in a
                   sibling span so the e2e oracle textContent check yields
                   only the value string (or empty for null). The outer p
                   renders unconditionally to satisfy the full-attribute
                   disclosure visibility contract; the label is hidden via
                   the [hidden] binding when the value is null/absent so no
                   "ref:" label leaks for null slots. The min-h ensures the
                   testid span retains a non-zero bounding box when empty so
                   toBeVisible() still resolves. -->
              <p class="text-xs text-gray-500 font-mono mt-0.5 min-h-[1em]">
                <span class="uppercase tracking-wider text-gray-400"
                      [hidden]="!hasRef(s.current)">ref</span>@if (hasRef(s.current)) {<span class="text-gray-400"> · </span>}<span
                   class="inline-block align-baseline" style="min-width:1px;min-height:1em"
                   data-testid="drawer-current-ref"
                   [title]="s.current.ref || ''"
                >{{ s.current.ref || '' }}</span>
              </p>
              <p class="text-xs text-gray-500 font-mono mt-0.5 min-h-[1em]">
                <span class="uppercase tracking-wider text-gray-400"
                      [hidden]="!hasSha(s.current)">sha</span>@if (hasSha(s.current)) {<span class="text-gray-400"> · </span>}<span
                   class="inline-block align-baseline" style="min-width:1px;min-height:1em"
                   data-testid="drawer-current-sha"
                   [title]="s.current.sha || ''"
                >{{ s.current.sha || '' }}</span>
              </p>
              @if (s.current.status === 'in-progress' && s.previousFailed) {
                <div class="mt-2 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  ⚠ previous deployment failed
                </div>
              }
            </div>

            @if (s.lastSuccessful) {
              <div class="mt-3" data-testid="drawer-last-successful">
                <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1.5">Last successful</p>
                <div class="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">✓ success</span>
                      <span class="text-base font-bold text-gray-900 font-mono">{{ s.lastSuccessful.version }}</span>
                    </div>
                    <a [href]="s.lastSuccessful.runUrl"
                       class="text-sm text-blue-600 hover:underline font-mono font-medium"
                    >#{{ s.lastSuccessful.runNumber }}</a>
                  </div>
                  <p class="text-xs text-gray-500" data-testid="drawer-last-successful-ago">{{ relDt(s.lastSuccessful.deployedAt) }}</p>
                  <p class="text-xs text-gray-600">{{ formatDt(s.lastSuccessful.deployedAt) }}</p>
                  <p class="text-xs text-gray-500 mt-0.5">{{ s.lastSuccessful.actor }}</p>
                  <!-- Full-attribute disclosure mirrors current panel —
                       testid wraps the value only; label is a sibling
                       span; full untruncated sha (drawer never truncates). -->
                  <p class="text-xs text-gray-500 font-mono mt-0.5 min-h-[1em]">
                    <span class="uppercase tracking-wider text-gray-400"
                          [hidden]="!hasRef(s.lastSuccessful)">ref</span>@if (hasRef(s.lastSuccessful)) {<span class="text-gray-400"> · </span>}<span
                       class="inline-block align-baseline" style="min-width:1px;min-height:1em"
                       data-testid="drawer-last-successful-ref"
                       [title]="s.lastSuccessful.ref || ''"
                    >{{ s.lastSuccessful.ref || '' }}</span>
                  </p>
                  <p class="text-xs text-gray-500 font-mono mt-0.5 min-h-[1em]">
                    <span class="uppercase tracking-wider text-gray-400"
                          [hidden]="!hasSha(s.lastSuccessful)">sha</span>@if (hasSha(s.lastSuccessful)) {<span class="text-gray-400"> · </span>}<span
                       class="inline-block align-baseline" style="min-width:1px;min-height:1em"
                       data-testid="drawer-last-successful-sha"
                       [title]="s.lastSuccessful.sha || ''"
                    >{{ s.lastSuccessful.sha || '' }}</span>
                  </p>
                </div>
              </div>
            }
          </div>
        }

        <!-- History list -->
        <div class="flex-1 overflow-y-auto p-4">
          <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-3">Deployment history</p>

          @if (store.drawerHistoryLoading()) {
            <div class="text-center py-8 text-gray-400 text-sm" data-testid="drawer-history-loading">
              Loading…
            </div>
          } @else if (store.drawerHistory().length === 0) {
            <div class="text-center py-8 text-gray-400 text-sm" data-testid="drawer-history-empty">
              No deployments recorded
            </div>
          } @else {
            <div class="space-y-2" data-testid="drawer-history-list">
              @for (entry of store.drawerHistory(); track entry.deploymentId || (entry.deployedAt + entry.runNumber)) {
                <div class="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors">
                  <span
                    class="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold mt-0.5"
                    [class.bg-green-500]="entry.status === 'success'"
                    [class.bg-orange-400]="entry.status === 'in-progress'"
                    [class.bg-red-500]="entry.status === 'failure'"
                  >
                    @if (entry.status === 'in-progress') {
                      <span class="spinner" style="width:10px;height:10px;border-width:1.5px;border-color:#fde68a;border-top-color:#fff"></span>
                    } @else if (entry.status === 'success') {
                      <span>✓</span>
                    } @else {
                      <span>✗</span>
                    }
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-semibold text-gray-800 text-sm font-mono">{{ entry.version }}</span>
                      <a [href]="entry.runUrl"
                         class="text-xs text-blue-600 hover:underline font-mono shrink-0"
                      >#{{ entry.runNumber }}</a>
                    </div>
                    <p class="text-xs text-gray-500 mt-0.5">{{ formatDt(entry.deployedAt) }}</p>
                    <p class="text-xs text-gray-400">{{ entry.actor }}</p>
                    @if (entry.deploymentId) {
                      <p
                        class="text-[10px] text-gray-400 font-mono mt-1"
                        [attr.data-testid]="'drawer-history-deployment-id'"
                      ><span class="uppercase tracking-wider">id</span> · {{ entry.deploymentId }}</p>
                    }
                    @if (entry.parentDeployments.length > 0) {
                      <p
                        class="text-[10px] text-gray-400 font-mono"
                        [attr.data-testid]="'drawer-history-parent-deployments'"
                      ><span class="uppercase tracking-wider">parents</span> · {{ entry.parentDeployments.join(', ') }}</p>
                    }
                    <!-- Full-attribute disclosure — ref + sha when populated.
                         Drawer renders FULL untruncated sha (drawer never
                         truncates per SAD §7 full-attribute disclosure). -->
                    @if (hasRef(entry)) {
                      <p
                        class="text-[10px] text-gray-400 font-mono"
                        [attr.data-testid]="'drawer-history-ref'"
                      ><span class="uppercase tracking-wider">ref</span> · {{ entry.ref }}</p>
                    }
                    @if (hasSha(entry)) {
                      <p
                        class="text-[10px] text-gray-400 font-mono"
                        [attr.data-testid]="'drawer-history-sha'"
                        [title]="entry.sha"
                      ><span class="uppercase tracking-wider">sha</span> · {{ entry.sha }}</p>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `
})
export class HistoryDrawerComponent {
  readonly store = inject(DeploymentMatrixStore);
  private readonly api = inject(ApiClientService);

  readonly slot = computed<SlotState | null>(() => {
    const s = this.store.drawerService();
    const e = this.store.drawerEnv();
    if (!s || !e) return null;
    return this.store.matrix()[s.id]?.[e.id] ?? null;
  });

  /**
   * `service-id/env-id` token surfaced on the drawer root via
   * `data-drawer-slot`. Used by e2e tests to assert the drawer remains
   * bound to its slot across view / layout switches (see
   * `view-switch-keeps-drawer-open.spec.ts`). Returns `null` when no
   * slot is bound so the attribute is not emitted.
   */
  readonly drawerSlotToken = computed<string | null>(() => {
    const s = this.store.drawerService();
    const e = this.store.drawerEnv();
    return s && e ? `${s.id}/${e.id}` : null;
  });

  constructor() {
    // Lazy-load history each time a new (service, env) is opened.
    effect(() => {
      const s = this.store.drawerService();
      const e = this.store.drawerEnv();
      if (!s || !e || !this.store.drawerOpen()) return;
      this.api.history(s.id, e.id).subscribe({
        next: history => this.store.setDrawerHistory(history),
        error: () => this.store.setDrawerHistory([])
      });
    });
  }

  formatDt(iso: string): string {
    return formatDateTime(iso);
  }

  relDt(iso: string): string {
    return relativeTime(iso);
  }

  /**
   * Null-render invariant guard (SAD §7) — only render the ref / sha line
   * when the source field has a non-empty value. Treats `null`, `undefined`,
   * and `''` identically; never produces the literal string "null".
   */
  hasRef(ev: DeploymentEvent | HistoryEntry): boolean {
    return typeof ev.ref === 'string' && ev.ref.length > 0;
  }

  hasSha(ev: DeploymentEvent | HistoryEntry): boolean {
    return typeof ev.sha === 'string' && ev.sha.length > 0;
  }
}
