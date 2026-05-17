// Compact-view row — ~120px boxes, ~36px row height. Mirrors the mockup's
// "Compact view" template (docs/ui/deployment-dashboard.html lines 352–475).
//
// FR-12 — the slot body respects the picker's `activeAttrs`. Always-on
// elements (background colour, ⚠ badge, last-successful split) ignore
// the picker.

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

@Component({
  selector: 'dd-compact-row',
  standalone: true,
  imports: [CommonModule, DisplayTruncatePipe, HighlightVersionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-md border border-gray-200 px-3 py-1.5"
      [attr.data-testid]="'service-row-' + service().id"
      [attr.data-service-row]="service().id"
      data-view="compact"
    >
      <div class="flex items-center">
        <div class="w-36 shrink-0 pr-2">
          <!-- NFR-09 #6 — single-line at intrinsic width, no truncate / no
               ellipsis / no wrap. The <p> auto-sizes via
               whitespace-nowrap + inline width:max-content. The w-36
               column is a visual reservation; long names overflow visually
               without clipping. -->
          <p
            class="text-xs font-semibold text-gray-800 whitespace-nowrap"
            style="width: max-content"
            [attr.data-testid]="'service-name-' + service().id"
            [title]="service().name"
          >{{ service().name }}</p>
          <p class="text-[10px] text-gray-400 truncate leading-tight">{{ summary() }}</p>
        </div>
        <div class="flex items-center overflow-x-auto">
          @for (env of envs(); track env.id; let idx = $index) {
            <div class="flex items-center">
              <div
                class="w-[120px] rounded-md border overflow-hidden relative transition-shadow"
                [class]="boxClass(env)"
                [attr.data-testid]="'stage-box-' + service().id + '-' + env.id"
                [attr.data-state]="dataState(env)"
                data-view="compact"
                [title]="tooltip(env)"
                [attr.role]="slotFor(env) ? 'button' : null"
                [attr.tabindex]="slotFor(env) ? 0 : null"
                [ddHighlightVersion]="slotFor(env)?.current?.version ?? null"
                (click)="onClick(env)"
                (keydown.enter)="onClick(env)"
                (keydown.space)="onClick(env)"
              >
                @if (!slotFor(env); as _) {
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
                            >{{ ago(s.current) }}</span>
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
                        <!-- Null-render invariant — empty string when ref is null/absent. -->
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
                      @if (showPrevFailed(s)) {
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
                          <span class="text-[9px] text-gray-400 leading-tight shrink-0">{{ ago(s.lastSuccessful) }}</span>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
              @if (idx < envs().length - 1) {
                <!-- Matrix connector — mirrors mockup .arrow-col geometry:
                     wrapper is w-3.5 (14 px) and the line is anchored to
                     the wrapper's left edge with width calc(100% - 6px)
                     so that line.right + 6 == wrapper.right == target.left.
                     The 6 px slack is the arrowhead's protrusion (see
                     dashboard/src/styles.css .arrow-line::after). -->
                <div class="flex items-center w-3.5">
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
export class CompactRowComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly service = input.required<ServiceDescriptor>();
  readonly envs = input.required<readonly EnvironmentDescriptor[]>();
  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  private readonly highlighted = computed(() => this.store.highlightedVersion());

  slotFor(env: EnvironmentDescriptor): SlotState | null {
    return this.store.matrix()[this.service().id]?.[env.id] ?? null;
  }

  boxClass(env: EnvironmentDescriptor): string {
    return getBoxClass(this.slotFor(env), this.highlighted());
  }

  tooltip(env: EnvironmentDescriptor): string {
    return getTooltip(this.service(), env, this.slotFor(env));
  }

  showAttr(key: AttrKey): boolean {
    return this.store.activeAttrs().includes(key);
  }

  /** Ref value for a slot — '' on null/absent (null-render invariant). */
  refValueOf(s: SlotState): string {
    return s.current.ref ?? '';
  }

  /** Sha truncated for display (7 chars + ellipsis); '' on null/absent. */
  shaShortOf(s: SlotState): string {
    return shaTruncate(s.current.sha);
  }

  /** Full sha — surfaced via title attribute (full disclosure in tooltip). */
  shaFullOf(s: SlotState): string {
    return s.current.sha ?? '';
  }

  ago(ev: { deployedAt: string }): string {
    return relativeTime(ev.deployedAt);
  }

  showPrevFailed(s: SlotState): boolean {
    return s.current.status === 'in-progress' && s.previousFailed;
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
