import { Injectable } from '@nestjs/common';
import { getConfig } from '../config/configuration';

/** Upstream response envelope: HTTP status + parsed body (or null on parse failure). */
export interface GithubProxyResponse {
  status: number;
  body:   unknown;
}

/**
 * HTTP client for the github-emulator's /_github/* control surface.
 *
 * Forwards requests verbatim (body + query) to {GITHUB_EMULATOR_URL}/_github/*.
 * Non-2xx responses are returned as-is (status + body) so the controller can
 * mirror the upstream status code to the browser caller.
 *
 * Uses globalThis.fetch so tests can substitute the fetch implementation.
 */
@Injectable()
export class GithubProxyClient {
  async get(path: string): Promise<GithubProxyResponse> {
    return this._request('GET', path, undefined);
  }

  async post(path: string, body: unknown): Promise<GithubProxyResponse> {
    return this._request('POST', path, body);
  }

  private async _request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
  ): Promise<GithubProxyResponse> {
    const config = getConfig();
    const url    = `${config.githubEmulatorUrl}/_github/${path}`;

    const init: RequestInit = {
      method,
      signal: AbortSignal.timeout(config.githubEmulatorTimeoutMs),
    };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body    = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await (globalThis.fetch as typeof fetch)(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        console.warn(
          `[demo-driver] github-proxy ${method} /_github/${path} timed out after ${config.githubEmulatorTimeoutMs}ms`,
        );
        return { status: 504, body: { error: 'upstream timeout' } };
      }
      console.warn(`[demo-driver] github-proxy ${method} /_github/${path} network error:`, err);
      return { status: 502, body: { error: 'upstream network error' } };
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }

    return { status: response.status, body: parsedBody };
  }
}
