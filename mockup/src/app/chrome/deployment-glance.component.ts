// SVG-native Glance deployment node — 1 attribute per Display modal spec.
// Default: version. Pill shape: [ENV] ● version (status colour on border).
// Always-on: status colour, prev-failed marker (small triangle), no last-successful split (pill too small).
// Theme: SVG fills/strokes reference var(--dep-*) tokens from styles.css; pure CSS theming.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { SlotState } from '../fixtures/index';

export const GLANCE_NODE_WIDTH = 150;
export const GLANCE_NODE_HEIGHT = 24;

@Component({
  selector: '[ddDepGlance]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg:rect
      [attr.width]="width"
      [attr.height]="height"
      [attr.stroke]="boxStroke()"
      fill="var(--dep-box-fill)"
      stroke-width="1.5"
      rx="4"
    />
    <!-- ENV label (left, small caps) -->
    <svg:text x="6" y="16" font-family="sans-serif" font-size="9" font-weight="700" fill="var(--dep-text-env)" letter-spacing="0.5">
      {{ envLabel }}
    </svg:text>
    @if (slot) {
      <!-- Status dot — pushed right of widest ENV label ("QAHOTFIX" = ~52px) -->
      <svg:circle cx="64" cy="12" r="3" [attr.fill]="statusColor()" />
      <!-- Version (default 1/7 attribute) -->
      <svg:text x="72" y="16" font-family="ui-monospace, monospace" font-size="10" fill="var(--dep-text-primary)">
        {{ slot.current.version }}
      </svg:text>
      @if (slot.previousFailed) {
        <svg:text [attr.x]="width - 6" y="16" font-family="sans-serif" font-size="9" fill="var(--dep-badge-text)" text-anchor="end">⚠</svg:text>
      }
    } @else {
      <svg:text x="72" y="16" font-family="sans-serif" font-size="9" fill="var(--dep-stroke-empty)">— —</svg:text>
    }
  `
})
export class DeploymentGlanceComponent {
  @Input({ required: true }) slot!: SlotState | null;
  @Input({ required: true }) envLabel!: string;
  @Input({ required: true }) width!: number;
  @Input({ required: true }) height!: number;

  statusColor(): string {
    if (!this.slot) return 'var(--dep-stroke-empty)';
    if (this.slot.current.status === 'success') return 'var(--dep-status-success)';
    if (this.slot.current.status === 'failure') return 'var(--dep-status-failure)';
    return 'var(--dep-status-progress)';
  }

  boxStroke(): string {
    if (!this.slot) return 'var(--dep-stroke-empty)';
    if (this.slot.current.status === 'success') return 'var(--dep-stroke-success)';
    if (this.slot.current.status === 'failure') return 'var(--dep-stroke-failure)';
    return 'var(--dep-stroke-progress)';
  }
}
