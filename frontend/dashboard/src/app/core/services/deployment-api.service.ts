import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, fromEventPattern, share } from 'rxjs';
import {
  AnalyticsChangeFailureRate,
  AnalyticsDora,
  AnalyticsDurationHistogram,
  AnalyticsHeatmap,
  AnalyticsIncidents,
  AnalyticsPeriod,
  AnalyticsPromotionFunnel,
  AnalyticsStatusDistribution,
  AnalyticsTopDeployers,
  AnalyticsFrequency,
  ComponentEventRecord,
  DeploymentEvent,
  DeploymentEventPage,
  Matrix,
  ProvidedPresets,
} from '../models/deployment.model';

/** Connection-state events emitted by the shared deployment SSE source. */
export type SseConnectionState = 'connected' | 'error';

export interface ListDeploymentsParams {
  service?: string;
  environment?: string;
  status?: string;
  deployment_id?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
}

/**
 * DeploymentApiService — REST + SSE client.
 *
 * Consumes read endpoints from GET /api/matrix, GET /api/deployments,
 * GET /api/services, GET /api/environments, GET /api/events/stream.
 * Contract: docs/api/openapi.yaml
 *
 * SSE connection sharing
 * ──────────────────────
 * The unfiltered deployment stream (/api/events/stream) and the component
 * event stream (/api/control/events/stream) are each shared via share() so
 * that N in-app subscribers all multiplex over a SINGLE EventSource per URL.
 * With resetOnRefCountZero:true the EventSource closes when all subscribers
 * unsubscribe (refcount→0 on full app teardown), but stays open for the tab
 * lifetime in normal use.
 *
 * A separate connectionState$ Subject carries 'connected'/'error' so that the
 * App live indicator does not need to open a second EventSource for onOpen/onError.
 */
@Injectable({ providedIn: 'root' })
export class DeploymentApiService {
  private readonly http = inject(HttpClient);

  // ── Shared SSE streams ────────────────────────────────────────────────────

  /**
   * Backing BehaviorSubject for deploymentConnectionState$.
   * Seeded with 'error' (disconnected) so late subscribers always receive the
   * current connection state and never miss the initial 'connected' transition.
   */
  private readonly _deploymentConnectionState$ =
    new BehaviorSubject<SseConnectionState>('error');

  /**
   * Emits 'connected' on EventSource.onopen and 'error' on EventSource.onerror
   * for the SHARED unfiltered deployment stream.
   *
   * App subscribes to this instead of passing onOpen/onError to streamEvents().
   * Exposed as Observable to hide the Subject API from consumers.
   */
  readonly deploymentConnectionState$: Observable<SseConnectionState> =
    this._deploymentConnectionState$.asObservable();

  /**
   * Shared multicast of the unfiltered /api/events/stream.
   *
   * All in-tab subscribers (App + BrowserNotificationService) share one
   * EventSource. Created lazily on first subscription; closed when the last
   * subscriber unsubscribes (resetOnRefCountZero:true).
   */
  private readonly sharedDeploymentStream$: Observable<DeploymentEvent> =
    fromEventPattern<DeploymentEvent>(
      (handler) => {
        const es = new EventSource('/api/events/stream');
        es.onopen  = () => this._deploymentConnectionState$.next('connected');
        es.onerror = () => this._deploymentConnectionState$.next('error');
        es.addEventListener('deployment', (event: Event) => {
          const msg = event as MessageEvent;
          try {
            handler(JSON.parse(msg.data) as DeploymentEvent);
          } catch {
            // malformed event — skip
          }
        });
        return es;
      },
      (_handler, es: EventSource) => {
        es.close();
      },
    ).pipe(share({ resetOnRefCountZero: true }));

  /**
   * Shared multicast of /api/control/events/stream (component events).
   *
   * Symmetric to the deployment stream — one EventSource per tab regardless
   * of how many consumers subscribe.
   */
  private readonly sharedComponentStream$: Observable<ComponentEventRecord> =
    fromEventPattern<ComponentEventRecord>(
      (handler) => {
        const es = new EventSource('/api/control/events/stream');
        es.addEventListener('component', (event: Event) => {
          const msg = event as MessageEvent;
          try {
            handler(JSON.parse(msg.data) as ComponentEventRecord);
          } catch {
            // malformed event — skip
          }
        });
        return es;
      },
      (_handler, es: EventSource) => {
        es.close();
      },
    ).pipe(share({ resetOnRefCountZero: true }));

  // ── REST endpoints ────────────────────────────────────────────────────────

  /** GET /api/version — deployed application version string. */
  getVersion(): Observable<{ version: string }> {
    return this.http.get<{ version: string }>('/api/version');
  }

  /** GET /api/matrix — denormalised services × environments snapshot. */
  getMatrix(service?: string): Observable<Matrix> {
    let params = new HttpParams();
    if (service) params = params.set('service', service);
    return this.http.get<Matrix>('/api/matrix', { params });
  }

  /** GET /api/deployments — cursor-paginated event log. */
  listDeployments(query: ListDeploymentsParams = {}): Observable<DeploymentEventPage> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        params = params.set(k, String(v));
      }
    }
    return this.http.get<DeploymentEventPage>('/api/deployments', { params });
  }

  /** GET /api/deployments/{id} — single event row. */
  getDeployment(id: string): Observable<DeploymentEvent> {
    return this.http.get<DeploymentEvent>(`/api/deployments/${id}`);
  }

  /** GET /api/services — distinct sorted service identifiers. */
  listServices(): Observable<{ items: string[] }> {
    return this.http.get<{ items: string[] }>('/api/services');
  }

  /** GET /api/environments — distinct sorted environment identifiers. */
  listEnvironments(): Observable<{ items: string[] }> {
    return this.http.get<{ items: string[] }>('/api/environments');
  }

  /**
   * GET /api/presets — merged repo/CI-sourced provided-preset catalog
   * (issue #391). Unauthenticated public read; items arrive pre-parsed
   * (source, name, version, settings, fetched_at) — no client-side bundle
   * parsing required.
   */
  getProvidedPresets(): Observable<ProvidedPresets> {
    return this.http.get<ProvidedPresets>('/api/presets');
  }

  /**
   * GET /api/events/stream — SSE fan-out of newly-ingested events.
   *
   * When called WITHOUT a `service` filter, returns the SHARED multicast
   * stream — all subscribers reuse one EventSource. Connection-state changes
   * (open / error) are emitted on `deploymentConnectionState$` rather than
   * via callbacks.
   *
   * When called WITH a `service` filter, the URL differs and a separate
   * EventSource is created per subscriber (distinct filtered URL, not the
   * shared hot path).
   *
   * EventSource automatically sends Last-Event-ID on reconnect; the server
   * replays missed events from that cursor (spec §7 SSE + LISTEN/NOTIFY).
   */
  streamEvents(options?: { service?: string }): Observable<DeploymentEvent> {
    if (options?.service) {
      // Filtered URL — keep a dedicated EventSource per subscriber.
      const url = `/api/events/stream?service=${encodeURIComponent(options.service)}`;
      return fromEventPattern<DeploymentEvent>(
        (handler) => {
          const es = new EventSource(url);
          es.addEventListener('deployment', (event: Event) => {
            const msg = event as MessageEvent;
            try {
              handler(JSON.parse(msg.data) as DeploymentEvent);
            } catch {
              // malformed event — skip
            }
          });
          return es;
        },
        (_handler, es: EventSource) => {
          es.close();
        },
      );
    }

    // Unfiltered — return the shared multicast stream.
    return this.sharedDeploymentStream$;
  }

  /**
   * GET /api/control/events/stream — SSE fan-out of component events.
   *
   * Returns the SHARED multicast stream — all subscribers reuse one EventSource.
   *
   * Event name on the wire is "component" (not "message").
   * Source: docs/api/api-guidelines.md §11 SSE component-events stream.
   */
  streamComponentEvents(): Observable<ComponentEventRecord> {
    return this.sharedComponentStream$;
  }

  // ── Analytics endpoints (issue #299) ─────────────────────────────────────
  // Contract: docs/api/openapi.yaml — tag: analytics
  // One focused GET per aggregate; no client-side aggregation.

  private analyticsParams(period: AnalyticsPeriod): HttpParams {
    return new HttpParams().set('window', period);
  }

  /** GET /api/analytics/dora — DORA Four Keys KPI band. */
  getAnalyticsDora(period: AnalyticsPeriod): Observable<AnalyticsDora> {
    return this.http.get<AnalyticsDora>('/api/analytics/dora', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/frequency — per-day success/failure counts. */
  getAnalyticsFrequency(period: AnalyticsPeriod): Observable<AnalyticsFrequency> {
    return this.http.get<AnalyticsFrequency>('/api/analytics/frequency', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/change-failure-rate — per-day CFR + elite threshold. */
  getAnalyticsChangeFailureRate(period: AnalyticsPeriod): Observable<AnalyticsChangeFailureRate> {
    return this.http.get<AnalyticsChangeFailureRate>('/api/analytics/change-failure-rate', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/duration-histogram — bins + p50 + p95. */
  getAnalyticsDurationHistogram(period: AnalyticsPeriod): Observable<AnalyticsDurationHistogram> {
    return this.http.get<AnalyticsDurationHistogram>('/api/analytics/duration-histogram', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/promotion-funnel — ordered funnel stages. */
  getAnalyticsPromotionFunnel(period: AnalyticsPeriod): Observable<AnalyticsPromotionFunnel> {
    return this.http.get<AnalyticsPromotionFunnel>('/api/analytics/promotion-funnel', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/status-distribution — event count per status (8, zero-filled). */
  getAnalyticsStatusDistribution(period: AnalyticsPeriod): Observable<AnalyticsStatusDistribution> {
    return this.http.get<AnalyticsStatusDistribution>('/api/analytics/status-distribution', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/heatmap — day-of-week × hour counts (sparse). */
  getAnalyticsHeatmap(period: AnalyticsPeriod): Observable<AnalyticsHeatmap> {
    return this.http.get<AnalyticsHeatmap>('/api/analytics/heatmap', { params: this.analyticsParams(period) });
  }

  /** GET /api/analytics/top-deployers — actor counts, descending. */
  getAnalyticsTopDeployers(period: AnalyticsPeriod, limit = 10): Observable<AnalyticsTopDeployers> {
    const params = this.analyticsParams(period).set('limit', limit);
    return this.http.get<AnalyticsTopDeployers>('/api/analytics/top-deployers', { params });
  }

  /** GET /api/analytics/incidents — worst-first restoration incidents. */
  getAnalyticsIncidents(period: AnalyticsPeriod, limit = 10): Observable<AnalyticsIncidents> {
    const params = this.analyticsParams(period).set('limit', limit);
    return this.http.get<AnalyticsIncidents>('/api/analytics/incidents', { params });
  }
}
