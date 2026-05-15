// Thin REST client for the Read API. Adapts snake_case wire shapes to the
// camelCase models used by the rest of the SPA.
//
// SAD §5 NFR-04 + §10 Decision #7 — the SPA is READ-ONLY against the API.
// `PATCH /api/config/topology` is admin / CI / ops tooling only and has
// no client wiring here. The SPA never carries the `X-Api-Key` header.
//
// SAD §7 "API Contract" → "GET /api/deployments — query parameters" —
// every matrix fetch optionally appends the user's per-tab picker
// preference as `correlationAttribute=<value>`.

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  adaptHistoryEntry,
  adaptMatrix,
  adaptTopologyConfig,
  type EnvironmentDescriptor,
  type HistoryEntry,
  type MatrixState,
  type ServiceDescriptor,
  type TopologyConfig,
  type TopologyState,
  type WireHistoryEntry,
  type WireMatrix,
  type WireTopologyConfig
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);

  /**
   * Fetch the matrix + per-service topology (FR-13).
   *
   * `correlationAttribute` — when supplied (the user has an explicit picker
   * preference), appended as a query parameter. Omitted otherwise so the
   * server-side default applies (SAD §"GET /api/deployments — query
   * parameters" — absence = follow the server default).
   */
  matrix(
    correlationAttribute?: string | null
  ): Observable<{ matrix: MatrixState; topology: TopologyState }> {
    let params = new HttpParams();
    if (correlationAttribute) {
      params = params.set('correlationAttribute', correlationAttribute);
    }
    return this.http
      .get<WireMatrix>('/api/deployments', { params })
      .pipe(map(adaptMatrix));
  }

  history(service: string, environment: string): Observable<HistoryEntry[]> {
    const url = `/api/deployments/${encodeURIComponent(service)}/${encodeURIComponent(environment)}/history`;
    return this.http.get<WireHistoryEntry[]>(url).pipe(
      map(entries => entries.map(adaptHistoryEntry))
    );
  }

  /**
   * Returns environments in promotion-flow order as supplied by the API.
   * The frontend never re-orders this list (FR-09).
   */
  environments(): Observable<EnvironmentDescriptor[]> {
    return this.http.get<string[]>('/api/environments').pipe(
      map(ids => ids.map(id => ({ id, label: id.toUpperCase() })))
    );
  }

  services(): Observable<ServiceDescriptor[]> {
    return this.http.get<string[]>('/api/services').pipe(
      map(ids => ids.map(id => ({ id, name: id })))
    );
  }

  /**
   * GET /api/config/topology — server-side correlation defaults (FR-13).
   *
   * SAD §10 Decision #7 — read-only to the SPA. The result feeds the
   * picker's "system default" label so users can distinguish their own
   * override from the server fallback. The SPA never PATCHes this
   * endpoint; CI/ops tooling owns those writes.
   */
  topologyConfig(): Observable<TopologyConfig> {
    return this.http.get<WireTopologyConfig>('/api/config/topology').pipe(
      map(adaptTopologyConfig)
    );
  }
}
