import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ResetCoordinator } from './reset-coordinator';
import { RecoverAckHandler } from './recover-ack-handler';
import { ControlFeed } from './control-feed';
import { getConfig } from '../config/configuration';

interface SseEvent {
  id?:   string;
  type?: string;
  data?: string;
}

const INITIAL_BACKOFF_MS  = 1_000;
const MAX_BACKOFF_MS      = 60_000;
const BACKOFF_MULTIPLIER  = 2;

/**
 * Long-lived subscriber to GET /api/control/stream?component=<componentId>.
 *
 * Uses fetch() + ReadableStream (NOT browser EventSource — custom headers
 * required per §11 api-guidelines).
 *
 * Handles:
 * - Last-Event-ID reconnect (§11 api-guidelines).
 * - Heartbeat (`: ping`) comments — silently ignored.
 * - Unknown event types — no-op (forward-compatibility).
 * - Connect failures — log + exponential backoff retry; NEVER crashes the process.
 *
 * Dispatches reset-initiated / reset-started / reset-completed to
 * ResetCoordinator, and recover-initiated / recover-started /
 * recover-completed to RecoverAckHandler (#423, D18) — a separate
 * participant so the non-destructive recover choreography never touches
 * ResetCoordinator's block state.
 */
@Injectable()
export class ControlStreamSubscriber implements OnModuleInit, OnModuleDestroy {
  private _lastEventId:  string | null = null;
  private _stopped       = false;
  private _backoffMs     = INITIAL_BACKOFF_MS;
  private _currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    private readonly coordinator:      ResetCoordinator,
    private readonly controlFeed:      ControlFeed,
    private readonly recoverHandler:   RecoverAckHandler,
  ) {}

  onModuleInit(): void {
    // Start the subscriber loop asynchronously — never await, never crash.
    this._connectLoop().catch(err => {
      console.error('[demo-driver] control-stream subscriber fatal error:', err);
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
          `[demo-driver] control-stream connect failed — retry in ${this._backoffMs} ms:`,
          err,
        );
        await this._sleep(this._backoffMs);
        this._backoffMs = Math.min(this._backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
      }
    }
  }

  private async _connect(): Promise<void> {
    const config  = getConfig();
    const headers: Record<string, string> = {
      'X-Control-API-Key': config.controlApiKey,
    };
    if (this._lastEventId) {
      headers['Last-Event-ID'] = this._lastEventId;
    }

    const url = `${config.writeApiUrl}/api/control/stream?component=${encodeURIComponent(config.componentId)}`;

    // Use globalThis.fetch so tests can substitute it.
    const response = await (globalThis.fetch as typeof fetch)(url, {
      method:  'GET',
      headers,
    });

    if (!response.ok || !response.body) {
      throw new Error(`control-stream HTTP ${response.status}`);
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
          await this._dispatch(evt);
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

  private async _dispatch(evt: SseEvent): Promise<void> {
    if (evt.id) {
      this._lastEventId = evt.id;
    }

    // Publish every parsed frame — including unknown types — to the in-process
    // fan-out so GET /demo/control-stream panel connections receive it.
    this.controlFeed.publish(evt);

    switch (evt.type) {
      case 'reset-initiated': {
        // The correlation_id IS the event id (§4.7 spec + choreography diagram).
        const resetId = evt.id ?? this._parseCorrelationId(evt.data);
        if (resetId) {
          await this.coordinator.onResetInitiated(resetId);
        }
        break;
      }
      case 'reset-started': {
        const resetId = this._parseCorrelationId(evt.data);
        if (resetId) {
          this.coordinator.onResetStarted(resetId);
        }
        break;
      }
      case 'reset-completed': {
        const resetId = this._parseCorrelationId(evt.data);
        if (resetId) {
          await this.coordinator.onResetCompleted(resetId);
        }
        break;
      }
      case 'recover-initiated': {
        // Same shape as reset-initiated — the correlation_id IS the event id.
        const correlationId = evt.id ?? this._parseCorrelationId(evt.data);
        if (correlationId) {
          await this.recoverHandler.onRecoverInitiated(correlationId);
        }
        break;
      }
      case 'recover-started': {
        const correlationId = this._parseCorrelationId(evt.data);
        if (correlationId) {
          this.recoverHandler.onRecoverStarted(correlationId);
        }
        break;
      }
      case 'recover-completed': {
        const correlationId = this._parseCorrelationId(evt.data);
        if (correlationId) {
          await this.recoverHandler.onRecoverCompleted(correlationId);
        }
        break;
      }
      default:
        // Unknown type — no-op (forward-compatibility per §4.7).
        break;
    }
  }

  private _parseCorrelationId(data?: string): string | null {
    if (!data) return null;
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      return (parsed.correlation_id as string) ?? (parsed.id as string) ?? null;
    } catch {
      return null;
    }
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
