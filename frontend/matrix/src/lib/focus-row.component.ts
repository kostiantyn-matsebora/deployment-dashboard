// Focus-view row — collapsed = compact-row dimensions + chevron + pin;
// expanded = Detailed-size stage box. Mirrors the mockup's "Focus view"
// template (docs/deployment-dashboard.html lines 1681-1979).
//
// FR-12: collapsed rows respect the active-attrs picker (cap 4); expanded
// rows always show all seven attributes per the "Full-attribute disclosure
// rule" (SAD §7).
//
// NFR-09 sibling invariant #7 — every box reads `style="width: var(--leaf-width)"`
// from the page-level Focus wrapper (`dd-pipeline-matrix`). When any service
// is Focus-expanded the wrapper flips `--leaf-width` to 200 px and EVERY
// row (collapsed or expanded) widens in lock-step — env-header columns and
// deployment columns stay aligned by construction.
//
// CSS-specificity note: this row deliberately does NOT carry `data-view="focus"`.
// `frontend/dashboard/src/styles.css` declares
// `[data-view="focus"] { --leaf-width: 160px; }` to seed the per-view default
// at the layout root. If the row carried that attribute, the same rule would
// fire LOCALLY on this element and shadow the parent wrapper's inline
// `--leaf-width: 200px` — the row's leaves would stay at 160 px after expand.
// Inheritance from `<main>` (which DOES carry the attribute, plus an inline
// override) gives every row the correct `--leaf-width` regardless of expand
// state.
//
// NFR-09 sibling invariant #6 — service name renders on a single line at
// its intrinsic width (`whitespace-nowrap` + inline `width: max-content`
// on the <p>). The fixed `w-44` container remains as a visual reservation;
// long names overflow it visually without clipping. The <p>'s scrollWidth
// equals its clientWidth by construction.
//
// Layout-agnostic testids — `row-chevron-{id}`, `row-pin-{id}`,
// `row-expanded-{id}` / `row-collapsed-{id}`, `data-expanded`, `data-pinned`
// (per docs/ui-compact-options.md "Focus view specifics"). The legacy
// `focus-row-expand-{id}` and `focus-pin-{id}` testids are kept as
// invisible sr-only aliases so older e2e specs and unit tests continue to
// resolve.

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  DisplayTruncatePipe,
  HighlightVersionDirective,
  shaTruncate,
  type AttrKey,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotState,
  relativeTime
} from '@dd/shared';
import { getBoxClass, getTooltip } from './box-styles';
import { StageBoxComponent } from './stage-box.component';

@Component({
  selector: 'dd-focus-row',
  standalone: true,
  imports: [CommonModule, DisplayTruncatePipe, HighlightVersionDirective, StageBoxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-md border px-3 py-1.5 focus-row"
      [class.row-expanded]="isExpanded()"
      [class.border-blue-200]="isExpanded()"
      [class.border-gray-200]="!isExpanded()"
      [attr.data-testid]="isExpanded() ? ('row-expanded-' + service().id) : ('row-collapsed-' + service().id)"
      [attr.data-service-row]="service().id"
      [attr.data-expanded]="isExpanded()"
      [attr.data-pinned]="isPinned()"
    >
      <!-- Hidden aliases — keep older selectors that address the row by the
           canonical service-row testid + the focus-pin / focus-row-expand
           testids resolvable. -->
      <span class="sr-only"
            [attr.data-testid]="'service-row-' + service().id"
            [attr.data-expanded]="isExpanded()"
      ></span>
      <div class="flex items-start">
        <div class="w-44 shrink-0 pr-2 flex items-start gap-1">
          <button
            type="button"
            class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border transition-colors mt-0.5"
            [class.bg-blue-100]="isExpanded()"
            [class.border-blue-300]="isExpanded()"
            [class.text-blue-700]="isExpanded()"
            [class.hover:bg-blue-200]="isExpanded()"
            [class.bg-blue-50]="!isExpanded()"
            [class.border-blue-200]="!isExpanded()"
            [class.text-blue-600]="!isExpanded()"
            [class.hover:bg-blue-100]="!isExpanded()"
            [attr.aria-expanded]="isExpanded()"
            [attr.aria-label]="isExpanded() ? 'Collapse row' : 'Expand row to full detail'"
            [title]="isExpanded() ? 'Collapse row' : 'Expand row to full detail'"
            [attr.data-testid]="'row-chevron-' + service().id"
            (click)="store.toggleExpand(service().id)"
          >
            <svg
              class="w-3.5 h-3.5 transition-transform"
              [class.rotate-90]="isExpanded()"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <!-- Legacy alias for focus-row-expand-{id} — sr-only invisible
               button referencing the same store action so older specs
               still resolve the testid. -->
          <button
            type="button"
            class="sr-only"
            tabindex="-1"
            aria-hidden="true"
            [attr.data-testid]="'focus-row-expand-' + service().id"
            (click)="store.toggleExpand(service().id)"
          ></button>
          <button
            type="button"
            class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded border transition-colors mt-0.5"
            [class.pin-active]="isPinned()"
            [class.bg-amber-100]="isPinned()"
            [class.border-amber-300]="isPinned()"
            [class.hover:bg-amber-200]="isPinned()"
            [class.bg-gray-50]="!isPinned()"
            [class.border-gray-200]="!isPinned()"
            [class.text-gray-400]="!isPinned()"
            [class.hover:bg-amber-50]="!isPinned()"
            [class.hover:text-amber-600]="!isPinned()"
            [class.hover:border-amber-200]="!isPinned()"
            [attr.aria-pressed]="isPinned()"
            [attr.aria-label]="isPinned() ? 'Unpin row' : 'Pin row to keep expanded across filters'"
            [title]="isPinned() ? 'Unpin (stays expanded)' : 'Pin row (stays expanded across filters)'"
            [attr.data-testid]="'row-pin-' + service().id"
            (click)="store.togglePin(service().id)"
          >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.828 2.172a1 1 0 011.415 0l6.586 6.586a1 1 0 010 1.414l-1.415 1.415-3-3-5 5 3 3-1.414 1.414a1 1 0 01-1.415 0L2 11.414a1 1 0 010-1.414l1.414-1.414 3 3 5-5-3-3 1.414-1.414z" />
            </svg>
          </button>
          <!-- Legacy alias for focus-pin-{id}. -->
          <button
            type="button"
            class="sr-only"
            tabindex="-1"
            aria-hidden="true"
            [attr.data-testid]="'focus-pin-' + service().id"
            (click)="store.togglePin(service().id)"
          ></button>
          <div class="min-w-0 flex-1">
            <!-- NFR-09 #6 — single-line at intrinsic width. whitespace-nowrap
                 + inline width:max-content content-size the <p>. -->
            <p
              class="text-xs font-semibold text-gray-800 whitespace-nowrap"
              style="width: max-content"
              [attr.data-testid]="'service-name-' + service().id"
              [title]="service().name"
            >{{ service().name }}</p>
            <p class="text-[10px] text-gray-400 leading-tight">{{ summary() }}</p>
          </div>
        </div>

        <div class="flex items-start overflow-x-auto">
          @for (env of envs(); track env.id; let idx = $index) {
            <div class="flex items-start">
              @if (isExpanded()) {
                <!-- Expanded — full-size stage box, all attributes forced on.
                     Width comes from --leaf-width (page-level Focus wrapper). -->
                <div style="width: var(--leaf-width)">
                  <dd-stage-box
                    [service]="service()"
                    [env]="env"
                    [slot]="slotFor(env)"
                    [forceAllAttrs]="true"
                    [widthAuto]="true"
                    (opened)="opened.emit($event)"
                  ></dd-stage-box>
                </div>
              } @else {
                <!-- Collapsed — compact-style box respecting activeAttrs.
                     Width comes from --leaf-width. -->
                <div
                  class="rounded-md border overflow-hidden relative transition-shadow"
                  style="width: var(--leaf-width)"
                  [class]="boxClass(env)"
                  [attr.data-testid]="'stage-box-' + service().id + '-' + env.id"
                  [attr.data-state]="dataState(env)"
                  data-view="focus-collapsed"
                  [title]="tooltip(env)"
                  [attr.role]="slotFor(env) ? 'button' : null"
                  [attr.tabindex]="slotFor(env) ? 0 : null"
                  [ddHighlightVersion]="slotFor(env)?.current?.version ?? null"
                  (click)="onClick(env)"
                  (keydown.enter)="onClick(env)"
                  (keydown.space)="onClick(env)"
                >
                  @if (!slotFor(env)) {
                    <div class="h-8 flex items-center justify-center">
                      <span class="text-gray-300 text-xs">—</span>
                    </div>
                  } @else if (slotFor(env); as s) {
                    <div>
                      <div class="px-1.5 py-1 min-w-0">
                        @if (showAttr('status') || showAttr('version')) {
                          <div class="flex items-center justify-between gap-1 min-w-0">
                            @if (showAttr('status')) {
                              <span
                                class="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[10px] font-semibold leading-tight shrink-0"
                                [class.bg-green-100]="s.current.status === 'success'"
                                [class.text-green-700]="s.current.status === 'success'"
                                [class.bg-red-100]="s.current.status === 'failure'"
                                [class.text-red-700]="s.current.status === 'failure'"
                                [class.bg-orange-100]="s.current.status === 'in-progress'"
                                [class.text-orange-700]="s.current.status === 'in-progress'"
                              >
                                @if (s.current.status === 'in-progress') {
                                  <span class="spinner" data-testid="spinner" style="width:10px;height:10px;border-width:1.5px"></span>
                                } @else if (s.current.status === 'success') {
                                  <span>✓</span>
                                } @else {
                                  <span>✗</span>
                                }
                              </span>
                            }
                            @if (showAttr('version')) {
                              <span
                                class="text-[11px] font-bold text-gray-900 font-mono leading-tight truncate flex-1 min-w-0 text-right"
                                [attr.data-testid]="'current-version-' + service().id + '-' + env.id"
                                [title]="s.current.version"
                              >{{ s.current.version | displayTruncate:12 }}</span>
                            }
                          </div>
                        }
                        @if (showAttr('ago') || showAttr('run')) {
                          <div class="flex items-center justify-between gap-1 mt-0.5 min-w-0">
                            @if (showAttr('ago')) {
                              <span class="text-[10px] text-gray-400 leading-tight truncate min-w-0 flex-1"
                                    [attr.data-testid]="'current-ago-' + service().id + '-' + env.id"
                              >{{ agoOf(s.current) }}</span>
                            }
                            @if (showAttr('run')) {
                              <a
                                [href]="s.current.runUrl"
                                (click)="$event.stopPropagation()"
                                class="text-[10px] text-blue-500 hover:underline font-mono leading-tight shrink-0 ml-auto"
                                [attr.data-testid]="'run-link-current-' + service().id + '-' + env.id"
                              >#{{ s.current.runNumber }}</a>
                            }
                          </div>
                        }
                        @if (showAttr('actor')) {
                          <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5"
                             [attr.data-testid]="'current-actor-' + service().id + '-' + env.id"
                             [title]="s.current.actor"
                          >{{ s.current.actor | displayTruncate:16 }}</p>
                        }
                        @if (showAttr('ref')) {
                          <!-- Null-render invariant. -->
                          <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5 font-mono"
                             [attr.data-testid]="'current-ref-' + service().id + '-' + env.id"
                             [title]="refValueOf(s)"
                          >{{ refValueOf(s) | displayTruncate:14 }}</p>
                        }
                        @if (showAttr('sha')) {
                          <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5 font-mono"
                             [attr.data-testid]="'current-sha-' + service().id + '-' + env.id"
                             [title]="shaFullOf(s)"
                          >{{ shaShortOf(s) }}</p>
                        }
                        @if (s.current.status === 'in-progress' && s.previousFailed) {
                          <div
                            class="mt-0.5 inline-flex items-center text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0 leading-none"
                            data-testid="prev-failed-badge"
                          >⚠ prev failed</div>
                        }
                      </div>
                      @if (s.lastSuccessful) {
                        <div class="border-t border-dashed border-gray-200 px-1.5 py-0.5 bg-white"
                             data-testid="last-successful-section">
                          <div class="flex items-center justify-between gap-1 min-w-0">
                            <span class="text-green-600 text-[10px] font-bold leading-none shrink-0">✓</span>
                            <span class="text-[10px] font-mono font-semibold text-gray-600 truncate min-w-0 flex-1"
                                  [attr.data-testid]="'last-successful-version-' + service().id + '-' + env.id"
                                  [title]="s.lastSuccessful.version"
                            >{{ s.lastSuccessful.version | displayTruncate:12 }}</span>
                            <span class="text-[9px] text-gray-400 leading-tight shrink-0">{{ agoOf(s.lastSuccessful) }}</span>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
              @if (idx < envs().length - 1) {
                <!-- Per-row arrow-gap mirrors --focus-arrow-gap from the
                     page-level Focus wrapper. Header + every row share the
                     SAME variable, so next-env column anchors stay aligned. -->
                <div class="flex items-center" style="width: var(--focus-arrow-gap)">
                  <div class="arrow-line" style="width:calc(100% - 6px)"></div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class FocusRowComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly service = input.required<ServiceDescriptor>();
  readonly envs = input.required<readonly EnvironmentDescriptor[]>();
  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  readonly isExpanded = computed(() =>
    this.store.expandedServices().has(this.service().id)
  );
  readonly isPinned = computed(() =>
    this.store.pinnedServices().has(this.service().id)
  );

  slotFor(env: EnvironmentDescriptor): SlotState | null {
    return this.store.matrix()[this.service().id]?.[env.id] ?? null;
  }

  boxClass(env: EnvironmentDescriptor): string {
    return getBoxClass(this.slotFor(env), this.store.highlightedVersion());
  }

  tooltip(env: EnvironmentDescriptor): string {
    return getTooltip(this.service(), env, this.slotFor(env));
  }

  showAttr(key: AttrKey): boolean {
    return this.store.activeAttrs().includes(key);
  }

  /** Ref value — '' on null/absent (null-render invariant). */
  refValueOf(s: SlotState): string {
    return s.current.ref ?? '';
  }

  /** Sha truncated for display (7 chars + ellipsis); '' on null/absent. */
  shaShortOf(s: SlotState): string {
    return shaTruncate(s.current.sha);
  }

  /** Full sha — surfaced via title attribute. */
  shaFullOf(s: SlotState): string {
    return s.current.sha ?? '';
  }

  agoOf(ev: { deployedAt: string }): string {
    return relativeTime(ev.deployedAt);
  }

  dataState(env: EnvironmentDescriptor): string {
    const s = this.slotFor(env);
    if (!s) return 'empty';
    const status = s.current.status;
    const hasLast = s.lastSuccessful != null;
    if (status === 'success') return 'success';
    if (status === 'failure') return hasLast ? 'failed-with-last' : 'failed';
    if (s.previousFailed) return hasLast ? 'running-prev-failed-with-last' : 'running-prev-failed';
    return hasLast ? 'running-with-last' : 'running';
  }

  onClick(env: EnvironmentDescriptor): void {
    const s = this.slotFor(env);
    if (s) this.opened.emit({ service: this.service(), env });
  }

  summary(): string {
    const envs = this.store.matrix()[this.service().id] ?? {};
    const failures = Object.values(envs).filter(
      x => x?.current.status === 'failure'
    ).length;
    return failures > 0 ? `${failures} failure(s)` : 'All green';
  }
}
