// Hand-authored visual mirror of <dd-stage-box> from frontend/matrix/src/lib/.
// Detailed view only (used as the 'detailed' branch in layout-leaf).
// Static: all data via @Input(); no store; OnPush.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { SlotState, ServiceDescriptor, EnvironmentDescriptor } from '../fixtures/index';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function boxBorderClass(slot: SlotState | null): string {
  if (!slot) return 'border-gray-200 bg-white';
  const st = slot.current.status;
  if (st === 'success') return 'border-green-300 bg-white';
  if (st === 'failure') return 'border-red-300 bg-white';
  return 'border-orange-400 bg-white in-progress-box';
}

@Component({
  selector: 'dd-mockup-stage-box',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-md border overflow-hidden relative transition-shadow stage-box"
      style="width: var(--leaf-width, 200px)"
      [ngClass]="boxBorderClass(slot)"
      [attr.data-testid]="'stage-box-' + service.id + '-' + env.id"
      [attr.data-state]="dataState()"
      [attr.data-view]="'detailed'"
    >
      @if (!slot) {
        <div class="h-8 flex items-center justify-center">
          <span class="text-gray-300 text-xs">—</span>
        </div>
      } @else {
        <div>
          <div class="px-1.5 py-1 min-w-0">
            <div class="flex items-center justify-between gap-1 min-w-0">
              <span
                class="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[10px] font-semibold leading-tight shrink-0"
                [class.bg-green-100]="slot.current.status === 'success'"
                [class.text-green-700]="slot.current.status === 'success'"
                [class.bg-red-100]="slot.current.status === 'failure'"
                [class.text-red-700]="slot.current.status === 'failure'"
                [class.bg-orange-100]="slot.current.status === 'in-progress'"
                [class.text-orange-700]="slot.current.status === 'in-progress'"
              >
                @if (slot.current.status === 'in-progress') {
                  <span class="spinner" data-testid="spinner" style="width:10px;height:10px;border-width:1.5px"></span>
                } @else if (slot.current.status === 'success') {
                  <span>✓</span>
                } @else {
                  <span>✗</span>
                }
              </span>
              <span
                class="text-[11px] font-bold text-gray-900 font-mono leading-tight truncate flex-1 min-w-0 text-right"
                [attr.data-testid]="'current-version-' + service.id + '-' + env.id"
                [title]="slot.current.version"
              >{{ truncate(slot.current.version, 12) }}</span>
            </div>
            <div class="flex items-center justify-between gap-1 mt-0.5 min-w-0">
              <span class="text-[10px] text-gray-400 leading-tight truncate min-w-0 flex-1"
                    [attr.data-testid]="'current-ago-' + service.id + '-' + env.id"
              >{{ relativeTime(slot.current.deployedAt) }}</span>
              <a href="#"
                 class="text-[10px] text-blue-500 hover:underline font-mono leading-tight shrink-0 ml-auto"
                 [attr.data-testid]="'run-link-current-' + service.id + '-' + env.id"
              >#{{ slot.current.runNumber }}</a>
            </div>
            <p class="text-[10px] text-gray-500 truncate leading-tight mt-0.5"
               [attr.data-testid]="'current-actor-' + service.id + '-' + env.id"
               [title]="slot.current.actor"
            >{{ truncate(slot.current.actor, 16) }}</p>
            @if (slot.current.status === 'in-progress' && slot.previousFailed) {
              <div
                class="mt-0.5 inline-flex items-center text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0 leading-none"
                data-testid="prev-failed-badge"
              >⚠ prev failed</div>
            }
          </div>
          @if (slot.lastSuccessful) {
            <div class="border-t border-dashed border-gray-200 px-1.5 py-0.5 bg-white"
                 data-testid="last-successful-section">
              <div class="flex items-center justify-between gap-1 min-w-0">
                <span class="text-green-600 text-[10px] font-bold leading-none shrink-0">✓</span>
                <span class="text-[10px] font-mono font-semibold text-gray-600 truncate min-w-0 flex-1"
                      [attr.data-testid]="'last-successful-version-' + service.id + '-' + env.id"
                      [title]="slot.lastSuccessful.version"
                >{{ truncate(slot.lastSuccessful.version, 12) }}</span>
                <span class="text-[9px] text-gray-400 leading-tight shrink-0">{{ relativeTime(slot.lastSuccessful.deployedAt) }}</span>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class StageBoxComponent {
  @Input({ required: true }) service!: ServiceDescriptor;
  @Input({ required: true }) env!: EnvironmentDescriptor;
  @Input({ required: true }) slot!: SlotState | null;

  readonly boxBorderClass = boxBorderClass;
  readonly relativeTime = relativeTime;
  readonly truncate = truncate;

  dataState(): string {
    const s = this.slot;
    if (!s) return 'empty';
    const status = s.current.status;
    const hasLast = s.lastSuccessful != null;
    if (status === 'success') return 'success';
    if (status === 'failure') return hasLast ? 'failed-with-last' : 'failed';
    if (s.previousFailed) return hasLast ? 'running-prev-failed-with-last' : 'running-prev-failed';
    return hasLast ? 'running-with-last' : 'running';
  }
}
