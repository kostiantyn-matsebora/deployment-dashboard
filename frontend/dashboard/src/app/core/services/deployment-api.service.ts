import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, fromEventPattern } from 'rxjs';
import {
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
