/**
 * FeedService — unit tests.
 *
 * Strategy: DeploymentApiService is replaced with a fully controllable fake
 * (Subjects for streamEvents(), a queue of listDeployments() responses) —
 * same "simulate the observable/callback layer directly" approach used by
 * deployment-api.service.spec.ts, since real EventSource/HTTP round-trips
 * aren't needed to exercise FeedService's own logic.
 *
 * Covers:
 *   - grouped / dockOpenPref: default values, persistence round-trip
 *   - construction never requires DeploymentApiService to be resolved
 *     (init() is opt-in, mirrors PresetsService's lazy DeploymentApiService
 *     access so captureSettings() can pull FeedService without side effects)
 *   - init(): seeds dockEvents from listDeployments(); is idempotent
 *   - live ingest: prepends to dockEvents (capped) and sets dockFlashId
 *   - search()/loadMore(): pagination bookkeeping, hasMore, query filter sent
 *   - live ingest while a page is active: prepends only on query match
 *   - live ingest while no page is active: pageEvents untouched
 */
import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FeedService, isDockVisible } from './feed.service';
import { DeploymentApiService } from './deployment-api.service';
import { DeploymentEvent, DeploymentEventPage } from '../models/deployment.model';

function ev(overrides: Partial<DeploymentEvent> & { id: string; deployment_id: string }): DeploymentEvent {
  return {
    service:     'payments-api',
    environment: 'prod',
    status:      'success',
    happened_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('FeedService', () => {
  let service: FeedService;
  let live$: Subject<DeploymentEvent>;
  let fakeApi: { streamEvents: ReturnType<typeof vi.fn>; listDeployments: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    live$ = new Subject<DeploymentEvent>();
    fakeApi = {
      streamEvents: vi.fn(() => live$.asObservable()),
      listDeployments: vi.fn(() => of<DeploymentEventPage>({ items: [], next_cursor: null })),
    };

    await TestBed.configureTestingModule({
      providers: [
        FeedService,
        { provide: DeploymentApiService, useValue: fakeApi },
      ],
    }).compileComponents();

    service = TestBed.inject(FeedService);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('grouped / dockOpenPref defaults + persistence', () => {
    it('grouped defaults to true', () => {
      expect(service.grouped()).toBe(true);
    });

    it('dockOpenPref defaults to false (collapsed)', () => {
      expect(service.dockOpenPref()).toBe(false);
    });

    it('setGrouped persists to dd:feedGrouped', async () => {
      service.setGrouped(false);
      await TestBed.flushEffects();
      expect(localStorage.getItem('dd:feedGrouped')).toBe('false');
    });

    it('setDockOpen persists to dd:feedDock as open/closed', async () => {
      service.setDockOpen(true);
      await TestBed.flushEffects();
      expect(localStorage.getItem('dd:feedDock')).toBe('open');
      service.setDockOpen(false);
      await TestBed.flushEffects();
      expect(localStorage.getItem('dd:feedDock')).toBe('closed');
    });

    it('rehydrates grouped=false and dockOpenPref=true from storage on construction', async () => {
      localStorage.setItem('dd:feedGrouped', 'false');
      localStorage.setItem('dd:feedDock', 'open');
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        providers: [FeedService, { provide: DeploymentApiService, useValue: fakeApi }],
      }).compileComponents();
      const fresh = TestBed.inject(FeedService);
      expect(fresh.grouped()).toBe(false);
      expect(fresh.dockOpenPref()).toBe(true);
    });
  });

  describe('construction / lazy init', () => {
    it('never calls DeploymentApiService methods until init() is called', () => {
      expect(fakeApi.streamEvents).not.toHaveBeenCalled();
      expect(fakeApi.listDeployments).not.toHaveBeenCalled();
    });

    it('init() seeds dockEvents from listDeployments and subscribes to streamEvents', () => {
      const seed = ev({ id: 'seed-1', deployment_id: 'dep-1' });
      fakeApi.listDeployments.mockReturnValue(of<DeploymentEventPage>({ items: [seed], next_cursor: null }));

      service.init();

      expect(fakeApi.listDeployments).toHaveBeenCalledWith({ limit: 60 });
      expect(fakeApi.streamEvents).toHaveBeenCalledTimes(1);
      expect(service.dockEvents()).toEqual([seed]);
    });

    it('init() is idempotent — a second call does not re-seed or re-subscribe', () => {
      service.init();
      service.init();
      expect(fakeApi.listDeployments).toHaveBeenCalledTimes(1);
      expect(fakeApi.streamEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe('live ingest — dock', () => {
    beforeEach(() => service.init());

    it('prepends a live event to dockEvents and sets dockFlashId', () => {
      const incoming = ev({ id: 'live-1', deployment_id: 'dep-2' });
      live$.next(incoming);
      expect(service.dockEvents()[0]).toEqual(incoming);
      expect(service.dockFlashId()).toBe('live-1');
    });

    it('caps dockEvents at 60 entries', () => {
      for (let i = 0; i < 70; i++) {
        live$.next(ev({ id: `e${i}`, deployment_id: `dep-${i}` }));
      }
      expect(service.dockEvents()).toHaveLength(60);
      expect(service.dockEvents()[0].id).toBe('e69');
    });
  });

  describe('search() / loadMore()', () => {
    it('search("") fetches page 1 without a q param', () => {
      service.search('');
      expect(fakeApi.listDeployments).toHaveBeenCalledWith({ limit: 50 });
    });

    it('search(q) resets pageEvents and sends q trimmed', () => {
      service.pageEvents.set([ev({ id: 'stale', deployment_id: 'dep-x' })]);
      service.search('  auth  ');
      expect(fakeApi.listDeployments).toHaveBeenCalledWith({ limit: 50, q: 'auth' });
    });

    it('populates pageEvents and pageHasMore from the response', () => {
      const items = [ev({ id: 'a', deployment_id: 'dep-a' })];
      fakeApi.listDeployments.mockReturnValue(of<DeploymentEventPage>({ items, next_cursor: 'c2' }));
      service.search('');
      expect(service.pageEvents()).toEqual(items);
      expect(service.pageHasMore()).toBe(true);
    });

    it('pageHasMore is false when next_cursor is null', () => {
      fakeApi.listDeployments.mockReturnValue(of<DeploymentEventPage>({ items: [], next_cursor: null }));
      service.search('');
      expect(service.pageHasMore()).toBe(false);
    });

    it('loadMore() appends using the cursor from the previous page', () => {
      fakeApi.listDeployments.mockReturnValue(
        of<DeploymentEventPage>({ items: [ev({ id: 'a', deployment_id: 'dep-a' })], next_cursor: 'cursor-2' }),
      );
      service.search('');

      fakeApi.listDeployments.mockReturnValue(
        of<DeploymentEventPage>({ items: [ev({ id: 'b', deployment_id: 'dep-b' })], next_cursor: null }),
      );
      service.loadMore();

      expect(fakeApi.listDeployments).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-2' });
      expect(service.pageEvents().map((e) => e.id)).toEqual(['a', 'b']);
      expect(service.pageHasMore()).toBe(false);
    });

    it('loadMore() is a no-op when there is no more to load', () => {
      fakeApi.listDeployments.mockReturnValue(of<DeploymentEventPage>({ items: [], next_cursor: null }));
      service.search('');
      fakeApi.listDeployments.mockClear();
      service.loadMore();
      expect(fakeApi.listDeployments).not.toHaveBeenCalled();
    });
  });

  // ── Stale-response race — search() then clear (issue #417) ────────────────
  //
  // Reproduces the reported regression: search("auth") is in flight (few/no
  // matches → its eventual response carries next_cursor: null); before it
  // resolves, the user clears the box → search("") fires and resets the
  // sequence. If the stale "auth" response is later applied anyway, it
  // clobbers the fresh unfiltered state and pageHasMore is stuck false,
  // killing infinite scroll even though there is plenty more history.
  describe('stale search response after a newer search() (issue #417)', () => {
    it('a late-arriving stale response does not overwrite the newer search results', () => {
      const stale$ = new Subject<DeploymentEventPage>();
      const fresh$ = new Subject<DeploymentEventPage>();
      fakeApi.listDeployments
        .mockReturnValueOnce(stale$.asObservable()) // search('auth')
        .mockReturnValueOnce(fresh$.asObservable()); // search('') — supersedes it

      service.search('auth');
      service.search('');

      // Fresh (unfiltered) response lands first, as the clear-search's own
      // fetch normally would relative to a since-abandoned query.
      fresh$.next({ items: [ev({ id: 'f1', deployment_id: 'dep-f' })], next_cursor: 'cursor-fresh' });
      fresh$.complete();

      // Stale 'auth' response arrives late — must be ignored entirely.
      stale$.next({ items: [ev({ id: 'stale-1', deployment_id: 'dep-s' })], next_cursor: null });
      stale$.complete();

      expect(service.pageEvents().map((e) => e.id)).toEqual(['f1']);
      expect(service.pageHasMore()).toBe(true);
    });

    it('a stale response error does not clobber pageHasMore either', () => {
      const stale$ = new Subject<DeploymentEventPage>();
      const fresh$ = new Subject<DeploymentEventPage>();
      fakeApi.listDeployments
        .mockReturnValueOnce(stale$.asObservable())
        .mockReturnValueOnce(fresh$.asObservable());

      service.search('auth');
      service.search('');

      fresh$.next({ items: [ev({ id: 'f1', deployment_id: 'dep-f' })], next_cursor: 'cursor-fresh' });
      fresh$.complete();

      stale$.error(new Error('stale request failed'));

      expect(service.pageHasMore()).toBe(true);
      expect(service.pageEvents().map((e) => e.id)).toEqual(['f1']);
    });

    it('loadMore() after the fresh search still fetches using the fresh cursor (sequence stays alive)', () => {
      const stale$ = new Subject<DeploymentEventPage>();
      const fresh$ = new Subject<DeploymentEventPage>();
      fakeApi.listDeployments
        .mockReturnValueOnce(stale$.asObservable())
        .mockReturnValueOnce(fresh$.asObservable());

      service.search('auth');
      service.search('');
      fresh$.next({ items: [ev({ id: 'f1', deployment_id: 'dep-f' })], next_cursor: 'cursor-fresh' });
      fresh$.complete();
      stale$.next({ items: [ev({ id: 'stale-1', deployment_id: 'dep-s' })], next_cursor: null });
      stale$.complete();

      fakeApi.listDeployments.mockReturnValue(
        of<DeploymentEventPage>({ items: [ev({ id: 'f2', deployment_id: 'dep-f2' })], next_cursor: null }),
      );
      service.loadMore();

      expect(fakeApi.listDeployments).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-fresh' });
      expect(service.pageEvents().map((e) => e.id)).toEqual(['f1', 'f2']);
      expect(service.pageHasMore()).toBe(false);
    });

    // Interleaving variant: the STALE request is a loadMore() (not a
    // search()) superseded by a newer search(). fetchPage() must clear the
    // loading flag its OWN request owns (pageLoadingMore here) even when the
    // response is discarded as stale — otherwise pageLoadingMore is stuck
    // true forever (loadMore() only ever sets it true; nothing else resets
    // it), and loadMore()'s own guard permanently blocks all future scroll
    // requests. Reachable via scroll-then-type inside the 300ms debounce.
    it('a stale loadMore() response superseded by a newer search() does not leave pageLoadingMore stuck', () => {
      fakeApi.listDeployments.mockReturnValueOnce(
        of<DeploymentEventPage>({ items: [ev({ id: 'a', deployment_id: 'dep-a' })], next_cursor: 'cursor-2' }),
      );
      service.search('');

      const staleLoadMore$ = new Subject<DeploymentEventPage>();
      const freshSearch$ = new Subject<DeploymentEventPage>();
      fakeApi.listDeployments
        .mockReturnValueOnce(staleLoadMore$.asObservable()) // loadMore() — about to be superseded
        .mockReturnValueOnce(freshSearch$.asObservable());  // search('other')

      service.loadMore();
      expect(service.pageLoadingMore()).toBe(true);

      // A newer search supersedes the in-flight loadMore before it resolves.
      service.search('other');

      // The fresh search resolves first...
      freshSearch$.next({ items: [ev({ id: 'f1', deployment_id: 'dep-f' })], next_cursor: 'cursor-fresh' });
      freshSearch$.complete();

      // ...then the stale loadMore response finally arrives late.
      staleLoadMore$.next({ items: [ev({ id: 'stale', deployment_id: 'dep-s' })], next_cursor: 'cursor-stale' });
      staleLoadMore$.complete();

      expect(service.pageLoadingMore()).toBe(false);
      expect(service.pageEvents().map((e) => e.id)).toEqual(['f1']); // stale item never applied

      // loadMore() must not be permanently blocked by the stuck flag.
      fakeApi.listDeployments.mockReturnValueOnce(
        of<DeploymentEventPage>({ items: [ev({ id: 'f2', deployment_id: 'dep-f2' })], next_cursor: null }),
      );
      service.loadMore();

      // pageQuery is still 'other' from the superseding search — loadMore()
      // correctly continues that (not the stale, abandoned) query.
      expect(fakeApi.listDeployments).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-fresh', q: 'other' });
      expect(service.pageEvents().map((e) => e.id)).toEqual(['f1', 'f2']);
    });

    // Same interleaving, but the stale loadMore errors instead of succeeding.
    it('a stale loadMore() ERROR superseded by a newer search() does not leave pageLoadingMore stuck', () => {
      fakeApi.listDeployments.mockReturnValueOnce(
        of<DeploymentEventPage>({ items: [ev({ id: 'a', deployment_id: 'dep-a' })], next_cursor: 'cursor-2' }),
      );
      service.search('');

      const staleLoadMore$ = new Subject<DeploymentEventPage>();
      const freshSearch$ = new Subject<DeploymentEventPage>();
      fakeApi.listDeployments
        .mockReturnValueOnce(staleLoadMore$.asObservable())
        .mockReturnValueOnce(freshSearch$.asObservable());

      service.loadMore();
      expect(service.pageLoadingMore()).toBe(true);

      service.search('other');

      freshSearch$.next({ items: [ev({ id: 'f1', deployment_id: 'dep-f' })], next_cursor: 'cursor-fresh' });
      freshSearch$.complete();

      staleLoadMore$.error(new Error('stale loadMore failed'));

      expect(service.pageLoadingMore()).toBe(false);
      expect(service.pageHasMore()).toBe(true); // fresh search's hasMore, untouched by the stale error

      fakeApi.listDeployments.mockReturnValueOnce(
        of<DeploymentEventPage>({ items: [ev({ id: 'f2', deployment_id: 'dep-f2' })], next_cursor: null }),
      );
      service.loadMore();
      expect(fakeApi.listDeployments).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-fresh', q: 'other' });
    });
  });

  describe('live ingest — feed page', () => {
    beforeEach(() => service.init());

    it('does not touch pageEvents while no page is active', () => {
      live$.next(ev({ id: 'live-1', deployment_id: 'dep-2' }));
      expect(service.pageEvents()).toEqual([]);
    });

    it('prepends a matching live event once the page is active', () => {
      service.activatePage();
      service.search('');
      const incoming = ev({ id: 'live-1', deployment_id: 'dep-2', service: 'auth-bff' });
      live$.next(incoming);
      expect(service.pageEvents()[0]).toEqual(incoming);
      expect(service.pageFlashId()).toBe('live-1');
    });

    it('ignores a live event that does not match the active search text', () => {
      service.activatePage();
      service.search('payments');
      live$.next(ev({ id: 'live-1', deployment_id: 'dep-2', service: 'auth-bff' }));
      expect(service.pageEvents()).toEqual([]);
    });

    it('stops growing pageEvents after deactivatePage()', () => {
      service.activatePage();
      service.search('');
      service.deactivatePage();
      live$.next(ev({ id: 'live-1', deployment_id: 'dep-2' }));
      expect(service.pageEvents()).toEqual([]);
    });
  });

  describe('isDockVisible()', () => {
    it('is false when dockOpenPref is false, regardless of view', () => {
      expect(isDockVisible(false, 'matrix')).toBe(false);
      expect(isDockVisible(false, 'feed')).toBe(false);
    });

    it('is true when dockOpenPref is true and the view is not feed', () => {
      expect(isDockVisible(true, 'matrix')).toBe(true);
      expect(isDockVisible(true, 'swimlanes')).toBe(true);
      expect(isDockVisible(true, 'analytics')).toBe(true);
    });

    it('is false when dockOpenPref is true but the view IS feed', () => {
      expect(isDockVisible(true, 'feed')).toBe(false);
    });
  });

  describe('ensureLoaded()', () => {
    it('loads once; a second call does not re-fetch', () => {
      service.ensureLoaded();
      expect(fakeApi.listDeployments).toHaveBeenCalledTimes(1);
      service.ensureLoaded();
      expect(fakeApi.listDeployments).toHaveBeenCalledTimes(1);
    });
  });
});
