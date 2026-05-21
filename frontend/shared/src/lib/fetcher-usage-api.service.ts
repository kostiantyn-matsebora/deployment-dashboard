// Thin REST client for `GET /api/fetcher/usage` (CR-0011 § 3b / FR-19).
//
// SAD §5 NFR-04 — the SPA is READ-ONLY; this endpoint is unauthenticated
// (read group). No `X-Api-Key` is ever attached client-side.
//
// Wire shape is server-canonical snake_case (`upstream_used`, `received_at`,
// etc.) — no adapter is required because the cluster reads the same field
// names. Keeping the wire shape verbatim avoids two camelCase divergences
// (cluster aggregation rules + popover rows) and matches the locked Phase 3
// payload type (D5).

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import type { FetcherUsageResponse, FetcherUsageSnapshot } from './models';

@Injectable({ providedIn: 'root' })
export class FetcherUsageApiService {
  private readonly http = inject(HttpClient);

  /**
   * Returns the current `snapshots` array — always an array, never `null`,
   * never throws (cold-start = empty array per the spec).
   *
   * Errors collapse to an empty array so the cluster hides cleanly when the
   * backend is offline. Stale-affordance still fires on the previously
   * fetched data via the store's `nowTick`; an empty response is treated as
   * "cold start" rather than "data is old".
   */
  fetch(): Observable<readonly FetcherUsageSnapshot[]> {
    return this.http.get<FetcherUsageResponse>('/api/fetcher/usage').pipe(
      map(r => (Array.isArray(r?.snapshots) ? r.snapshots : [])),
      catchError((_err: HttpErrorResponse) => of([] as FetcherUsageSnapshot[]))
    );
  }
}
