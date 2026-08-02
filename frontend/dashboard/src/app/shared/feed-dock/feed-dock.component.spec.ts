/**
 * FeedDockComponent — unit tests.
 *
 * Strategy: fake FeedService + fake AppStateService (writable signals), fake
 * Router (spy on navigate) — mirrors topbar.component.spec.ts's approach.
 *
 * AppStateService is used for real (providedIn:'root', no HTTP dependency) —
 * only its `activeView` signal is mutated directly, so `rowLabel`'s
 * render-on-collision logic (issue #353) runs unmocked.
 *
 * Covers:
 *   - dockVisible(): true only when dockOpenPref is true AND activeView !== 'feed'
 *   - suppressed while Feed view is active, even if dockOpenPref is true
 *   - renders up to 8 grouped rows (roll-up, not one per event)
 *   - renders up to 8 flat rows when not grouped
 *   - close() calls FeedService.setDockOpen(false)
 *   - openFeed() navigates to /feed
 *   - toggleGrouped() flips the shared grouped signal
 *   - service label render-on-collision (issue #353, #397 FIX): namespace
 *     prefix appears only when the same service name collides across
 *     namespaces within the dock's own loaded buffer
 */
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FeedDockComponent } from './feed-dock.component';
import { FeedService } from '../../core/services/feed.service';
import { AppStateService } from '../../core/services/app-state.service';
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

describe('FeedDockComponent', () => {
  let dockEvents: ReturnType<typeof signal<DeploymentEvent[]>>;
  let grouped: ReturnType<typeof signal<boolean>>;
  let dockOpenPref: ReturnType<typeof signal<boolean>>;
  let state: AppStateService;
  let fakeFeed: {
    grouped: typeof grouped;
    dockOpenPref: typeof dockOpenPref;
    dockEvents: typeof dockEvents;
    dockFlashId: ReturnType<typeof signal<string | null>>;
    setGrouped: ReturnType<typeof vi.fn>;
    setDockOpen: ReturnType<typeof vi.fn>;
  };
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    localStorage.clear();
    dockEvents = signal<DeploymentEvent[]>([]);
    grouped = signal(true);
    dockOpenPref = signal(false);
    navigateSpy = vi.fn();

    fakeFeed = {
      grouped,
      dockOpenPref,
      dockEvents,
      dockFlashId: signal(null),
      setGrouped: vi.fn((v: boolean) => grouped.set(v)),
      setDockOpen: vi.fn((v: boolean) => dockOpenPref.set(v)),
    };

    await TestBed.configureTestingModule({
      imports: [FeedDockComponent],
      providers: [
        { provide: FeedService, useValue: fakeFeed },
        { provide: Router, useValue: { navigate: navigateSpy } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    // Real AppStateService (providedIn:'root', no HTTP dependency) — only
    // `activeView` is mutated directly; `rowLabel` runs unmocked.
    state = TestBed.inject(AppStateService);
    state.activeView.set('matrix');
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  function create() {
    const fixture = TestBed.createComponent(FeedDockComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('is not open when dockOpenPref is false', () => {
    dockOpenPref.set(false);
    const fixture = create();
    const aside = fixture.debugElement.query(By.css('.feed-dock')).nativeElement as HTMLElement;
    expect(aside.classList.contains('is-open')).toBe(false);
  });

  it('is open when dockOpenPref is true and the active view is not feed', () => {
    dockOpenPref.set(true);
    state.activeView.set('matrix');
    const fixture = create();
    const aside = fixture.debugElement.query(By.css('.feed-dock')).nativeElement as HTMLElement;
    expect(aside.classList.contains('is-open')).toBe(true);
  });

  it('is suppressed while the Feed view is active, even with dockOpenPref true', () => {
    dockOpenPref.set(true);
    state.activeView.set('feed');
    const fixture = create();
    const aside = fixture.debugElement.query(By.css('.feed-dock')).nativeElement as HTMLElement;
    expect(aside.classList.contains('is-open')).toBe(false);
  });

  it('renders one row per group (roll-up) when grouped, capped at 8', () => {
    const events: DeploymentEvent[] = [];
    for (let i = 0; i < 10; i++) events.push(ev({ id: `e${i}`, deployment_id: `dep-${i}` }));
    dockEvents.set(events);
    grouped.set(true);
    const fixture = create();
    const rows = fixture.debugElement.queryAll(By.css('app-feed-row'));
    expect(rows.length).toBe(8);
  });

  it('renders flat rows capped at 8 when not grouped', () => {
    const events: DeploymentEvent[] = [];
    for (let i = 0; i < 10; i++) events.push(ev({ id: `e${i}`, deployment_id: `dep-${i}` }));
    dockEvents.set(events);
    grouped.set(false);
    const fixture = create();
    const rows = fixture.debugElement.queryAll(By.css('app-feed-row'));
    expect(rows.length).toBe(8);
  });

  it('close() calls FeedService.setDockOpen(false)', () => {
    const fixture = create();
    const closeBtn = fixture.debugElement.query(By.css('.drawer-close')).nativeElement as HTMLElement;
    closeBtn.click();
    expect(fakeFeed.setDockOpen).toHaveBeenCalledWith(false);
  });

  it('openFeed() navigates to /feed', () => {
    const fixture = create();
    const openBtn = fixture.debugElement.query(By.css('.feed-dock-open-link')).nativeElement as HTMLElement;
    openBtn.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/feed']);
  });

  it('toggleGrouped() flips the shared grouped signal', () => {
    grouped.set(true);
    const fixture = create();
    const label = fixture.debugElement.query(By.css('.toggle')).nativeElement as HTMLElement;
    label.click();
    expect(fakeFeed.setGrouped).toHaveBeenCalledWith(false);
  });

  describe('service label — render-on-collision (issue #353)', () => {
    it('shows the bare service name when no namespace collision exists in the dock buffer', () => {
      dockEvents.set([
        ev({ id: 'a1', deployment_id: 'dep-a', service: 'gateway', namespace: 'org-a' }),
        ev({ id: 'b1', deployment_id: 'dep-b', service: 'auth-bff', namespace: null }),
      ]);
      grouped.set(false);
      const fixture = create();
      const labels = fixture.debugElement.queryAll(By.css('.feed-service')).map((d) => (d.nativeElement as HTMLElement).textContent?.trim());
      expect(labels).toEqual(['gateway', 'auth-bff']);
    });

    it("prefixes namespace/service only for the colliding service name, within the dock's own loaded buffer", () => {
      dockEvents.set([
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
