type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number }>;

export interface ResetResult {
  ok:          boolean;
  http_status: number;
}

/**
 * Thin HTTP client for the Control surface.
 *
 * Sends POST /api/control/reset with X-Control-API-Key — a distinct secret
 * from X-Api-Key (openapi.yaml §securitySchemes/controlApiKey).
 * No retry — destructive operation, single attempt only.
 */
export class ControlApiClient {
  private readonly _fetch: FetchFn;

  constructor(
    private readonly writeApiUrl:    string,
    private readonly controlApiKey:  string,
    fetchFn?: FetchFn,
  ) {
    this._fetch = fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  }

  async resetApi(): Promise<ResetResult> {
    try {
      const response = await this._fetch(`${this.writeApiUrl}/api/control/reset`, {
        method:  'POST',
        headers: { 'X-Control-API-Key': this.controlApiKey },
      });
      return {
        ok:          response.status >= 200 && response.status < 300,
        http_status: response.status,
      };
    } catch {
      return { ok: false, http_status: 0 };
    }
  }
}
