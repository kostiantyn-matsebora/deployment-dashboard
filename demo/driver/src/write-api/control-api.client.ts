type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface ResetResult {
  ok:          boolean;
  http_status: number;
  reset_id?:   string;
}

export interface RecoverInput {
  days_back: number;
}

export interface RecoverResult {
  ok:              boolean;
  http_status:     number;
  correlation_id?: string;
  since?:          string;
}

/**
 * Thin HTTP client for the Control surface.
 *
 * Sends POST /api/control/reset with X-Control-API-Key — a distinct secret
 * from X-Api-Key (openapi.yaml §securitySchemes/controlApiKey).
 * No retry — destructive operation, single attempt only.
 *
 * Returns 202 Accepted with { reset_id, state } body (ResetAccepted).
 *
 * Also sends POST /api/control/recover (#423, D18) — non-destructive
 * counterpart, gated by the same X-Control-API-Key. No retry — mirrors
 * reset's single-attempt policy. Returns 202 Accepted with
 * { correlation_id, state, since, accepted_at } (RecoverAccepted).
 */
export class ControlApiClient {
  private readonly _fetch: FetchFn;

  constructor(
    private readonly writeApiUrl:    string,
    private readonly controlApiKey:  string,
    fetchFn?: FetchFn,
  ) {
    this._fetch = fetchFn ?? ((url, init) => globalThis.fetch(url, init) as Promise<{ status: number; json(): Promise<unknown> }>);
  }

  async resetApi(): Promise<ResetResult> {
    const { ok, http_status, body } = await this._postControlAction('/api/control/reset', {
      method:  'POST',
      headers: { 'X-Control-API-Key': this.controlApiKey },
    });
    return { ok, http_status, reset_id: body?.reset_id as string | undefined };
  }

  async recoverApi(input: RecoverInput): Promise<RecoverResult> {
    const { ok, http_status, body } = await this._postControlAction('/api/control/recover', {
      method:  'POST',
      headers: {
        'X-Control-API-Key': this.controlApiKey,
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({ days_back: input.days_back }),
    });
    return {
      ok,
      http_status,
      correlation_id: body?.correlation_id as string | undefined,
      since:          body?.since as string | undefined,
    };
  }

  private async _postControlAction(
    path: string,
    init: RequestInit,
  ): Promise<{ ok: boolean; http_status: number; body?: Record<string, unknown> }> {
    try {
      const response = await this._fetch(`${this.writeApiUrl}${path}`, init);
      const ok = response.status >= 200 && response.status < 300;
      let body: Record<string, unknown> | undefined;
      if (ok) {
        try {
          body = await response.json() as Record<string, unknown>;
        } catch {
          // Non-JSON body — body stays undefined.
        }
      }
      return { ok, http_status: response.status, body };
    } catch {
      return { ok: false, http_status: 0 };
    }
  }
}
