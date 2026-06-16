import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, fromEventPattern } from 'rxjs';
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
} from '../models/deployment.model';

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
 */
@Injectable({ providedIn: 'root' })
export class DeploymentApiService {
  private readonly http = inject(HttpClient);

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
   * GET /api/events/stream — SSE fan-out of newly-ingested events.
   *
   * Returns a live Observable<DeploymentEvent>. Caller is responsible for
   * unsubscribing (which closes the EventSource).
   *
   * EventSource automatically sends Last-Event-ID on reconnect; the server
   * replays missed events from that cursor (spec §7 SSE + LISTEN/NOTIFY).
   */
  streamEvents(options?: { service?: string; onOpen?: () => void; onError?: () => void }): Observable<DeploymentEvent> {
    let url = '/api/events/stream';
    if (options?.service) {
      url += `?service=${encodeURIComponent(options.service)}`;
    }

    return fromEventPattern<DeploymentEvent>(
      (handler) => {
        const es = new EventSource(url);
        es.onopen  = () => options?.onOpen?.();
        es.onerror = () => options?.onError?.();
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

  /**
   * Open an EventSource for SSE — lower-level access for services that need
   * to observe readyState (live indicator).
   */
  openEventSource(options?: { service?: string }): EventSource {
    let url = '/api/events/stream';
    if (options?.service) {
      url += `?service=${encodeURIComponent(options.service)}`;
    }
    return new EventSource(url);
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

  /**
   * GET /api/control/events/stream — SSE fan-out of component events.
   *
   * Returns a live Observable<ComponentEventRecord>. Caller is responsible for
   * unsubscribing (which closes the EventSource).
   *
   * Event name on the wire is "component" (not "message").
   * Source: docs/api/api-guidelines.md §11 SSE component-events stream.
   */
  streamComponentEvents(): Observable<ComponentEventRecord> {
    const url = '/api/control/events/stream';

    return fromEventPattern<ComponentEventRecord>(
      (handler) => {
        const es = new EventSource(url);
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
    );
  }
}
