// Glance-view row — one row per service, one coloured pill per environment.
// Mirrors the mockup's "Glance view" template (docs/deployment-dashboard.html
// lines 477–574). FR-12 cap is 1 attribute, but the pill always renders the
// status colour treatment + ✓/✗ icon + ⚠ badge regardless (always-on).

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
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
import { getTooltip } from './box-styles';

@Component({
  selector: 'dd-glance-row',
  standalone: true,
  imports: [CommonModule, DisplayTruncatePipe, HighlightVersionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-white rounded-md border border-gray-200 px-3 py-1 hover:border-gray-300"
      [attr.data-testid]="'service-row-' + service().id"
      [attr.data-service-row]="service().id"
      data-view="glance"
    >
      <div class="flex items-center">
        <div class="w-40 shrink-0 pr-2">
          <p
            class="text-xs font-semibold text-gray-800 truncate"
            [attr.data-testid]="'service-name-' + service().id"
            [title]="service().name"
          >{{ service().name }}</p>
          <p class="text-[10px] text-gray-400 leading-tight">{{ summary() }}</p>
        </div>

        <div class="flex items-center gap-1.5">
          @for (env of envs(); track env.id) {
            <div class="leaf-pair leaf-pair-glance" [attr.data-env]="env.id">
              @if (!slotFor(env)) {
                <div
                  class="pill-empty"
                  [attr.data-testid]="'stage-box-' + service().id + '-' + env.id"
                  [attr.data-state]="'empty'"
                  data-view="glance"
                  [title]="emptyTooltip(env)"
                >—</div>
              } @else if (slotFor(env); as s) {
                <div
                  class="pill"
                  [class]="pillClass(env, s)"
                  [attr.data-testid]="'stage-box-' + service().id + '-' + env.id"
                  [attr.data-state]="dataState(env)"
                  data-view="glance"
                  [title]="tooltip(env)"
                  role="button"
                  tabindex="0"
                  [ddHighlightVersion]="s.current.version"
                  (click)="opened.emit({ service: service(), env })"
                  (keydown.enter)="opened.emit({ service: service(), env })"
                  (keydown.space)="opened.emit({ service: service(), env })"
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
                    <!-- NFR-09 Glance exception — env-tag rendered INSIDE the
                         pill as its first child. The Matrix layout's column
                         header still carries the env label too; this one
                         keeps the per-pill DOM byte-identical to the Swim-
                         lane and Workflow-rows Glance leaves (SAD §"Glance
                         exception under FR-13"). -->
                    <span class="env-tag"
                          [attr.data-testid]="'env-tag-inside-' + service().id + '-' + env.id"
                          [title]="env.label"
                    >{{ env.label | displayTruncate:8 }}</span>
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
                        [attr.data-testid]="'current-version-' + service().id + '-' + env.id"
                        [title]="s.current.version"
                      >{{ s.current.version | displayTruncate:14 }}</span>
                    }
                    @if (showAttr('run')) {
                      <span
                        class="text-[10px] font-mono text-blue-600 truncate flex-1 min-w-0"
                        [attr.data-testid]="'current-run-' + service().id + '-' + env.id"
                      >#{{ s.current.runNumber }}</span>
                    }
                    @if (showAttr('ago')) {
                      <span
                        class="text-[10px] text-gray-600 truncate flex-1 min-w-0"
                        [attr.data-testid]="'current-ago-' + service().id + '-' + env.id"
                      >{{ ago(s) }}</span>
                    }
                    @if (showAttr('actor')) {
                      <span
                        class="text-[10px] text-gray-600 truncate flex-1 min-w-0"
                        [attr.data-testid]="'current-actor-' + service().id + '-' + env.id"
                        [title]="s.current.actor"
                      >{{ s.current.actor | displayTruncate:16 }}</span>
                    }
                    @if (showAttr('ref')) {
                      <!-- Null-render invariant — empty span when ref is null/absent. -->
                      <span
                        class="text-[10px] font-mono text-gray-600 truncate flex-1 min-w-0"
                        [attr.data-testid]="'current-ref-' + service().id + '-' + env.id"
                        [title]="refValueOf(s)"
                      >{{ refValueOf(s) | displayTruncate:14 }}</span>
                    }
                    @if (showAttr('sha')) {
                      <span
                        class="text-[10px] font-mono text-gray-600 truncate flex-1 min-w-0"
                        [attr.data-testid]="'current-sha-' + service().id + '-' + env.id"
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
              }
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class GlanceRowComponent {
  readonly store = inject(DeploymentMatrixStore);
  readonly service = input.required<ServiceDescriptor>();
  readonly envs = input.required<readonly EnvironmentDescriptor[]>();
  readonly opened = output<{ service: ServiceDescriptor; env: EnvironmentDescriptor }>();

  slotFor(env: EnvironmentDescriptor): SlotState | null {
    return this.store.matrix()[this.service().id]?.[env.id] ?? null;
  }

  pillClass(env: EnvironmentDescriptor, s: SlotState): string {
    const highlighted = this.store.highlightedVersion();
    const isHighlighted = highlighted != null && (
      s.current.version === highlighted ||
      s.lastSuccessful?.version === highlighted
    );
    const ring = isHighlighted ? 'ring-2 ring-offset-1 ring-amber-400 ' : '';
    const status = s.current.status;
    if (status === 'success') return ring + 'border-green-300';
    if (status === 'failure') return ring + 'border-red-300';
    if (status === 'in-progress') return ring + 'in-progress border-orange-400';
    return ring + 'border-gray-200';
  }

  tooltip(env: EnvironmentDescriptor): string {
    return getTooltip(this.service(), env, this.slotFor(env));
  }

  emptyTooltip(env: EnvironmentDescriptor): string {
    return `${this.service().name} — not deployed to ${env.label}`;
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

  statusText(s: SlotState): string {
    return s.current.status === 'success' ? 'success'
         : s.current.status === 'failure' ? 'failed'
         : 'running…';
  }

  ago(s: SlotState): string {
    return relativeTime(s.current.deployedAt);
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

  summary(): string {
    const envs = this.store.matrix()[this.service().id] ?? {};
    const failures = Object.values(envs).filter(
      x => x?.current.status === 'failure'
    ).length;
    return failures > 0 ? `${failures} failure(s)` : 'All green';
  }
}
