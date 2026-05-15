// Focus-view row — collapsed = compact-row dimensions + chevron + pin;
// expanded = Detailed-size stage box. Mirrors the mockup's "Focus view"
// template (docs/deployment-dashboard.html lines 576–768).
//
// FR-12: collapsed rows respect the active-attrs picker (cap 4); expanded
// rows always show all five attributes per the "Full-attribute disclosure
// rule" (SAD §7).

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
      class="bg-white rounded-md border border-gray-200 px-3 py-1.5"
      [class.row-expanded]="isExpanded()"
      [attr.data-testid]="'service-row-' + service().id"
      [attr.data-service-row]="service().id"
      [attr.data-expanded]="isExpanded()"
      data-view="focus"
    >
      <!-- Alias testid: e2e tests address the Focus row by focus-row plus
           service id (see scenarios/full-attribute-disclosure). Exposed as
           a hidden marker so the canonical service-row testid stays unique. -->
      <span class="sr-only"
            [attr.data-testid]="'focus-row-' + service().id"
            [attr.data-expanded]="isExpanded()"
      ></span>
      <div class="flex items-start">
        <div class="w-44 shrink-0 pr-2 flex items-start gap-1">
          <button
            type="button"
            class="text-gray-400 hover:text-gray-700 mt-0.5 shrink-0"
            [attr.aria-expanded]="isExpanded()"
            [attr.aria-label]="isExpanded() ? 'Collapse row' : 'Expand row'"
            [title]="isExpanded() ? 'Collapse row' : 'Expand row'"
            [attr.data-testid]="'focus-row-expand-' + service().id"
            (click)="store.toggleExpand(service().id)"
          >
            <svg
              class="w-3.5 h-3.5 transition-transform"
              [class.rotate-90]="isExpanded()"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            type="button"
            class="shrink-0 mt-0.5"
            [class.pin-active]="isPinned()"
            [class.text-gray-300]="!isPinned()"
            [class.hover:text-gray-500]="!isPinned()"
            [attr.aria-pressed]="isPinned()"
            [attr.aria-label]="isPinned() ? 'Unpin row' : 'Pin row'"
            [title]="isPinned() ? 'Unpin (stays expanded)' : 'Pin row (stays expanded)'"
            [attr.data-testid]="'focus-pin-' + service().id"
            (click)="store.togglePin(service().id)"
          >
            <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.828 2.172a1 1 0 011.415 0l6.586 6.586a1 1 0 010 1.414l-1.415 1.415-3-3-5 5 3 3-1.414 1.414a1 1 0 01-1.415 0L2 11.414a1 1 0 010-1.414l1.414-1.414 3 3 5-5-3-3 1.414-1.414z" />
            </svg>
          </button>
          <div class="min-w-0">
            <p
              class="text-xs font-semibold text-gray-800 truncate"
              [attr.data-testid]="'service-name-' + service().id"
              [title]="service().name"
            >{{ service().name }}</p>
            <p class="text-[10px] text-gray-400 leading-tight truncate">{{ summary() }}</p>
          </div>
        </div>

        <div class="flex items-center overflow-x-auto">
          @for (env of envs(); track env.id; let idx = $index) {
            <div class="flex items-center">
              @if (isExpanded()) {
                <!-- Expanded — full-size stage box, all attributes forced on. -->
                <dd-stage-box
                  [service]="service()"
                  [env]="env"
                  [slot]="slotFor(env)"
                  [forceAllAttrs]="true"
                  (opened)="opened.emit($event)"
                ></dd-stage-box>
              } @else {
                <!-- Collapsed — compact-style box respecting activeAttrs. -->
                <div
                  class="w-[120px] rounded-md border overflow-hidden relative transition-shadow"
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
                <!-- Matrix connector — mirrors mockup .arrow-col geometry:
                     line anchored to wrapper's left edge with width
                     calc(100% - 6px) so line.right + 6 == target.left.
                     Expanded rows use the Detailed-view w-10 (40 px) gap;
                     collapsed rows use w-3.5 (14 px) like compact-row.
                     Note: Angular's [class.w-3.5] does not work because
                     Angular interprets the dot as a class-name separator.
                     The shorthand [class] binding bypasses that. -->
                <div [class]="'flex items-center ' + (isExpanded() ? 'w-10' : 'w-3.5')">
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
