// SVG-native Compact deployment node — 5 fields per Display modal spec:
// status badge + version + run number + elapsed time + actor (+ env label as a deployment attribute).
// Always-on: status colour (stroke), prev-failed badge row, last-successful split row.
// Theme: SVG fills/strokes reference var(--dep-*) tokens from styles.css; pure CSS theming.

import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { SlotState } from '../fixtures/index';

// Static dimensions — match SPA Compact reference (~140×90).
export const COMPACT_NODE_WIDTH = 140;
export const COMPACT_NODE_HEIGHT = 90;

@Component({
  selector: '[ddDepCompact]',
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
    @if (slot) {
      <!-- Row 1: [ENV] · status · time     |   version/sha -->
      <svg:text x="6" y="14" font-family="sans-serif" font-size="8" font-weight="700" fill="var(--dep-text-env)" letter-spacing="0.4">
        [{{ envLabel }}]
      </svg:text>
      <svg:circle cx="44" cy="11" r="3" [attr.fill]="statusColor()" />
      <svg:text x="50" y="14" font-family="sans-serif" font-size="9" fill="var(--dep-text-secondary)">
        {{ ago(slot.current.deployedAt) }}
      </svg:text>
      <svg:text [attr.x]="width - 6" y="14" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="var(--dep-text-primary)" text-anchor="end">
        {{ slot.current.version }}
      </svg:text>
      <!-- Row 2: actor (truncated) | #run -->
      <svg:text x="6" y="30" font-family="sans-serif" font-size="9" fill="var(--dep-text-muted)">
        {{ truncate(slot.current.actor, 16) }}
      </svg:text>
      <svg:a [attr.href]="slot.current.runUrl" target="_blank" rel="noopener">
        <svg:text [attr.x]="width - 6" y="30"
                  font-family="sans-serif" font-size="9" font-weight="600"
                  fill="var(--dep-text-link)" style="cursor: pointer; text-decoration: underline" text-anchor="end">
          #{{ slot.current.runNumber }}
        </svg:text>
      </svg:a>
      <!-- Optional: prev-failed badge -->
      @if (slot.previousFailed) {
        <svg:rect x="6" y="40" width="68" height="12" rx="2" fill="var(--dep-badge-fill)" stroke="var(--dep-badge-stroke)" stroke-width="1" />
        <svg:text x="11" y="49" font-family="sans-serif" font-size="8" font-weight="500" fill="var(--dep-badge-text)">⚠ prev failed</svg:text>
      }
      <!-- Optional: dashed line + last-successful row -->
      @if (slot.lastSuccessful) {
        <svg:line x1="6" y1="60" [attr.x2]="width - 6" y2="60" stroke="var(--dep-divider)" stroke-width="1" stroke-dasharray="2 2" />
        <svg:text x="6" y="74" font-family="sans-serif" font-size="9" fill="var(--dep-status-success-fg)">✓ {{ slot.lastSuccessful.version }}</svg:text>
        <svg:text [attr.x]="width - 6" y="74" font-family="sans-serif" font-size="9" fill="var(--dep-text-muted)" text-anchor="end">{{ ago(slot.lastSuccessful.deployedAt) }}</svg:text>
      }
    } @else {
      <svg:text [attr.x]="width / 2" [attr.y]="height / 2" font-family="sans-serif" font-size="14" fill="var(--dep-stroke-empty)" text-anchor="middle" dominant-baseline="central">—</svg:text>
    }
  `
})
export class DeploymentCompactComponent {
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

  truncate(s: string, max: number): string {
    if (!s) return '';
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
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
