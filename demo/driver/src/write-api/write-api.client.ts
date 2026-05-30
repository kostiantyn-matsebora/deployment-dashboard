// DeploymentEventIngest wire shape — elapsed_minutes already removed by runner.
export type WireEvent = Record<string, unknown>;

export interface PostResult {
  ok: boolean;
  status: number;
}

type FetchFn = (url: string, init: RequestInit) => Promise<{ status: number }>;
type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Thin HTTP client for POST /api/deployments.
 *
 * Retry policy (D6 / §6):
 *  - 3 attempts, exponential backoff: 100 ms → 200 ms → 400 ms.
 *  - Retry on network error or 5xx.
 *  - No retry on 4xx (client error).
 */
export class WriteApiClient {
  private readonly _fetch: FetchFn;
  private readonly _sleep: SleepFn;

  constructor(
    private readonly writeApiUrl: string,
    private readonly apiKey: string,
    private readonly progressReporter: string,
    fetchFn?: FetchFn,
    sleepFn?: SleepFn,
  ) {
    this._fetch = fetchFn ?? ((url, init) => globalThis.fetch(url, init));
    this._sleep = sleepFn ?? defaultSleep;
  }

  async postDeployment(event: WireEvent): Promise<PostResult> {
    const url = `${this.writeApiUrl}/api/deployments`;
    const maxAttempts = 3;
    let lastStatus = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this._fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type':       'application/json',
            'X-Api-Key':          this.apiKey,
            'X-Progress-Reporter': this.progressReporter,
          },
          body: JSON.stringify(event),
        });

        lastStatus = response.status;

        if (response.status >= 200 && response.status < 300) {
          return { ok: true, status: response.status };
        }

        // 4xx — no retry
        if (response.status >= 400 && response.status < 500) {
          return { ok: false, status: response.status };
        }

        // 5xx — fall through to backoff + retry
      } catch {
        // Network error — fall through to backoff + retry
      }

      if (attempt < maxAttempts) {
        await this._sleep(100 * Math.pow(2, attempt - 1));
      }
    }

    return { ok: false, status: lastStatus };
  }
}
