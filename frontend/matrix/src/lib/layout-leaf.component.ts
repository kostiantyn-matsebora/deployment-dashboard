// Shared leaf renderer used by the Swim-lane and Workflow-rows layouts.
//
// Byte-identical DOM rules (SAD §"Mockup ↔ Angular SPA bridge"): the inner
// box body across all three layouts × all four views must match the matrix
// layout's per-view leaf. We achieve that here by delegating to the
// existing `dd-stage-box` for Detailed and Focus-expanded, and inlining
// the Compact and Glance leaf DOM directly — same Tailwind classes as the
// matrix's compact-row.component / glance-row.component leaves.
//
// NFR-09 Glance exception: when `view === 'glance'` the env-tag renders
// INSIDE the pill (as the first child of `.pill-current`). Outside-pill
// env-tag is suppressed for that view; the parent leaf-pair collapses.
//
// `forceAllAttrs` honours the SAD "Full-attribute disclosure rule" — used
// by callers when rendering an expanded Focus row in any layout.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
  DisplayTruncatePipe,
  HighlightVersionDirective,
  relativeTime,
  shaTruncate,
  type AttrKey,
  type EnvironmentDescriptor,
  type ServiceDescriptor,
  type SlotState,
  type ViewId
} from '@dd/shared';
import { getBoxClass, getTooltip } from './box-styles';
import { StageBoxComponent } from './stage-box.component';

@Component({
  selector: 'dd-layout-leaf',
  standalone: true,
  imports: [CommonModule, DisplayTruncatePipe, HighlightVersionDirective, StageBoxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (effectiveView()) {
      @case ('detailed') {
        <dd-stage-box
          [service]="service()"
          [env]="env()"
          [slot]="slot()"
          [forceAllAttrs]="forceAllAttrs()"
          (opened)="opened.emit($event)"
        ></dd-stage-box>
      }
      @case ('glance') {
        @if (slot(); as s) {
          <div
            class="pill"
            [class]="pillClass(s)"
            [attr.data-testid]="'stage-box-' + service().id + '-' + env().id"
            [attr.data-state]="dataState()"
            data-view="glance"
            [title]="tooltip()"
            role="button"
            tabindex="0"
            [ddHighlightVersion]="s.current.version"
            (click)="opened.emit({ service: service(), env: env() })"
            (keydown.enter)="opened.emit({ service: service(), env: env() })"
            (keydown.space)="opened.emit({ service: service(), env: env() })"
          >
            <div
              class="pill-current"
              [class.bg-green-50]="s.current.status === 'success'"
              [class.text-green-800]="s.current.status === 'success'"
              [class.bg-red-50]="s.current.status === 'failure'"
              [class.text-red-800]="s.current.status === 'failure'"
              [class.bg-orange-50]="s.current.status === 'in-progress'"
              [class.text-orange-800]="s.current.status === 'in-progress'"
            >
              <!-- NFR-09 Glance exception — env-tag inside .pill-current. -->
              <span class="env-tag" [attr.data-testid]="'env-tag-inside-' + service().id + '-' + env().id" [title]="env().label">{{ env().label | displayTruncate:8 }}</span>
              @if (s.current.status === 'in-progress') {
                <span class="spinner" data-testid="spinner" style="width:9px;height:9px;border-width:1.5px"></span>
              } @else if (s.current.status === 'success') {
                <span class="text-green-600 text-[10px] font-bold leading-none">✓</span>
              } @else {
                <span class="text-red-600 text-[10px] font-bold leading-none">✗</span>
              }

              @if (showAttr('status')) {
                <span class="text-[10px] font-semibold leading-none truncate flex-1 min-w-0">{{ statusText(s) }}</span>
              }
              @if (showAttr('version')) {
                <span
                  class="text-[10px] font-mono font-bold truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-version-' + service().id + '-' + env().id"
                  [title]="s.current.version"
                >{{ s.current.version | displayTruncate:14 }}</span>
              }
              @if (showAttr('run')) {
                <span
                  class="text-[10px] font-mono text-blue-600 truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-run-' + service().id + '-' + env().id"
                >#{{ s.current.runNumber }}</span>
              }
              @if (showAttr('ago')) {
                <span
                  class="text-[10px] text-gray-600 truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-ago-' + service().id + '-' + env().id"
                >{{ ago(s) }}</span>
              }
              @if (showAttr('actor')) {
                <span
                  class="text-[10px] text-gray-600 truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-actor-' + service().id + '-' + env().id"
                  [title]="s.current.actor"
                >{{ s.current.actor | displayTruncate:16 }}</span>
              }
              @if (showAttr('ref')) {
                <!-- Null-render invariant. -->
                <span
                  class="text-[10px] font-mono text-gray-600 truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-ref-' + service().id + '-' + env().id"
                  [title]="refValueOf(s)"
                >{{ refValueOf(s) | displayTruncate:14 }}</span>
              }
              @if (showAttr('sha')) {
                <span
                  class="text-[10px] font-mono text-gray-600 truncate flex-1 min-w-0"
                  [attr.data-testid]="'current-sha-' + service().id + '-' + env().id"
                  [title]="shaFullOf(s)"
                >{{ shaShortOf(s) }}</span>
              }
              @if (s.previousFailed && s.current.status === 'in-progress') {
                <span
                  class="text-[9px] text-amber-700 leading-none"
                  data-testid="prev-failed-badge"
                  title="previous deployment failed"
                >⚠</span>
              }
            </div>
            @if (s.lastSuccessful) {
              <div
                class="pill-stripe bg-green-400"
                data-testid="last-successful-section"
                [title]="'last successful: ' + s.lastSuccessful.version"
              ></div>
            }
          </div>
        } @else {
          <div
            class="pill-empty"
            [attr.data-testid]="'stage-box-' + service().id + '-' + env().id"
            [attr.data-state]="'empty'"
            data-view="glance"
            [title]="tooltip()"
          >—</div>
        }
      }
      @default {
        <!-- Compact + Focus-collapsed: shared layout (Focus collapsed degrades
             to Compact dimensions, per the mockup). -->
        <div
          class="w-[160px] rounded-md border overflow-hidden relative transition-shadow"
          [class]="boxClass()"
          [attr.data-testid]="'stage-box-' + service().id + '-' + env().id"
          [attr.data-state]="dataState()"
          [attr.data-view]="effectiveView()"
          [title]="tooltip()"
          [attr.role]="slot() ? 'button' : null"
          [attr.tabindex]="slot() ? 0 : null"
          [ddHighlightVersion]="slot()?.current?.version ?? null"
          (click)="onClick()"
          (keydown.enter)="onClick()"
          (keydown.space)="onClick()"
        >
          @if (!slot()) {
            <div class="h-8 flex items-center justify-center">
              <span class="text-gray-300 text-xs">—</span>
            </div>
          } @else if (slot(); as s) {
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
                        [attr.data-testid]="'current-version-' + service().id + '-' + env().id"
                        [title]="s.current.version"
                      >{{ s.current.version | displayTruncate:12 }}</span>
                    }
                  </div>
                }
                @if (showAttr('ago') || showAttr('run')) {
                  <div class="flex items-center justify-between gap-1 mt-0.5 min-w-0">
                    @if (showAttr('ago')) {
                      <span class="text-[10px] text-gray-400 leading-tight truncate min-w-0 flex-1"
                            [attr.data-testid]="'current-ago-' + service().id + '-' + env().id"
                      >{{ ago(s) }}</span>
                    }
                    @if (showAttr('run')) {
                      <a
                        [href]="s.current.runUrl"
                        (click)="$event.stopPropagation()"
                        class="text-[10px] text-blue-500 hover:underline font-mono leading-tight shrink-0 ml-auto"
                        [attr.data-testid]="'run-link-current-' + service().id + '-' + env().id"
                      >#{{ s.current.runNumber }}</a>
                    }
                  </div>
                }
                @if (showAttr('actor')) {
                  <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5"
                     [attr.data-testid]="'current-actor-' + service().id + '-' + env().id"
                     [title]="s.current.actor"
                  >{{ s.current.actor | displayTruncate:16 }}</p>
                }
                @if (showAttr('ref')) {
                  <!-- Null-render invariant. -->
                  <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5 font-mono"
                     [attr.data-testid]="'current-ref-' + service().id + '-' + env().id"
                     [title]="refValueOf(s)"
                  >{{ refValueOf(s) | displayTruncate:14 }}</p>
                }
                @if (showAttr('sha')) {
                  <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5 font-mono"
                     [attr.data-testid]="'current-sha-' + service().id + '-' + env().id"
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
                          [attr.data-testid]="'last-successful-version-' + service().id + '-' + env().id"
                          [title]="s.lastSuccessful.version"
                    >{{ s.lastSuccessful.version | displayTruncate:12 }}</span>
                    <span class="text-[9px] text-gray-400 leading-tight shrink-0">{{ ago2(s.lastSuccessful) }}</span>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    }
  `
})
export class LayoutLeafComponent {
  private readonly store = inject(DeploymentMatrixStore);

  readonly service = input.required<ServiceDescriptor>();
  readonly env = input.required<EnvironmentDescriptor>();
  readonly slot = input.required<SlotState | null>();
  /** Override `store.view()` — used by callers that pin a specific renderer. */
  readonly viewOverride = input<ViewId | null>(null);
  /** Forces all five attributes (Focus expanded — SAD "Full-attribute disclosure rule"). */
  readonly forceAllAttrs = input<boolean>(false);

  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  readonly effectiveView = computed<ViewId>(() => this.viewOverride() ?? this.store.view());

  readonly boxClass = computed(() =>
    getBoxClass(this.slot(), this.store.highlightedVersion())
  );

  readonly tooltip = computed(() =>
    getTooltip(this.service(), this.env(), this.slot())
  );

  readonly dataState = computed<string>(() => {
    const s = this.slot();
    if (!s) return 'empty';
    const status = s.current.status;
    const hasLast = s.lastSuccessful != null;
    if (status === 'success') return 'success';
    if (status === 'failure') return hasLast ? 'failed-with-last' : 'failed';
    if (s.previousFailed) return hasLast ? 'running-prev-failed-with-last' : 'running-prev-failed';
    return hasLast ? 'running-with-last' : 'running';
  });

  showAttr(key: AttrKey): boolean {
    if (this.forceAllAttrs()) return true;
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

  pillClass(s: SlotState): string {
    const highlight = this.store.highlightedVersion();
    const isHighlighted = highlight != null && (
      s.current.version === highlight ||
      s.lastSuccessful?.version === highlight
    );
    const ring = isHighlighted ? 'ring-2 ring-offset-1 ring-amber-400 ' : '';
    const status = s.current.status;
    if (status === 'success') return ring + 'border-green-300';
    if (status === 'failure') return ring + 'border-red-300';
    if (status === 'in-progress') return ring + 'in-progress border-orange-400';
    return ring + 'border-gray-200';
  }

  statusText(s: SlotState): string {
    return s.current.status === 'success' ? 'success'
         : s.current.status === 'failure' ? 'failed'
         : 'running…';
  }

  ago(s: SlotState): string {
    return relativeTime(s.current.deployedAt);
  }

  ago2(ev: { deployedAt: string }): string {
    return relativeTime(ev.deployedAt);
  }

  onClick(): void {
    if (this.slot()) this.opened.emit({ service: this.service(), env: this.env() });
  }
}
