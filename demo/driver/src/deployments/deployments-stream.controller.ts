import { Controller, Get, Headers, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { getConfig } from '../config/configuration';

/**
 * Passthrough SSE proxy for GET /api/events/stream.
 *
 * Re-broadcasts the upstream deployment event stream verbatim so the browser
 * control panel can consume it same-origin, regardless of which component
 * (demo-driver, fetcher, or any other pusher) produced the events.
 *
 * Design notes (§4 task spec):
 * - Per-connection passthrough — no shared subscriber / RxJS fan-out.
 *   The upstream is unauthenticated; each browser connection opens its own
 *   upstream fetch, which is correct and simple.
 * - Last-Event-ID forwarded from the incoming request header.
 * - Optional ?service= query param forwarded to the upstream.
 * - AbortController cancels the upstream fetch on client disconnect.
 * - Upstream unreachable → log + end response; never throws.
 * - Explicitly exempt from the reset gate (NOT registered with the demo
 *   controller's guardNotBlocked; it is a data feed, not an interactive control).
 */
@Controller('demo')
export class DeploymentsStreamController {
  /**
   * GET /demo/deployments-stream
   *
   * Headers forwarded upstream  : Last-Event-ID (if present)
   * Query params forwarded       : service (if present)
   * Response content-type        : text/event-stream
   */
  @Get('deployments-stream')
  async deploymentsStream(
    @Headers('last-event-id') lastEventId: string | undefined,
    @Query('service') service: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache, no-transform');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const abort  = new AbortController();

    req.on('close', () => {
      abort.abort();
    });

    await this._pipe(lastEventId, service, res, abort.signal);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async _pipe(
    lastEventId: string | undefined,
    service:     string | undefined,
    res:         Response,
    signal:      AbortSignal,
  ): Promise<void> {
    const config  = getConfig();
    const url     = this._buildUpstreamUrl(config.writeApiUrl, service);
    const headers: Record<string, string> = {};

    if (lastEventId) {
      headers['Last-Event-ID'] = lastEventId;
    }

    let response: globalThis.Response;
    try {
      response = await (globalThis.fetch as typeof fetch)(url, {
        method: 'GET',
        headers,
        signal,
      });
    } catch (err) {
      if (signal.aborted) {
        // Client disconnected before the upstream responded — normal path.
        try { res.end(); } catch {}
        return;
      }
      console.warn('[demo-driver] deployments-stream upstream fetch failed:', err);
      try { res.end(); } catch {}
      return;
    }

    if (!response.ok || !response.body) {
      console.warn(
        `[demo-driver] deployments-stream upstream returned HTTP ${response.status}`,
      );
      try { res.end(); } catch {}
      return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        try {
          res.write(chunk);
        } catch {
          // Client already disconnected mid-stream.
          break;
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        console.warn('[demo-driver] deployments-stream read error:', err);
      }
    } finally {
      // reader.cancel() returns a Promise. On client disconnect (page refresh,
      // tab close, or navigation) the abort errors the upstream body stream, so
      // cancel() *rejects* with that AbortError. A synchronous try/catch cannot
      // catch a rejected Promise — it would float as an unhandledRejection and
      // crash the process — so we attach a .catch() to swallow it.
      void reader.cancel().catch(() => {});
      try { res.end(); } catch {}
    }
  }

  private _buildUpstreamUrl(baseUrl: string, service: string | undefined): string {
    if (service) {
      return `${baseUrl}/api/events/stream?service=${encodeURIComponent(service)}`;
    }
    return `${baseUrl}/api/events/stream`;
  }
}
