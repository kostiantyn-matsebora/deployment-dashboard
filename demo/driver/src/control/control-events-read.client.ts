import { Injectable } from '@nestjs/common';
import { getConfig } from '../config/configuration';

/** Subset of upstream query params that this proxy is permitted to forward. */
export interface ControlEventsQuery {
  component_id?: string;
  event_type?:   string;
  since?:        string;
  cursor?:       string;
  limit?:        string;
}

/** Upstream response envelope: status code + parsed body. */
export interface ControlEventsResponse {
  status: number;
  body:   unknown;
}

/**
 * Read client for GET /api/control/events.
 *
 * Unauthenticated — the upstream endpoint is a public read surface (§4.9 spec;
 * openapi.yaml `GET /api/control/events` has no security requirement).
 *
 * Uses globalThis.fetch so tests can substitute the fetch implementation.
 * Non-2xx responses are returned as-is (status + body) rather than thrown, so
 * the controller can mirror the upstream status code to the browser caller.
 */
@Injectable()
export class ControlEventsReadClient {
  async list(query: ControlEventsQuery): Promise<ControlEventsResponse> {
    const config = getConfig();
    const url    = this._buildUrl(config.writeApiUrl, query);

    let response: Response;
    try {
      response = await (globalThis.fetch as typeof fetch)(url, { method: 'GET' });
    } catch (err) {
      // Network-level failure — surface as 502 Bad Gateway so the controller
      // can forward a sensible status rather than a 500.
      console.warn('[demo-driver] control-events GET network error:', err);
      return { status: 502, body: { error: 'upstream network error' } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { status: response.status, body };
  }

  private _buildUrl(baseUrl: string, query: ControlEventsQuery): string {
    const params = new URLSearchParams();

    if (query.component_id !== undefined) params.set('component_id', query.component_id);
    if (query.event_type   !== undefined) params.set('event_type',   query.event_type);
    if (query.since        !== undefined) params.set('since',        query.since);
    if (query.cursor       !== undefined) params.set('cursor',       query.cursor);
    if (query.limit        !== undefined) params.set('limit',        query.limit);

    const qs = params.toString();
    return qs
      ? `${baseUrl}/api/control/events?${qs}`
      : `${baseUrl}/api/control/events`;
  }
}
