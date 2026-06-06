type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number }>;

export interface ResetAckPayload {
  event_type:  'reset-ack';
  state:       'paused';
  occurred_at: string;
  payload:     { reset_id: string };
}

export interface StatusPayload {
  event_type:  'status';
  state:       'running';
  occurred_at: string;
  payload:     { reset_id: string };
}

/**
 * POST /api/control/events — component event reporting.
 *
 * Auth:  X-Api-Key (same key used for ingest; §4 api-guidelines).
 * Ident: X-Component-Id header (required by server, §11 api-guidelines).
 * No retry — fire-and-forget; the server's 2 h retention window survives
 * transient failures; re-connection + replay handles recovery.
 */
export class ControlEventsClient {
  private readonly _fetch: FetchFn;

  constructor(
    private readonly writeApiUrl:  string,
    private readonly apiKey:       string,
    private readonly componentId:  string,
    fetchFn?: FetchFn,
  ) {
    this._fetch = fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  }

  async postResetAck(resetId: string): Promise<void> {
    const body: ResetAckPayload = {
      event_type:  'reset-ack',
      state:       'paused',
      occurred_at: new Date().toISOString(),
      payload:     { reset_id: resetId },
    };
    await this._postEvent(body, resetId);
  }

  async postStatusRunning(resetId: string): Promise<void> {
    const body: StatusPayload = {
      event_type:  'status',
      state:       'running',
      occurred_at: new Date().toISOString(),
      payload:     { reset_id: resetId },
    };
    await this._postEvent(body, resetId);
  }

  private async _postEvent(
    body: ResetAckPayload | StatusPayload,
    correlationId?: string,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type':   'application/json; charset=utf-8',
      'X-Api-Key':      this.apiKey,
      'X-Component-Id': this.componentId,
    };

    if (correlationId !== undefined) {
      headers['X-Correlation-Id'] = correlationId;
    }

    try {
      await this._fetch(`${this.writeApiUrl}/api/control/events`, {
        method: 'POST',
        headers,
        body:   JSON.stringify(body),
      });
    } catch (err) {
      console.warn('[demo-driver] control-events POST failed:', err);
    }
  }
}
