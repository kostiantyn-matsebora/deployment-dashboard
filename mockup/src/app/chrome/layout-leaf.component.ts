// Hand-authored visual mirror of <dd-layout-leaf> from frontend/matrix/src/lib/.
// Renders the detailed view leaf inside swim-lane / workflow-rows layouts.
// Static: all data via @Input(); no store; OnPush.
// Mockup simplification: only 'detailed' and 'compact' views are rendered
// (no glance pill, no focus variant — the mockup uses detailed as the default).

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StageBoxComponent } from './stage-box.component';
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

@Component({
  selector: 'dd-mockup-layout-leaf',
  standalone: true,
  imports: [CommonModule, StageBoxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Detailed view — delegates to stage-box. -->
    <dd-mockup-stage-box
      [service]="service"
      [env]="env"
      [slot]="slot"
    ></dd-mockup-stage-box>
  `
})
export class LayoutLeafComponent {
  @Input({ required: true }) service!: ServiceDescriptor;
  @Input({ required: true }) env!: EnvironmentDescriptor;
  @Input({ required: true }) slot!: SlotState | null;

  readonly relativeTime = relativeTime;
  readonly truncate = truncate;
}
