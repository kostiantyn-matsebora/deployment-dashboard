import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

import { FeedService } from '../../core/services/feed.service';
import { FeedRowComponent } from '../../shared/feed-row/feed-row.component';
import { FeedHeadRowComponent } from '../../shared/feed-row/feed-head-row.component';
import { FeedGroup, groupFeedEvents } from '../../core/utils/feed-group.util';

/**
 * FeedComponent — the 4th route-driven view: chronological deployment log
 * with grouping, infinite scroll, and server-side search.
 *
 * Pure presentation over FeedService (page-side state) — mirrors
 * MatrixComponent/SwimlanesComponent reading AppStateService. Grouping and
 * live-flash state are shared with FeedDockComponent via the same service
 * (LOCKED — issue #397).
 *
 * Spec: docs/design/mockup/index.html §view-feed / §renderFeedPage (#397)
 */
@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [FeedRowComponent, FeedHeadRowComponent],
  templateUrl: './feed.component.html',
  styleUrl: './feed.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedComponent implements OnInit, OnDestroy {
  protected readonly feedService = inject(FeedService);

  protected readonly grouped = computed(() => this.feedService.grouped());
  protected readonly pageEvents = computed(() => this.feedService.pageEvents());
  protected readonly groupedRows = computed<FeedGroup[]>(() => groupFeedEvents(this.pageEvents()));
  protected readonly loadingInitial = computed(() => this.feedService.pageLoadingInitial());
  protected readonly loadingMore = computed(() => this.feedService.pageLoadingMore());
  protected readonly hasMore = computed(() => this.feedService.pageHasMore());
  protected readonly flashId = computed(() => this.feedService.pageFlashId());

  protected readonly countLabel = computed(() => {
    const total = this.pageEvents().length;
    const groups = this.groupedRows().length;
    const q = this.feedService.pageQuery().trim();
    const base = `${total} event${total === 1 ? '' : 's'} loaded · ${groups} deployment${groups === 1 ? '' : 's'}`;
    return q ? `${base} matching "${q}"` : base;
  });

  /** Local echo of the search input — committed to FeedService.search() after a debounce. */
  protected readonly searchText = signal('');
  /** Group ids currently expanded — local UI state, reset on remount. */
  protected readonly expandedIds = signal<Set<string>>(new Set());

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.searchText.set(this.feedService.pageQuery());
    this.feedService.activatePage();
    this.feedService.ensureLoaded();
  }

  ngOnDestroy(): void {
    this.feedService.deactivatePage();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Debounced — empty q clears back to the unfiltered listing. */
  protected onSearchInput(value: string): void {
    this.searchText.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.feedService.search(value), 300);
  }

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

  /** Infinite scroll — fetch the next cursor page when nearing the bottom. */
  protected onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) this.feedService.loadMore();
  }
}
