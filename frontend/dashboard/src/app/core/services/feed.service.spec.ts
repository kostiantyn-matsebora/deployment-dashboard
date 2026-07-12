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
