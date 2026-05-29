import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { DeploymentEvent } from '../../../core/models/deployment.model';
import { TimeAgoPipe, absoluteUtc } from '../../../shared/pipes/time-ago.pipe';

/**
 * InspectorPanelComponent — persistent 320px right sidebar in the Swimlanes view.
 *
 * Displays ALL 11 domain-model fields for the selected node as explicit label/value
 * rows, regardless of attribute-picker state (spec: FR §Details surfaces).
 *
 * `happened_at` renders as elapsed + absolute UTC.
 * `parent_deployments` renders as truncated GUID chips.
 * Empty state shown when no node is selected.
 *
 * Spec: docs/design/components.md §Inspector Panel
 */
@Component({
  selector: 'app-inspector-panel',
  standalone: true,
  imports: [TimeAgoPipe],
  templateUrl: './inspector-panel.component.html',
  styleUrl: './inspector-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorPanelComponent {
  /** Selected deployment event — null when nothing is selected. */
  readonly event = input<DeploymentEvent | null>(null);

  // ── Derived ─────────────────────────────────────────────────

  protected readonly statusClass = computed<string>(() => {
    const s = this.event()?.status;
    if (s === 'success')     return 'chip-success';
    if (s === 'in-progress') return 'chip-progress';
    return 'chip-failure';
  });

  protected readonly statusLabel = computed<string>(() => {
    const s = this.event()?.status;
    if (s === 'success')     return 'success';
    if (s === 'in-progress') return 'in-progress';
    return 'failure';
  });

  // ── Helpers ──────────────────────────────────────────────────

  protected absoluteUtc(v: string | undefined): string {
    return absoluteUtc(v);
  }

  /**
   * Truncates a GUID to first-8 chars for display: "gh-pay-dev-4821" → "gh-pay-d".
   * UUIDs: "7f3d2a1b-..." → "7f3d2a1b".
   */
  protected truncGuid(id: string): string {
    return id.length > 12 ? id.slice(0, 12) + '…' : id;
  }
}
