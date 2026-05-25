// Hand-authored visual mirror of <dd-stage-box> from frontend/matrix/src/lib/.
// Detailed view only (used as the 'detailed' branch in layout-leaf).
// Static: all data via @Input(); no store; OnPush.
//
// Pass 2 chrome parity — box content mirrors SPA density:
//   Primary identity: 7-char commit hash (derived from slot.sha if present,
//     otherwise synthesized from deploymentId for visual fidelity)
//   Secondary: run number link (#N)
//   Then: age · actor · prev-failed badge · last-successful split

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

// 7-char short hash for display.
// Prefers slot.sha (first 7 chars); synthesizes a deterministic hex string
// from deploymentId digits when sha is absent.
function shortHash(slot: SlotState): string {
  if (slot.current.sha) {
    return slot.current.sha.slice(0, 7);
  }
  const id = slot.current.deploymentId;
  const digits = id.replace(/\D/g, '');
  if (digits) {
    return parseInt(digits, 10).toString(16).padStart(7, '0').slice(0, 7);
  }
  return id.slice(0, 7);
}

function shortHashFromSha(sha: string | null | undefined): string {
  if (!sha) return '';
  return sha.slice(0, 7);
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
      class="stage-box rounded-lg border-2 overflow-hidden relative"
      style="width: var(--leaf-width, 200px)"
      [ngClass]="boxBorderClass(slot)"
      [attr.data-testid]="'stage-box-' + service.id + '-' + env.id"
      [attr.data-state]="dataState()"
      [attr.data-view]="'detailed'"
    >
      @if (!slot) {
        <div class="h-16 flex items-center justify-center">
          <span class="text-gray-300 text-xl">—</span>
        </div>
      } @else {
        <div>
          <div class="p-2.5">

            <!-- Row 1: status badge + run link -->
            <div class="flex items-center justify-between mb-1.5">
              <span
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
                [class.bg-green-100]="slot.current.status === 'success'"
                [class.text-green-700]="slot.current.status === 'success'"
                [class.bg-red-100]="slot.current.status === 'failure'"
                [class.text-red-700]="slot.current.status === 'failure'"
                [class.bg-orange-100]="slot.current.status === 'in-progress'"
                [class.text-orange-700]="slot.current.status === 'in-progress'"
              >
                @if (slot.current.status === 'in-progress') {
                  <span class="spinner" data-testid="spinner"></span>
                  <span>running…</span>
                } @else if (slot.current.status === 'success') {
                  <span>✓</span><span>success</span>
                } @else {
                  <span>✗</span><span>failed</span>
                }
              </span>
              <a
                href="#"
                (click)="$event.preventDefault()"
                class="text-xs text-blue-500 hover:underline font-mono ml-auto"
                [attr.data-testid]="'run-link-current-' + service.id + '-' + env.id"
              >#{{ slot.current.runNumber }}</a>
            </div>

            <!-- Row 2: commit hash (primary identity) -->
            <p
              class="text-sm font-bold text-gray-900 font-mono leading-tight break-all"
              [attr.data-testid]="'current-version-' + service.id + '-' + env.id"
              [title]="slot.current.sha ?? slot.current.deploymentId"
            >{{ shortHash(slot) }}</p>

            <!-- Row 3: age -->
            <p
              class="text-xs text-gray-400 mt-1 leading-tight truncate"
              [attr.data-testid]="'current-ago-' + service.id + '-' + env.id"
            >{{ relativeTime(slot.current.deployedAt) }}</p>

            <!-- Row 4: actor -->
            <p
              class="text-xs text-gray-400 truncate leading-tight"
              [attr.data-testid]="'current-actor-' + service.id + '-' + env.id"
              [title]="slot.current.actor"
            >{{ slot.current.actor }}</p>

            <!-- Prev-failed badge -->
            @if (slot.current.status === 'in-progress' && slot.previousFailed) {
              <div
                class="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                data-testid="prev-failed-badge"
              >⚠ prev. failed</div>
            }

          </div>

          <!-- Last-successful split -->
          @if (slot.lastSuccessful) {
            <div
              class="border-t border-dashed border-gray-200 px-2.5 py-2 bg-white"
              data-testid="last-successful-section"
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-green-600 text-xs font-bold leading-none shrink-0">✓</span>
                <span
                  class="text-xs font-mono font-semibold text-gray-600 truncate min-w-0"
                  [attr.data-testid]="'last-successful-version-' + service.id + '-' + env.id"
                  [title]="slot.lastSuccessful.sha ?? slot.lastSuccessful.version"
                >{{ shortHashFromSha(slot.lastSuccessful.sha) || truncate(slot.lastSuccessful.version, 12) }}</span>
              </div>
              <p class="text-xs text-gray-400 mt-0.5 leading-tight truncate">
                {{ relativeTime(slot.lastSuccessful.deployedAt) }}
              </p>
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
  readonly shortHash = shortHash;
  readonly shortHashFromSha = shortHashFromSha;

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
