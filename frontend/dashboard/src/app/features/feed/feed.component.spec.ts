/**
 * FeedComponent — unit tests.
 *
 * Strategy: provide a fake FeedService with writable signals + spy methods
 * (same pattern as topbar.component.spec.ts's mock AppStateService) — no
 * real HTTP/EventSource involved.
 *
 * Covers:
 *   - ngOnInit: activatePage() + ensureLoaded() called once
 *   - ngOnDestroy: deactivatePage() called
 *   - grouped rendering: one app-feed-row per group (variant group)
 *   - flat rendering: one app-feed-row per event (variant flat)
 *   - search debounce: onSearchInput commits to feedService.search() after the delay, not before
 *   - toggleGrouped(): flips FeedService.grouped via setGrouped
 *   - expand/collapse: toggleExpanded flips local expandedIds
 *   - infinite scroll: onScroll calls loadMore() only near the bottom
 *   - countLabel(): reflects loaded totals and the active query
 *   - service label render-on-collision (issue #353, #397 FIX): namespace
 *     prefix appears only when the same service name collides across
 *     namespaces within THIS page's own loaded set
 */
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FeedComponent } from './feed.component';
import { FeedService } from '../../core/services/feed.service';
import { DeploymentEvent } from '../../core/models/deployment.model';

function ev(overrides: Partial<DeploymentEvent> & { id: string; deployment_id: string }): DeploymentEvent {
  return {
    service:     'payments-api',
    environment: 'prod',
    status:      'success',
    happened_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('FeedComponent', () => {
  let pageEvents: ReturnType<typeof signal<DeploymentEvent[]>>;
  let grouped: ReturnType<typeof signal<boolean>>;
  let pageQuery: ReturnType<typeof signal<string>>;
  let fakeFeed: {
    grouped: typeof grouped;
    pageEvents: typeof pageEvents;
    pageQuery: typeof pageQuery;
    pageLoadingInitial: ReturnType<typeof signal<boolean>>;
    pageLoadingMore: ReturnType<typeof signal<boolean>>;
    pageHasMore: ReturnType<typeof signal<boolean>>;
    pageFlashId: ReturnType<typeof signal<string | null>>;
    activatePage: ReturnType<typeof vi.fn>;
    deactivatePage: ReturnType<typeof vi.fn>;
    ensureLoaded: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    setGrouped: ReturnType<typeof vi.fn>;
    loadMore: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    pageEvents = signal<DeploymentEvent[]>([]);
    grouped = signal(true);
    pageQuery = signal('');

    fakeFeed = {
      grouped,
      pageEvents,
      pageQuery,
      pageLoadingInitial: signal(false),
      pageLoadingMore: signal(false),
      pageHasMore: signal(false),
      pageFlashId: signal(null),
      activatePage: vi.fn(),
      deactivatePage: vi.fn(),
      ensureLoaded: vi.fn(),
      search: vi.fn(),
      setGrouped: vi.fn((v: boolean) => grouped.set(v)),
      loadMore: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [FeedComponent],
      providers: [{ provide: FeedService, useValue: fakeFeed }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function create() {
    const fixture = TestBed.createComponent(FeedComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('calls activatePage() and ensureLoaded() on init', () => {
    create();
    expect(fakeFeed.activatePage).toHaveBeenCalledTimes(1);
    expect(fakeFeed.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it('calls deactivatePage() on destroy', () => {
    const fixture = create();
    fixture.destroy();
    expect(fakeFeed.deactivatePage).toHaveBeenCalledTimes(1);
  });

  it('renders one row per deployment_id when grouped (roll-up, not per-event)', () => {
    pageEvents.set([
      ev({ id: 'a1', deployment_id: 'dep-a' }),
      ev({ id: 'a2', deployment_id: 'dep-a' }),
      ev({ id: 'b1', deployment_id: 'dep-b' }),
    ]);
    grouped.set(true);
    const fixture = create();
    const rows = fixture.debugElement.queryAll(By.css('app-feed-row'));
    expect(rows.length).toBe(2);
  });

  it('expanding a group renders its child rows in addition to the roll-up row', () => {
    pageEvents.set([
      ev({ id: 'a1', deployment_id: 'dep-a' }),
      ev({ id: 'a2', deployment_id: 'dep-a' }),
    ]);
    grouped.set(true);
    const fixture = create();
    fixture.componentInstance['toggleExpanded']('dep-a');
    fixture.detectChanges();
    const rows = fixture.debugElement.queryAll(By.css('app-feed-row'));
    // 1 roll-up row + 2 child rows
    expect(rows.length).toBe(3);
  });

  it('renders one flat row per event when not grouped', () => {
    pageEvents.set([
      ev({ id: 'a1', deployment_id: 'dep-a' }),
      ev({ id: 'a2', deployment_id: 'dep-a' }),
      ev({ id: 'b1', deployment_id: 'dep-b' }),
    ]);
    grouped.set(false);
    const fixture = create();
    const rows = fixture.debugElement.queryAll(By.css('app-feed-row'));
    expect(rows.length).toBe(3);
  });

  it('debounces search input — search() is not called before the delay', () => {
    const fixture = create();
    const input = fixture.debugElement.query(By.css('.feed-search')).nativeElement as HTMLInputElement;
    input.value = 'auth';
    input.dispatchEvent(new Event('input'));
    expect(fakeFeed.search).not.toHaveBeenCalled();
  });

  it('debounces search input — commits after the delay', () => {
    const fixture = create();
    const input = fixture.debugElement.query(By.css('.feed-search')).nativeElement as HTMLInputElement;
    input.value = 'auth';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    expect(fakeFeed.search).toHaveBeenCalledWith('auth');
  });

  it('toggleGrouped() flips FeedService grouped', () => {
    const fixture = create();
    const label = fixture.debugElement.query(By.css('.toggle')).nativeElement as HTMLElement;
    label.click();
    expect(fakeFeed.setGrouped).toHaveBeenCalledWith(false);
  });

  it('onScroll calls loadMore() only when near the bottom', () => {
    const fixture = create();
    const log = fixture.debugElement.query(By.css('.feed-log')).nativeElement as HTMLElement;
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true });

    Object.defineProperty(log, 'scrollTop', { value: 100, configurable: true });
    log.dispatchEvent(new Event('scroll'));
    expect(fakeFeed.loadMore).not.toHaveBeenCalled();

    Object.defineProperty(log, 'scrollTop', { value: 650, configurable: true });
    log.dispatchEvent(new Event('scroll'));
    expect(fakeFeed.loadMore).toHaveBeenCalledTimes(1);
  });

  it('countLabel renders the documented template (views.md §Feed page) when no search is active', () => {
    pageEvents.set([
      ev({ id: 'a1', deployment_id: 'dep-a' }),
      ev({ id: 'b1', deployment_id: 'dep-b' }),
    ]);
    grouped.set(false);
    const fixture = create();
    const text = (fixture.debugElement.query(By.css('.feed-sub')).nativeElement as HTMLElement).textContent ?? '';
    expect(text).toBe('2 events · 2 deployments — showing 2');
  });

  it('countLabel appends a matching-count clause while a search is active (flat)', () => {
    pageEvents.set([ev({ id: 'a1', deployment_id: 'dep-a' })]);
    pageQuery.set('auth');
    grouped.set(false);
    const fixture = create();
    const text = (fixture.debugElement.query(By.css('.feed-sub')).nativeElement as HTMLElement).textContent ?? '';
    expect(text).toBe('1 event · 1 deployment · 1 matching event — showing 1');
  });

  it('countLabel matching-count clause uses "deployment(s)" wording when grouped', () => {
    pageEvents.set([
      ev({ id: 'a1', deployment_id: 'dep-a' }),
      ev({ id: 'a2', deployment_id: 'dep-a' }),
    ]);
    pageQuery.set('auth');
    grouped.set(true);
    const fixture = create();
    const text = (fixture.debugElement.query(By.css('.feed-sub')).nativeElement as HTMLElement).textContent ?? '';
    expect(text).toBe('2 events · 1 deployment · 1 matching deployment — showing 1');
  });

  // ── Fill-until-overflow — auto-load when the page doesn't fill the
  // viewport (issue #417) ────────────────────────────────────────────────
  //
  // Scroll-driven loadMore() can never fire when the first page already
  // fits .feed-log without a scrollbar (tall monitor + grouped roll-ups,
  // which roughly halve the row count vs. flat — the worst case). The
  // component measures .feed-log via afterRenderEffect's `read` phase
  // (guaranteed to run after the DOM reflects the latest pageEvents()) and
  // keeps calling loadMore() until the container overflows or hasMore()
  // goes false. TestBed.tick() flushes the render-effect synchronously —
  // fakeFeed.pageHasMore starts false (the shared beforeEach default) so
  // create()'s own initial render never arms the loop before the test has
  // a chance to stub .feed-log's layout metrics.
  describe('fill-until-overflow — auto-load when the page does not fill the viewport (issue #417)', () => {
    function stubLogMetrics(
      fixture: ReturnType<typeof create>,
      clientHeight: number,
      scrollHeight: number | (() => number),
    ): HTMLElement {
      const log = fixture.debugElement.query(By.css('.feed-log')).nativeElement as HTMLElement;
      Object.defineProperty(log, 'clientHeight', { value: clientHeight, configurable: true });
      if (typeof scrollHeight === 'function') {
        Object.defineProperty(log, 'scrollHeight', { configurable: true, get: scrollHeight });
      } else {
        Object.defineProperty(log, 'scrollHeight', { value: scrollHeight, configurable: true });
      }
      return log;
    }

    it('auto-loads two more pages then stops once the container overflows (small viewport)', () => {
      pageEvents.set([ev({ id: 'seed', deployment_id: 'dep-seed' })]);
      grouped.set(false); // 1 row per event — simplest 1:1 row-count-to-height mapping
      fakeFeed.loadMore = vi.fn(() => {
        pageEvents.update((events) => [
          ...events,
          ev({ id: `g${events.length}`, deployment_id: `dep-${events.length}` }),
        ]);
      });
      const fixture = create(); // pageHasMore still false — no auto-load armed yet

      // 100px/row, 250px container: overflows once there are more than 2 rows.
      stubLogMetrics(fixture, 250, () => pageEvents().length * 100);
      fakeFeed.pageHasMore.set(true); // arm the loop now that metrics are stubbed
      TestBed.tick();
      TestBed.tick();
      TestBed.tick();

      expect(fakeFeed.loadMore).toHaveBeenCalledTimes(2);
      expect(pageEvents()).toHaveLength(3);
    });

    it('stops auto-loading once hasMore goes false (end-of-history), even though the container still fits', () => {
      pageEvents.set([ev({ id: 'seed', deployment_id: 'dep-seed' })]);
      grouped.set(false);
      fakeFeed.loadMore = vi.fn(() => {
        pageEvents.update((events) => [
          ...events,
          ev({ id: `g${events.length}`, deployment_id: `dep-${events.length}` }),
        ]);
        // Simulates the server's next_cursor going null after this page.
        fakeFeed.pageHasMore.set(false);
      });
      const fixture = create();

      // Container tall enough to never overflow on its own — only hasMore should stop the loop.
      stubLogMetrics(fixture, 5000, () => pageEvents().length * 100);
      fakeFeed.pageHasMore.set(true);
      TestBed.tick();
      TestBed.tick();
      TestBed.tick();

      expect(fakeFeed.loadMore).toHaveBeenCalledTimes(1);
      expect(pageEvents()).toHaveLength(2);
    });

    it('does not auto-load while a page is already loading', () => {
      pageEvents.set([ev({ id: 'seed', deployment_id: 'dep-seed' })]);
      const fixture = create();
      stubLogMetrics(fixture, 5000, 100); // never overflows

      fakeFeed.pageLoadingInitial.set(true);
      fakeFeed.pageHasMore.set(true);
      TestBed.tick();

      expect(fakeFeed.loadMore).not.toHaveBeenCalled();
    });

    it('does not auto-load when the page already overflows', () => {
      pageEvents.set([ev({ id: 'seed', deployment_id: 'dep-seed' })]);
      const fixture = create();
      stubLogMetrics(fixture, 100, 5000); // already overflowing

      fakeFeed.pageHasMore.set(true);
      TestBed.tick();

      expect(fakeFeed.loadMore).not.toHaveBeenCalled();
    });

    it('re-checks after toggling grouped — fewer roll-up rows can newly stop filling the viewport', () => {
      pageEvents.set([
        ev({ id: 'a1', deployment_id: 'dep-a' }),
        ev({ id: 'a2', deployment_id: 'dep-a' }),
        ev({ id: 'b1', deployment_id: 'dep-b' }),
      ]);
      grouped.set(false); // 3 flat rows
      const fixture = create();

      // 3 flat rows overflow; 2 grouped roll-up rows (dep-a, dep-b) do not.
      stubLogMetrics(fixture, 250, () => {
        const rows = grouped() ? 2 : pageEvents().length;
        return rows * 100;
      });
      fakeFeed.pageHasMore.set(true);
      TestBed.tick();
      expect(fakeFeed.loadMore).not.toHaveBeenCalled(); // flat: 300 > 250, already overflowing

      grouped.set(true); // 2 rows * 100 = 200 <= 250 — now fits, should trigger a fill check
      TestBed.tick();

      expect(fakeFeed.loadMore).toHaveBeenCalledTimes(1);
    });

    it('survives a search superseding mid-fill — picks up the new page instead of the stale one', () => {
      // FeedService's own pageRequestId guard (c1590f0) means a loadMore()
      // in flight when search() fires gets its response discarded; the
      // component only ever sees the RESULTING signal state, never the
      // stale response. Simulate that here: the mocked loadMore(), instead
      // of appending to the old query's array (what a plain loadMore()
      // response would do), swaps in an entirely different query's page —
      // the observable effect of a search superseding it mid-fill.
      pageEvents.set([ev({ id: 'old-seed', deployment_id: 'dep-old' })]);
      grouped.set(false);
      fakeFeed.loadMore = vi.fn(() => {
        pageEvents.set([
          ev({ id: 'new1', deployment_id: 'dep-new1' }),
          ev({ id: 'new2', deployment_id: 'dep-new2' }),
        ]);
        fakeFeed.pageHasMore.set(false); // the new query's page 1 is already end-of-history
      });
      const fixture = create();

      // 100px/row, 250px container: 1 old row fits; 2 new rows still fit too.
      stubLogMetrics(fixture, 250, () => pageEvents().length * 100);
      fakeFeed.pageHasMore.set(true);
      TestBed.tick();
      TestBed.tick();
      TestBed.tick();

      // Fills once against the old page, the search-superseded response
      // swaps the dataset, and the now-false hasMore stops the loop —
      // no infinite loop, no attempt to keep growing the stale array.
      expect(fakeFeed.loadMore).toHaveBeenCalledTimes(1);
      expect(pageEvents()).toEqual([
        ev({ id: 'new1', deployment_id: 'dep-new1' }),
        ev({ id: 'new2', deployment_id: 'dep-new2' }),
      ]);
    });
  });

  describe('service label — render-on-collision (issue #353)', () => {
    it('shows the bare service name when no namespace collision exists in the loaded page', () => {
      pageEvents.set([
        ev({ id: 'a1', deployment_id: 'dep-a', service: 'gateway', namespace: 'org-a' }),
        ev({ id: 'b1', deployment_id: 'dep-b', service: 'auth-bff', namespace: null }),
      ]);
      grouped.set(false);
      const fixture = create();
      const labels = fixture.debugElement.queryAll(By.css('.feed-service')).map((d) => (d.nativeElement as HTMLElement).textContent?.trim());
      expect(labels).toEqual(['gateway', 'auth-bff']);
    });

    it('prefixes namespace/service only for the colliding service name, within this page\'s own loaded set', () => {
      pageEvents.set([
        ev({ id: 'a1', deployment_id: 'dep-a', service: 'gateway', namespace: 'org-a' }),
        ev({ id: 'b1', deployment_id: 'dep-b', service: 'gateway', namespace: 'org-b' }),
        ev({ id: 'c1', deployment_id: 'dep-c', service: 'auth-bff', namespace: null }),
      ]);
      grouped.set(false);
      const fixture = create();
      const labels = fixture.debugElement.queryAll(By.css('.feed-service')).map((d) => (d.nativeElement as HTMLElement).textContent?.trim());
      expect(labels).toEqual(['org-a/gateway', 'org-b/gateway', 'auth-bff']);
    });
  });
});
