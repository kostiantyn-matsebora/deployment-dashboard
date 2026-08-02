import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { FeedService } from '../../core/services/feed.service';
import { AppStateService } from '../../core/services/app-state.service';
import { FeedRowComponent } from '../../shared/feed-row/feed-row.component';
import { FeedHeadRowComponent } from '../../shared/feed-row/feed-head-row.component';
import { FeedGroup, groupFeedEvents, visibleIdentitiesFromEvents } from '../../core/utils/feed-group.util';
import { DeploymentEvent } from '../../core/models/deployment.model';

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
  private readonly state = inject(AppStateService);

  protected readonly grouped = computed(() => this.feedService.grouped());
  protected readonly pageEvents = computed(() => this.feedService.pageEvents());
  protected readonly groupedRows = computed<FeedGroup[]>(() => groupFeedEvents(this.pageEvents()));
  protected readonly loadingInitial = computed(() => this.feedService.pageLoadingInitial());
  protected readonly loadingMore = computed(() => this.feedService.pageLoadingMore());
  protected readonly hasMore = computed(() => this.feedService.pageHasMore());
  protected readonly flashId = computed(() => this.feedService.pageFlashId());

  /** The scrollable log container — measured to auto-fill a tall viewport (issue #417). */
  private readonly feedLogEl = viewChild<ElementRef<HTMLElement>>('feedLog');

  /**
   * Distinct (service, namespace) identities across the currently loaded
   * page — the visible set for AppStateService.rowLabel's render-on-collision
   * rule (issue #353), computed over the Feed page's OWN load independently
   * of the dock's (#397 FIX).
   */
  private readonly visibleIdentities = computed(() => visibleIdentitiesFromEvents(this.pageEvents()));

  /** Service column label — namespace-prefixed only on a same-name collision in this page's visible set. */
  protected serviceLabel(ev: DeploymentEvent): string {
    return this.state.rowLabel(ev.service, ev.namespace, this.visibleIdentities());
  }

  /**
   * Header subtitle text (views.md §Feed page: `.feed-sub` reads
   * `"<N> events · <M> deployments — showing <shown>"`, extended with a
   * matching-count clause while a search is active — mirrors the mockup's
   * `feedUpdateCount()`). `shown` is the row count in the CURRENT grouped/flat
   * toggle (deployments when grouped, events when flat) — loaded and shown
   * coincide 1:1 here because search/pagination are server-side (unlike the
   * mockup's client-side windowing over a preloaded static array).
   */
  protected readonly countLabel = computed(() => {
    const total = this.pageEvents().length;
    const groups = this.groupedRows().length;
    const isGrouped = this.grouped();
    const shown = isGrouped ? groups : total;
    const q = this.feedService.pageQuery().trim();
    const base = `${total} event${total === 1 ? '' : 's'} · ${groups} deployment${groups === 1 ? '' : 's'}`;
    const matchedNote = q
      ? ` · ${shown} matching ${isGrouped ? 'deployment' : 'event'}${shown === 1 ? '' : 's'}`
      : '';
    return `${base}${matchedNote} — showing ${shown}`;
  });

  /** Local echo of the search input — committed to FeedService.search() after a debounce. */
  protected readonly searchText = signal('');
  /** Group ids currently expanded — local UI state, reset on remount. */
  protected readonly expandedIds = signal<Set<string>>(new Set());

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fill-until-overflow (issue #417): scroll-driven `loadMore()` can never
   * fire when the first page already fits the viewport without a scrollbar
   * (e.g. a tall monitor + grouped roll-ups, which roughly halve the row
   * count vs. flat) — `.feed-log` never receives a `scroll` event, so all
   * older history becomes permanently unreachable. `afterRenderEffect`'s
   * `read` phase runs after the DOM has actually been painted for the
   * `pageEvents()`/`grouped()` change that triggered it, so `scrollHeight`
   * reflects the CURRENT row count, not a stale pre-render value. Each
   * `loadMore()` call grows `pageEvents()` again, re-triggering this same
   * effect (since it's read inside), so the check naturally repeats until
   * the container overflows or `hasMore()` goes false — never a manual loop.
   */
  constructor() {
    afterRenderEffect({
      read: () => {
        this.pageEvents();
        this.grouped();
        this.maybeFillPage();
      },
    });
  }

  private maybeFillPage(): void {
    const el = this.feedLogEl()?.nativeElement;
    if (!el) return;
    if (this.loadingInitial() || this.loadingMore() || !this.hasMore()) return;
    if (el.scrollHeight <= el.clientHeight) {
      this.feedService.loadMore();
    }
  }

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
