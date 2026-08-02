import { Component, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { TopbarComponent } from './shared/topbar/topbar.component';
import { FooterComponent } from './shared/footer/footer.component';
import { FeedDockComponent } from './shared/feed-dock/feed-dock.component';
import { AppStateService } from './core/services/app-state.service';
import { DeploymentApiService } from './core/services/deployment-api.service';
import { BrowserNotificationService } from './core/services/browser-notification.service';
import { FeedService, isDockVisible } from './core/services/feed.service';
import { RateLimitReport } from './core/models/deployment.model';

/**
 * Root application shell.
 *
 * Owns the single matrix snapshot load and SSE subscription for the entire
 * app lifetime. Both Matrix and Swimlanes views are pure presentation —
 * they read from AppStateService.matrixData and never open their own
 * connections. Switching views costs zero extra calls.
 *
 * Data flow:
 *   ngOnInit → GET /api/matrix → state.matrixData.set(snapshot)
 *            → subscribe /api/events/stream (shared; one EventSource per tab)
 *              → each event:  state.applyDeploymentEvent(ev)
 *              → reconnect:   browser EventSource sends Last-Event-ID automatically;
 *                             server replays missed events (spec §7); no poll needed.
 *            → subscribe deploymentConnectionState$ (separate Subject on the service)
 *              → 'connected' → state.sseConnected.set(true)
 *              → 'error'     → state.sseConnected.set(false)
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopbarComponent, FooterComponent, FeedDockComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    // Extra bottom clearance while the feed dock overlays the page (#397) —
    // mirrors the dock's own suppression rule so the two never disagree.
    '[class.feed-dock-open]': 'dockVisible()',
  },
})
export class App implements OnInit, OnDestroy {
  private readonly state         = inject(AppStateService);
  private readonly api           = inject(DeploymentApiService);
  private readonly router        = inject(Router);
  private readonly feedService   = inject(FeedService);
  // Inject to activate the effect that watches lastEffectiveEvent and fires notifications.
  private readonly _notifications = inject(BrowserNotificationService);

  private subs: Subscription[] = [];

  protected readonly dockVisible = computed(() =>
    isDockVisible(this.feedService.dockOpenPref(), this.state.activeView()),
  );

  ngOnInit(): void {
    this.syncActiveView();
    this.loadMatrix();
    this.connectSSE();
    this.connectComponentEvents();
    this.feedService.init();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  /** Keep activeView in sync with the router — covers hard refresh and back/forward. */
  private syncActiveView(): void {
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const url = e.urlAfterRedirects;
        this.state.activeView.set(
          url.startsWith('/swimlanes') ? 'swimlanes'
          : url.startsWith('/feed') ? 'feed'
          : url.startsWith('/analytics') ? 'analytics'
          : 'matrix',
        );
      });
    this.subs.push(sub);
  }

  private loadMatrix(): void {
    const sub = this.api.getMatrix().subscribe({
      next:  (m) => this.state.matrixData.set(m),
      error: ()  => { /* matrix stays at last known good value */ },
    });
    this.subs.push(sub);
  }

  private connectSSE(): void {
    // Subscribe to the shared deployment stream (one EventSource for the tab).
    const eventSub = this.api.streamEvents().subscribe({
      next:  (ev) => this.state.applyDeploymentEvent(ev),
      error: ()   => this.state.sseConnected.set(false),
    });
    this.subs.push(eventSub);

    // Connection-state is reported via a dedicated Subject on the service so
    // that onOpen/onError callbacks do not require a per-subscriber EventSource.
    const stateSub = this.api.deploymentConnectionState$.subscribe((s) => {
      this.state.sseConnected.set(s === 'connected');
    });
    this.subs.push(stateSub);
  }

  /**
   * Subscribe to GET /api/control/events/stream and update the latest
   * rate-limit report signal when a "rate-limit" component event arrives.
   * All other event_types are silently ignored.
   * The stored RateLimitReport merges the envelope `state` with the payload fields.
   */
  private connectComponentEvents(): void {
    const sub = this.api.streamComponentEvents().subscribe({
      next: (record) => {
        if (record.event_type === 'rate-limit' && record.payload) {
          const p = record.payload as Record<string, unknown>;
          const adapter = typeof p['adapter'] === 'string' ? p['adapter'] : '';
          const report: RateLimitReport = {
            state:        record.state,
            adapter,
            ci_limit:     typeof p['ci_limit']     === 'number'  ? p['ci_limit']     : null,
            ci_remaining: typeof p['ci_remaining'] === 'number'  ? p['ci_remaining'] : null,
            own_budget:   typeof p['own_budget']   === 'number'  ? p['own_budget']   : null,
            own_used:     typeof p['own_used']     === 'number'  ? p['own_used']     : null,
            reset_at:     typeof p['reset_at']     === 'string'  ? p['reset_at']     : null,
          };
          // Update the per-adapter entry in the map (Fix 4: multi-adapter keying).
          const current = this.state.rateLimitMap();
          const next = new Map(current);
          next.set(adapter, report);
          this.state.rateLimitMap.set(next);
        }
      },
      error: () => { /* non-fatal; rate-limit chips stay at last known value */ },
    });
    this.subs.push(sub);
  }
}
