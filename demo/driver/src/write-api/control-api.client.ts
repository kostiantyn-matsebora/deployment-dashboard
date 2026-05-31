type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface ResetResult {
  ok:          boolean;
  http_status: number;
  reset_id?:   string;
}

/**
 * Thin HTTP client for the Control surface.
 *
 * Sends POST /api/control/reset with X-Control-API-Key — a distinct secret
 * from X-Api-Key (openapi.yaml §securitySchemes/controlApiKey).
 * No retry — destructive operation, single attempt only.
 *
 * Returns 202 Accepted with { reset_id, state } body (ResetAccepted).
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
    try {
      const response = await this._fetch(`${this.writeApiUrl}/api/control/reset`, {
        method:  'POST',
        headers: { 'X-Control-API-Key': this.controlApiKey },
      });
      const ok = response.status >= 200 && response.status < 300;
      let reset_id: string | undefined;
      if (ok) {
        try {
          const body = await response.json() as Record<string, unknown>;
          reset_id = body?.reset_id as string | undefined;
        } catch {
          // Non-JSON body — reset_id stays undefined.
        }
      }
      return { ok, http_status: response.status, reset_id };
    } catch {
      return { ok: false, http_status: 0 };
    }
  }
}
