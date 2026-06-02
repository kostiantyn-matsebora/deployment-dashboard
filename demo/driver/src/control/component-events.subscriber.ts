import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ComponentEventFeed } from './component-event-feed';
import { getConfig } from '../config/configuration';

interface SseEvent {
  id?:   string;
  type?: string;
  data?: string;
}

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 60_000;
const BACKOFF_MULTIPLIER = 2;

/**
 * Long-lived subscriber to GET /api/control/events/stream.
 *
 * Uses fetch() + ReadableStream (NOT browser EventSource — uniform reconnect
 * logic and future custom-header readiness per §4.9 spec).
 *
 * Handles:
 * - Last-Event-ID reconnect (§4.9 spec).
 * - Heartbeat (`: ping`) comments — silently ignored.
 * - Connect failures — log + exponential backoff retry; NEVER crashes the process.
 *
 * The endpoint is unauthenticated (openapi.yaml — no security requirement on
 * GET /api/control/events/stream).  No X-Control-API-Key or X-Api-Key header
 * is sent.
 *
 * Every parsed ComponentEventRecord frame is published to ComponentEventFeed
 * for in-process fan-out to GET /demo/control-events panel connections (§4.9).
 * There is no reset-coordinator dispatch here — component events are pure
 * observability; the subscriber only fans out.
 */
@Injectable()
export class ComponentEventsSubscriber implements OnModuleInit, OnModuleDestroy {
  private _lastEventId:  string | null = null;
  private _stopped       = false;
  private _backoffMs     = INITIAL_BACKOFF_MS;
  private _currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    private readonly componentEventFeed: ComponentEventFeed,
  ) {}

  onModuleInit(): void {
    // Start the subscriber loop asynchronously — never await, never crash.
    this._connectLoop().catch(err => {
      console.error('[demo-driver] component-events subscriber fatal error:', err);
    });
  }

  onModuleDestroy(): void {
    this._stopped = true;
    try { this._currentReader?.cancel(); } catch {}
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  private async _connectLoop(): Promise<void> {
    while (!this._stopped) {
      try {
        await this._connect();
        // Connection closed cleanly — reset backoff and reconnect immediately.
        this._backoffMs = INITIAL_BACKOFF_MS;
      } catch (err) {
        if (this._stopped) return;
        console.warn(
          `[demo-driver] component-events connect failed — retry in ${this._backoffMs} ms:`,
          err,
        );
        await this._sleep(this._backoffMs);
        this._backoffMs = Math.min(this._backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      }
    }
  }

  private async _connect(): Promise<void> {
    const config  = getConfig();
    const headers: Record<string, string> = {};

    // Endpoint is unauthenticated — no X-Control-API-Key or X-Api-Key header
    // sent (openapi.yaml GET /api/control/events/stream: no security requirement).
    if (this._lastEventId) {
      headers['Last-Event-ID'] = this._lastEventId;
    }

    const url = `${config.writeApiUrl}/api/control/events/stream`;

    // Use globalThis.fetch so tests can substitute it.
    const response = await (globalThis.fetch as typeof fetch)(url, {
      method:  'GET',
      headers,
    });

    if (!response.ok || !response.body) {
      throw new Error(`component-events HTTP ${response.status}`);
    }

    const reader   = response.body.getReader();
    this._currentReader = reader;
    const decoder  = new TextDecoder();
    let buffer     = '';

    try {
      while (!this._stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = this._extractEvents(buffer);
        buffer = events.remainder;
        for (const evt of events.parsed) {
          this._dispatch(evt);
        }
      }
    } finally {
      this._currentReader = null;
      try { reader.cancel(); } catch {}
    }
  }

  // ── SSE frame parsing ─────────────────────────────────────────────────────

  private _extractEvents(raw: string): { parsed: SseEvent[]; remainder: string } {
    const parsed:   SseEvent[] = [];
    const boundary  = /\n\n|\r\n\r\n/;
    let   rest      = raw;

    while (true) {
      const match = boundary.exec(rest);
      if (!match) break;
      const block = rest.slice(0, match.index);
      rest = rest.slice(match.index + match[0].length);
      if (block.trim() === '') continue;                // blank separator / ping
      const evt = this._parseBlock(block);
      if (evt) parsed.push(evt);
    }

    return { parsed, remainder: rest };
  }

  private _parseBlock(block: string): SseEvent | null {
    const lines = block.split(/\r?\n/);
    const evt: SseEvent = {};
    let hasField = false;

    for (const line of lines) {
      if (line.startsWith(':')) continue;              // comment / ping
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trimStart();
      if (field === 'id')    { evt.id   = value; hasField = true; }
      if (field === 'event') { evt.type = value; hasField = true; }
      if (field === 'data')  { evt.data = (evt.data ?? '') + value; hasField = true; }
    }

    return hasField ? evt : null;
  }

  // ── Event dispatch ────────────────────────────────────────────────────────

  private _dispatch(evt: SseEvent): void {
    if (evt.id) {
      this._lastEventId = evt.id;
    }

    // Publish every parsed frame to the in-process fan-out so GET /demo/control-events
    // panel connections receive it (§4.9 — pure observability, no coordinator dispatch).
    this.componentEventFeed.publish(evt);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
