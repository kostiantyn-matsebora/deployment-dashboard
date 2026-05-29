import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';

import { TopbarComponent } from './shared/topbar/topbar.component';
import { AppStateService } from './core/services/app-state.service';
import { DeploymentApiService } from './core/services/deployment-api.service';

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
 *            → subscribe /api/events/stream
 *              → each event:  state.applyDeploymentEvent(ev)
 *              → reconnect:   browser EventSource sends Last-Event-ID automatically;
 *                             server replays missed events (spec §7); no poll needed.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly state  = inject(AppStateService);
  private readonly api    = inject(DeploymentApiService);
  private readonly router = inject(Router);

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.syncActiveView();
    this.loadMatrix();
    this.connectSSE();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  /** Keep activeView in sync with the router — covers hard refresh and back/forward. */
  private syncActiveView(): void {
    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.state.activeView.set(
          e.urlAfterRedirects.startsWith('/swimlanes') ? 'swimlanes' : 'matrix',
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
    const sub = this.api.streamEvents().subscribe({
      next:  (ev) => {
        this.state.sseConnected.set(true);
        this.state.applyDeploymentEvent(ev);
      },
      error: () => this.state.sseConnected.set(false),
    });
    this.subs.push(sub);
  }
}
