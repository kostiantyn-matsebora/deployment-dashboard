import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { DeploymentEvent } from '../../core/models/deployment.model';
import { TimeAgoPipe } from '../pipes/time-ago.pipe';

/**
 * flat  — a single ungrouped event (grouping OFF).
 * group — a group roll-up row (latest event of a deployment_id; chevron + ×N badge).
 * child — one event inside an expanded group's detail list.
 */
export type FeedRowVariant = 'flat' | 'group' | 'child';

/**
 * FeedRowComponent — one row of the shared 14-slot feed grid.
 *
 * Reused verbatim by the Feed page (sticky header pairs with FeedHeadRowComponent),
 * the bottom dock, group roll-up rows, and expanded child rows — a single
 * definition so the page and dock can never drift out of column alignment
 * (LOCKED — issue #397).
 *
 * Column order: expander · pip · time · service · environment · status chip ·
 * version · ref · sha · run# · actor · deployment_id · ×N badge · run link.
 * Every wire attribute is shown except `id` and `parent_deployments` (LOCKED).
 *
 * Spec: docs/design/mockup/index.html §feedRenderRow / §feedRenderGroupRow (FEED, #397)
 */
@Component({
  selector: 'app-feed-row',
  standalone: true,
  imports: [TimeAgoPipe],
  templateUrl: './feed-row.component.html',
  styleUrl: './feed-row.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedRowComponent {
  readonly event = input.required<DeploymentEvent>();
  readonly variant = input<FeedRowVariant>('flat');
  /**
   * Pre-computed display label for the service column — the caller applies
   * AppStateService.rowLabel's render-on-collision rule (issue #353) over
   * its own visible set (the Feed page and the dock each compute over their
   * own loaded set) before passing it down; this component never sees the
   * full set, so it cannot compute the rule itself. Falls back to the bare
   * `event().service` when omitted (e.g. in isolated tests).
   */
  readonly serviceLabel = input<string>();
  /** Total events in the group — the ×N badge shows only when > 1 (group variant only). */
  readonly count = input<number>(0);
  readonly expanded = input<boolean>(false);
  /** True for one CD cycle right after a live ingest — triggers the flash animation. */
  readonly flash = input<boolean>(false);

  /** Emitted on click for group rows (expand/collapse); ignored for flat/child rows. */
  readonly toggle = output<void>();

  protected readonly isGroup = computed(() => this.variant() === 'group');

  protected statusClass(status: string): string {
    return status === 'in-progress' ? 's-progress' : `s-${status}`;
  }

  protected onRowClick(evt: MouseEvent): void {
    if (!this.isGroup()) return;
    // Let the run link navigate instead of toggling the group.
    if ((evt.target as HTMLElement).closest('.hist-link')) return;
    this.toggle.emit();
  }
}
