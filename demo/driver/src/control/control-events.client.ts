type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number }>;

export interface ResetAckPayload {
  event_type:  'reset-ack';
  state:       'paused';
  occurred_at: string;
}

export interface StatusPayload {
  event_type:  'status';
  state:       'running';
  occurred_at: string;
}

export interface RunStatusPayload {
  event_type:  'status';
  state:       'running' | 'idle';
  occurred_at: string;
  payload?:    { detail: string };
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
    };
    await this._postEvent(body, resetId);
  }

  async postStatusRunning(resetId: string): Promise<void> {
    const body: StatusPayload = {
      event_type:  'status',
      state:       'running',
      occurred_at: new Date().toISOString(),
    };
    await this._postEvent(body, resetId);
  }

  /** Post a run-start status event (event_type=status, state=running) correlated by runId. */
  async postRunStart(runId: string, detail?: string): Promise<void> {
    const body: RunStatusPayload = {
      event_type:  'status',
      state:       'running',
      occurred_at: new Date().toISOString(),
      ...(detail !== undefined ? { payload: { detail } } : {}),
    };
    await this._postEvent(body, runId);
  }

  /** Post a run-complete status event (event_type=status, state=idle) correlated by runId. */
  async postRunComplete(runId: string): Promise<void> {
    const body: RunStatusPayload = {
      event_type:  'status',
      state:       'idle',
      occurred_at: new Date().toISOString(),
    };
    await this._postEvent(body, runId);
  }

  private async _postEvent(
    body: ResetAckPayload | StatusPayload | RunStatusPayload,
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
