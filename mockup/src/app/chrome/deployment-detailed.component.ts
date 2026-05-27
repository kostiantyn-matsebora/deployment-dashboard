// SVG-native Detailed deployment node — all 7 fields per Display modal spec:
// status badge + version + run number + elapsed time + actor + source ref + commit SHA.
// Plus env label (deployment attribute, shown top-left).
// Always-on: status colour (stroke), prev-failed badge row, last-successful split row.
// Theme: SVG fills/strokes reference var(--dep-*) tokens from styles.css; pure CSS theming.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { SlotState } from '../fixtures/index';

// Static dimensions — single source of truth for the Detailed deployment node.
export const DETAILED_NODE_WIDTH = 180;
export const DETAILED_NODE_HEIGHT = 150;

@Component({
  selector: '[ddDepDetailed]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg:rect
      [attr.width]="width"
      [attr.height]="height"
      fill="var(--dep-box-fill)"
      [attr.stroke]="boxStroke()"
      stroke-width="1.5"
      rx="6"
    />
    <svg:text x="10" y="20" font-family="sans-serif" font-size="10" font-weight="700" fill="var(--dep-text-env)" letter-spacing="0.5">
      [{{ envLabel }}]
    </svg:text>
    <svg:circle cx="68" cy="16" r="5" [attr.fill]="statusColor()" />
    @if (slot) {
      <!-- Row 1: env label + status badge text + #run -->
      <svg:text x="80" y="20" font-family="sans-serif" font-size="10" font-weight="600" [attr.fill]="statusColor()">
        {{ statusLabel() }}
      </svg:text>
      <svg:a [attr.href]="slot.current.runUrl" target="_blank" rel="noopener">
        <svg:text [attr.x]="width - 8" y="20"
                  font-family="sans-serif" font-size="11" font-weight="600"
                  fill="var(--dep-text-link)" style="cursor: pointer; text-decoration: underline" text-anchor="end">
          #{{ slot.current.runNumber }}
        </svg:text>
      </svg:a>
      <!-- Row 2: version (bold) -->
      <svg:text x="10" y="40" font-family="ui-monospace, monospace" font-size="11" font-weight="600" fill="var(--dep-text-primary)">
        {{ slot.current.version }}
      </svg:text>
      <!-- Row 3: elapsed time -->
      <svg:text x="10" y="56" font-family="sans-serif" font-size="10" fill="var(--dep-text-muted)">
        {{ ago(slot.current.deployedAt) }}
      </svg:text>
      <!-- Row 4: actor -->
      <svg:text x="10" y="72" font-family="sans-serif" font-size="10" fill="var(--dep-text-muted)">
        {{ slot.current.actor }}
      </svg:text>
      <!-- Row 5: source ref (nullable) -->
      @if (slot.current.ref) {
        <svg:text x="10" y="88" font-family="ui-monospace, monospace" font-size="10" fill="var(--dep-text-env)">
          {{ slot.current.ref }}
        </svg:text>
      }
      <!-- Row 6: commit SHA (nullable, truncated) -->
      @if (slot.current.sha) {
        <svg:text x="10" y="104" font-family="ui-monospace, monospace" font-size="10" fill="var(--dep-text-env)">
          {{ slot.current.sha.slice(0, 7) }}…
        </svg:text>
      }
      <!-- Always-on: prev-failed badge -->
      @if (slot.previousFailed) {
        <svg:rect x="8" y="110" width="76" height="14" rx="3" fill="var(--dep-badge-fill)" stroke="var(--dep-badge-stroke)" stroke-width="1" />
        <svg:text x="14" y="121" font-family="sans-serif" font-size="9" font-weight="500" fill="var(--dep-badge-text)">⚠ prev failed</svg:text>
      }
      <!-- Always-on: last-successful split -->
      @if (slot.lastSuccessful) {
        <svg:line x1="8" y1="128" [attr.x2]="width - 8" y2="128" stroke="var(--dep-divider)" stroke-width="1" stroke-dasharray="2 2" />
        <svg:text x="10" y="139" font-family="sans-serif" font-size="9" fill="var(--dep-status-success-fg)">✓ {{ slot.lastSuccessful.version }}</svg:text>
        <svg:text [attr.x]="width - 8" y="139" font-family="sans-serif" font-size="9" fill="var(--dep-text-muted)" text-anchor="end">{{ ago(slot.lastSuccessful.deployedAt) }}</svg:text>
      }
    } @else {
      <svg:text [attr.x]="width / 2" [attr.y]="height / 2" font-family="sans-serif" font-size="14" fill="var(--dep-stroke-empty)" text-anchor="middle" dominant-baseline="central">—</svg:text>
    }
  `
})
export class DeploymentDetailedComponent {
  @Input({ required: true }) slot!: SlotState | null;
  @Input({ required: true }) width!: number;
  @Input({ required: true }) height!: number;
  @Input({ required: true }) envLabel!: string;

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

  statusLabel(): string {
    if (!this.slot) return '';
    if (this.slot.current.status === 'success') return 'success';
    if (this.slot.current.status === 'failure') return 'failed';
    return 'running…';
  }

  ago(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diffMs / 86400000);
    if (days > 0) return `${days}d ago`;
    const hrs = Math.floor(diffMs / 3600000);
    if (hrs > 0) return `${hrs}h ago`;
    const mins = Math.floor(diffMs / 60000);
    return mins > 0 ? `${mins}m ago` : 'just now';
  }
}
