import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { FeedService, isDockVisible } from '../../core/services/feed.service';
import { AppStateService } from '../../core/services/app-state.service';
import { FeedRowComponent } from '../feed-row/feed-row.component';
import { FeedGroup, groupFeedEvents, visibleIdentitiesFromEvents } from '../../core/utils/feed-group.util';
import { DeploymentEvent } from '../../core/models/deployment.model';

/**
 * FeedDockComponent — fixed glass panel showing the newest 8 deployment
 * events live, toggleable from the topbar, visible on every view except
 * Feed itself (the page IS the full log there — LOCKED, #397).
 *
 * Grouping is the SAME shared FeedService.grouped signal the Feed page uses;
 * toggling it here or on the page updates both.
 *
 * Spec: docs/design/mockup/index.html §feed-dock / renderFeedDockBody (#397)
 */
@Component({
  selector: 'app-feed-dock',
  standalone: true,
  imports: [FeedRowComponent],
  templateUrl: './feed-dock.component.html',
  styleUrl: './feed-dock.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedDockComponent {
  private readonly feedService = inject(FeedService);
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly grouped = computed(() => this.feedService.grouped());
  protected readonly flashId = computed(() => this.feedService.dockFlashId());
  protected readonly dockVisible = computed(() =>
    isDockVisible(this.feedService.dockOpenPref(), this.state.activeView()),
  );

  protected readonly dockGroups = computed<FeedGroup[]>(() =>
    groupFeedEvents(this.feedService.dockEvents()).slice(0, 8),
  );
  protected readonly dockFlat = computed(() => this.feedService.dockEvents().slice(0, 8));

  /**
   * Distinct (service, namespace) identities across the dock's own loaded
   * buffer — the visible set for AppStateService.rowLabel's
   * render-on-collision rule (issue #353), computed independently of the
   * Feed page's own set (#397 FIX).
   */
  private readonly visibleIdentities = computed(() => visibleIdentitiesFromEvents(this.feedService.dockEvents()));

  /** Service column label — namespace-prefixed only on a same-name collision in the dock's visible set. */
  protected serviceLabel(ev: DeploymentEvent): string {
    return this.state.rowLabel(ev.service, ev.namespace, this.visibleIdentities());
  }

  /** Group ids currently expanded — local UI state. */
  protected readonly expandedIds = signal<Set<string>>(new Set());

  protected toggleGrouped(): void {
    this.feedService.setGrouped(!this.feedService.grouped());
  }

  protected isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  protected toggleExpanded(id: string): void {
    const next = new Set(this.expandedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedIds.set(next);
  }

  protected close(): void {
    this.feedService.setDockOpen(false);
  }

  protected openFeed(): void {
    void this.router.navigate(['/feed']);
  }
}
