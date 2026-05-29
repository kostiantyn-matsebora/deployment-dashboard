import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';

import { TopbarComponent } from './shared/topbar/topbar.component';
import { AppStateService } from './core/services/app-state.service';
import { DeploymentApiService } from './core/services/deployment-api.service';

/** Re-fetch the full matrix snapshot every 5 minutes to pick up new services / environments. */
const MATRIX_REFRESH_MS = 5 * 60_000;

/**
 * Root application shell.
 *
 * Owns the single matrix snapshot load, SSE subscription, and periodic
 * full refresh for the entire app lifetime. Both Matrix and Swimlanes views
 * are pure presentation — they read from AppStateService.matrixData and
 * never open their own connections.
 *
 * Data flow:
 *   ngOnInit → GET /api/matrix → state.matrixData.set(snapshot)
 *            → subscribe /api/events/stream
 *              → each event: state.applyDeploymentEvent(ev)   // patch existing slots only
 *              → error:      state.sseConnected.set(false)
 *   setInterval(5 min) → GET /api/matrix                      // discovers new services/envs,
 *                                                             // acts as drift safety-net
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, TopbarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly state = inject(AppStateService);
  private readonly api   = inject(DeploymentApiService);

  private subs: Subscription[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadMatrix();
    this.connectSSE();

    // Periodic full refresh — bounded discovery of new services/environments
    // and safety-net against incremental-update drift.
    this.refreshTimer = setInterval(() => this.loadMatrix(), MATRIX_REFRESH_MS);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
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
