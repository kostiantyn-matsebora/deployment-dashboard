// One service x environment slot at canonical Detailed-view dimensions.
// Renders all 6 box states from the mockup. Used directly by the Detailed
// row and by the Focus row when its service is expanded.
//
// Visual contract is in docs/deployment-dashboard.html — copy class strings
// literally where they make sense; do not re-invent the palette.
//
// Attribute picker (FR-12) — the body conditionally renders status badge /
// version / run / ago / actor based on the store's `activeAttrs`. The
// always-on elements (background colour treatment, ⚠ prev. failed badge,
// last-successful split section) ignore the picker — per the SAD §7
// "Always-on elements".
//
// When `forceAllAttrs` is set (Focus-view expanded row), the picker is
// ignored and every attribute is rendered — the "Full-attribute disclosure
// rule" in the SAD.

import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DeploymentMatrixStore,
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
  selector: 'dd-stage-box',
  standalone: true,
  imports: [CommonModule, HighlightVersionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="stage-box w-40 rounded-lg border-2 overflow-hidden relative"
      [class]="boxClass()"
      [attr.data-testid]="'stage-box-' + service().id + '-' + env().id"
      [attr.data-state]="dataState()"
      [attr.data-view]="dataView()"
      [attr.title]="tooltip()"
      [attr.role]="slot() ? 'button' : null"
      [attr.tabindex]="slot() ? 0 : null"
      [attr.aria-label]="tooltip()"
      [ddHighlightVersion]="slot()?.current?.version ?? null"
      (click)="onClick()"
      (keydown.enter)="onClick()"
      (keydown.space)="onClick()"
    >
      <!-- Empty box -->
      @if (!slot()) {
        <div class="h-16 flex items-center justify-center">
          <span class="text-gray-300 text-xl">—</span>
        </div>
      } @else {
        <!-- Current state section -->
        <div class="p-2.5">
          @if (showStatus() || showRun()) {
            <div class="flex items-center justify-between mb-1.5">
              @if (showStatus()) {
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
                  [class.bg-green-100]="slot()!.current.status === 'success'"
                  [class.text-green-700]="slot()!.current.status === 'success'"
                  [class.bg-red-100]="slot()!.current.status === 'failure'"
                  [class.text-red-700]="slot()!.current.status === 'failure'"
                  [class.bg-orange-100]="slot()!.current.status === 'in-progress'"
                  [class.text-orange-700]="slot()!.current.status === 'in-progress'"
                  [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-status-' + service().id + '-' + env().id) : null"
                >
                  @if (slot()!.current.status === 'in-progress') {
                    <span class="spinner" data-testid="spinner"></span>
                    <span>running…</span>
                  } @else if (slot()!.current.status === 'success') {
                    <span>✓</span><span>success</span>
                  } @else {
                    <span>✗</span><span>failed</span>
                  }
                </span>
              }
              @if (showRun()) {
                <a
                  [href]="slot()!.current.runUrl"
                  (click)="$event.stopPropagation()"
                  class="text-xs text-blue-500 hover:underline font-mono ml-auto"
                  [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-run-' + service().id + '-' + env().id) : ('run-link-current-' + service().id + '-' + env().id)"
                >#{{ slot()!.current.runNumber }}</a>
              }
            </div>
          }

          @if (showVersion()) {
            <!-- No truncate: detailed view allows the version to wrap so
                 the text rect stays inside the box even for long versions.
                 break-all lets the line break inside an unbreakable
                 numeric+hyphen run (a soft break at the hyphen alone is
                 not enough for runs like v0.0.1778860218657-709). -->
            <p class="text-sm font-bold text-gray-900 font-mono leading-tight break-all"
               [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-version-' + service().id + '-' + env().id) : ('current-version-' + service().id + '-' + env().id)"
               [title]="slot()!.current.version"
            >{{ slot()!.current.version }}</p>
          }
          @if (showAgo()) {
            <p class="text-xs text-gray-400 mt-1 leading-tight truncate"
               [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-ago-' + service().id + '-' + env().id) : ('current-ago-' + service().id + '-' + env().id)"
            >{{ ago() }}</p>
          }
          @if (showActor()) {
            <p class="text-xs text-gray-400 truncate leading-tight"
               [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-actor-' + service().id + '-' + env().id) : ('current-actor-' + service().id + '-' + env().id)"
               [title]="slot()!.current.actor"
            >{{ slot()!.current.actor }}</p>
          }
          @if (showRef()) {
            <!-- SAD §7 "Null-render invariant for nullable attributes":
                 render the slot empty when ref is null/absent; never the
                 literal string "null". The empty string is the legitimate
                 visual rendering. min-h ensures the testid retains a
                 non-zero bounding box even when the value is empty so
                 toBeVisible() oracles still resolve. -->
            <p class="text-xs text-gray-500 truncate leading-tight font-mono min-h-[1em]"
               [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-ref-' + service().id + '-' + env().id) : ('current-ref-' + service().id + '-' + env().id)"
               [title]="refValue()"
            >{{ refValue() }}</p>
          }
          @if (showSha()) {
            <!-- sha — truncated to 7 + ellipsis for display per SAD §7;
                 full value lives on the title attribute (and in the drawer
                 via the full-attribute disclosure rule). Null-render
                 invariant applies — the truncate helper returns ''. min-h
                 preserves visibility for null/empty values. -->
            <p class="text-xs text-gray-500 truncate leading-tight font-mono min-h-[1em]"
               [attr.data-testid]="forceAllAttrs() ? ('focus-expanded-sha-' + service().id + '-' + env().id) : ('current-sha-' + service().id + '-' + env().id)"
               [title]="shaValueFull()"
            >{{ shaValueShort() }}</p>
          }

          @if (showPrevFailedBadge()) {
            <div
              class="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
              data-testid="prev-failed-badge"
            >⚠ prev. failed</div>
          }
        </div>

        @if (slot()!.lastSuccessful) {
          <div class="border-t border-dashed border-gray-200 px-2.5 py-2 bg-white"
               data-testid="last-successful-section">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="text-green-600 text-xs font-bold leading-none shrink-0">✓</span>
              <span class="text-xs font-mono font-semibold text-gray-600 truncate min-w-0"
                    [attr.data-testid]="'last-successful-version-' + service().id + '-' + env().id"
                    [title]="slot()!.lastSuccessful!.version"
              >{{ slot()!.lastSuccessful!.version }}</span>
            </div>
            <p class="text-xs text-gray-400 mt-0.5 leading-tight truncate">{{ lastSuccessfulAgo() }}</p>
          </div>
        }
      }
    </div>
  `
})
export class StageBoxComponent {
  private readonly store = inject(DeploymentMatrixStore);

  readonly service = input.required<ServiceDescriptor>();
  readonly env = input.required<EnvironmentDescriptor>();
  readonly slot = input.required<SlotState | null>();
  /**
   * Force all five attributes to render regardless of the picker. Used by
   * the Focus view's expanded row (SAD "Full-attribute disclosure rule").
   */
  readonly forceAllAttrs = input<boolean>(false);
  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  readonly boxClass = computed(() =>
    getBoxClass(this.slot(), this.store.highlightedVersion())
  );

  readonly tooltip = computed(() =>
    getTooltip(this.service(), this.env(), this.slot())
  );

  readonly ago = computed(() => {
    const s = this.slot();
    return s ? relativeTime(s.current.deployedAt) : '';
  });

  readonly lastSuccessfulAgo = computed(() => {
    const s = this.slot();
    return s?.lastSuccessful ? relativeTime(s.lastSuccessful.deployedAt) : '';
  });

  readonly showPrevFailedBadge = computed(() => {
    const s = this.slot();
    return s != null && s.current.status === 'in-progress' && s.previousFailed;
  });

  /** data-state token mapping to the 6-state table — used by tests + e2e. */
  readonly dataState = computed<string>(() => {
    const s = this.slot();
    if (!s) return 'empty';
    const status = s.current.status;
    const hasLast = s.lastSuccessful != null;
    if (status === 'success') return 'success';
    if (status === 'failure') {
      return hasLast ? 'failed-with-last' : 'failed';
    }
    // in-progress
    if (s.previousFailed) {
      return hasLast ? 'running-prev-failed-with-last' : 'running-prev-failed';
    }
    return hasLast ? 'running-with-last' : 'running';
  });

  /** data-view token — `expanded` when the Focus view has unlocked all attrs. */
  readonly dataView = computed<string>(() =>
    this.forceAllAttrs() ? 'expanded' : 'detailed'
  );

  showAttr(key: AttrKey): boolean {
    if (this.forceAllAttrs()) return true;
    return this.store.activeAttrs().includes(key);
  }
  showStatus(): boolean { return this.showAttr('status'); }
  showVersion(): boolean { return this.showAttr('version'); }
  showRun(): boolean { return this.showAttr('run'); }
  showAgo(): boolean { return this.showAttr('ago'); }
  showActor(): boolean { return this.showAttr('actor'); }
  showRef(): boolean { return this.showAttr('ref'); }
  showSha(): boolean { return this.showAttr('sha'); }

  /** Ref value — '' on null/undefined per the null-render invariant. */
  refValue(): string {
    return this.slot()?.current.ref ?? '';
  }

  /** Sha value (display) — first 7 chars + ellipsis, '' on null/absent. */
  shaValueShort(): string {
    return shaTruncate(this.slot()?.current.sha);
  }

  /** Sha value (tooltip) — full untruncated string, '' on null/absent. */
  shaValueFull(): string {
    return this.slot()?.current.sha ?? '';
  }

  onClick(): void {
    if (this.slot()) this.opened.emit({ service: this.service(), env: this.env() });
  }
}
