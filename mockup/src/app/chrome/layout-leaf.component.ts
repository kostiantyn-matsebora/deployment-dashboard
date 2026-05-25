// Hand-authored visual mirror of <dd-layout-leaf> from frontend/matrix/src/lib/.
// Renders the correct density leaf based on viewMode input.
// Static: all data via @Input(); no store; OnPush.
//
// viewMode='detailed' — delegates to <dd-mockup-stage-box> (full 5-row density).
// viewMode='compact'  — inline compact box: status icon + hash + run#; age; actor (3 rows).
// viewMode='focus'    — same as compact (Focus treated as Compact density in mockup).
// viewMode='glance'   — NOT rendered here; Glance is a per-service pill strip
//                       rendered entirely at the layout level; layout components
//                       skip <dd-mockup-layout-leaf> in Glance mode.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StageBoxComponent } from './stage-box.component';
import type { SlotState, ServiceDescriptor, EnvironmentDescriptor } from '../fixtures/index';
import type { ViewMode } from '../view-mode.service';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortHash(slot: SlotState): string {
  if (slot.current.sha) return slot.current.sha.slice(0, 7);
  const id = slot.current.deploymentId;
  const digits = id.replace(/\D/g, '');
  if (digits) return parseInt(digits, 10).toString(16).padStart(7, '0').slice(0, 7);
  return id.slice(0, 7);
}

function shortHashFromSha(sha: string | null | undefined): string {
  if (!sha) return '';
  return sha.slice(0, 7);
}

function boxBorderClass(slot: SlotState | null): string {
  if (!slot) return 'border-gray-200 bg-white';
  const st = slot.current.status;
  if (st === 'success')     return 'border-green-300 bg-white';
  if (st === 'failure')     return 'border-red-300 bg-white';
  return 'border-orange-400 bg-white in-progress-box';
}

@Component({
  selector: 'dd-mockup-layout-leaf',
  standalone: true,
  imports: [CommonModule, StageBoxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (viewMode === 'compact' || viewMode === 'focus') {
      <!-- Compact / Focus: condensed 3-row box mirroring SPA compact density.
           Row 1: status icon + 7-char commit hash + run# (right-aligned).
           Row 2: age.
           Row 3: actor.
           Last-successful split retained below the fold (dashed separator). -->
      <div
        class="compact-box rounded border-2 overflow-hidden"
        style="width: var(--leaf-width, 160px)"
        [ngClass]="boxBorderClass(slot)"
        [attr.data-testid]="'stage-box-' + service.id + '-' + env.id"
        [attr.data-view]="viewMode"
        [attr.data-state]="slot ? slot.current.status : 'empty'"
      >
        @if (!slot) {
          <div class="h-10 flex items-center justify-center">
            <span class="text-gray-300 text-xl">—</span>
          </div>
        } @else {
          <div class="p-2">
            <!-- Row 1: status icon + hash + run# -->
            <div class="flex items-center gap-1.5 min-w-0">
              @if (slot.current.status === 'in-progress') {
                <span class="spinner shrink-0" data-testid="spinner"></span>
              } @else if (slot.current.status === 'success') {
                <span class="text-green-500 text-xs leading-none shrink-0">✓</span>
              } @else {
                <span class="text-red-500 text-xs leading-none shrink-0">✗</span>
              }
              <span
                class="text-xs font-mono font-bold text-gray-900 truncate flex-1 min-w-0"
                [attr.data-testid]="'current-version-' + service.id + '-' + env.id"
              >{{ shortHash(slot) }}</span>
              <a
                href="#"
                (click)="$event.preventDefault()"
                class="text-[10px] text-blue-500 font-mono shrink-0"
                [attr.data-testid]="'run-link-current-' + service.id + '-' + env.id"
              >#{{ slot.current.runNumber }}</a>
            </div>
            <!-- Row 2: age -->
            <p class="text-[10px] text-gray-400 mt-0.5 leading-tight truncate"
               [attr.data-testid]="'current-ago-' + service.id + '-' + env.id"
            >{{ relativeTime(slot.current.deployedAt) }}</p>
            <!-- Row 3: actor -->
            <p class="text-[10px] text-gray-400 truncate leading-tight"
               [attr.data-testid]="'current-actor-' + service.id + '-' + env.id"
            >{{ slot.current.actor }}</p>
          </div>
          @if (slot.lastSuccessful) {
            <div
              class="border-t border-dashed border-gray-200 px-2 py-1"
              data-testid="last-successful-section"
            >
              <div class="flex items-center gap-1 min-w-0">
                <span class="text-green-600 text-xs leading-none shrink-0">✓</span>
                <span
                  class="text-[10px] font-mono text-gray-500 truncate"
                  [attr.data-testid]="'last-successful-version-' + service.id + '-' + env.id"
                >{{ shortHashFromSha(slot.lastSuccessful.sha) || slot.lastSuccessful.version.slice(0,7) }}</span>
              </div>
              <p class="text-[10px] text-gray-400 leading-tight truncate">
                {{ relativeTime(slot.lastSuccessful.deployedAt) }}
              </p>
            </div>
          }
        }
      </div>
    } @else {
      <!-- Detailed view — delegates to stage-box (full 5-row density). -->
      <dd-mockup-stage-box
        [service]="service"
        [env]="env"
        [slot]="slot"
      ></dd-mockup-stage-box>
    }
  `
})
export class LayoutLeafComponent {
  @Input({ required: true }) service!: ServiceDescriptor;
  @Input({ required: true }) env!: EnvironmentDescriptor;
  @Input({ required: true }) slot!: SlotState | null;
  @Input() viewMode: ViewMode = 'detailed';

  readonly relativeTime = relativeTime;
  readonly shortHash = shortHash;
  readonly shortHashFromSha = shortHashFromSha;
  readonly boxBorderClass = boxBorderClass;
}
