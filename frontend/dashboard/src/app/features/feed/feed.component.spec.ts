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
