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

  /**
   * Optional next deployment event from slot.next (when the inspector is
   * used from the Matrix context and the slot carries a next badge).
   * When provided, shows a dotted separator + next-status/version/run_url.
   */
  readonly nextEvent = input<DeploymentEvent | null>(null);

  // ── Derived ─────────────────────────────────────────────────

  protected readonly statusClass = computed<string>(() => {
    return this.statusClassFor(this.event()?.status);
  });

  protected readonly statusLabel = computed<string>(() => {
    return this.statusLabelFor(this.event()?.status);
  });

  /** Status CSS class for any status string (current or next). */
  protected statusClassFor(status: string | undefined): string {
    if (status === 'success')     return 'chip-success';
    if (status === 'in-progress') return 'chip-progress';
    if (status === 'failure')     return 'chip-failure';
    if (status === 'pending')     return 'chip-pending';
    if (status === 'queued')      return 'chip-queued';
    if (status === 'waiting')     return 'chip-waiting';
    if (status === 'cancelled')   return 'chip-cancelled';
    if (status === 'rejected')    return 'chip-rejected';
    return 'chip-failure';
  }

  /** Human-readable label for any status string. */
  protected statusLabelFor(status: string | undefined): string {
    switch (status) {
      case 'success':     return 'success';
      case 'in-progress': return 'in-progress';
      case 'failure':     return 'failure';
      case 'pending':     return 'pending';
      case 'queued':      return 'queued';
      case 'waiting':     return 'waiting';
      case 'cancelled':   return 'cancelled';
      case 'rejected':    return 'rejected';
      default:            return status ?? '—';
    }
  }

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
