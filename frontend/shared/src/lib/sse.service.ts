// Browser-native EventSource wrapper. Lives in the shared lib (touches
// browser globals, so feature libs can stay DOM-free in unit tests).
//
// SAD §7 "SSE topology semantics" — `slot-update` events carry the slot
// state only. Topology is not on the wire; the SPA fetches it via a
// follow-up `GET /api/deployments?correlationAttribute=…` per event. We
// expose `slotUpdates$` here and let the app component drive the GET
// refresh (with burst coalescing) so this service stays a pure transport.
//
// Reconnect strategy:
//  - EventSource reconnects automatically and re-emits the Last-Event-ID
//    header, which the backend uses to replay missed events.
//  - On a manual error/close we layer exponential backoff on top, capped at
//    30 s, and re-emit a `reconnected` signal so the store can re-pull the
//    full matrix once via REST to recover from any gap (NFR-03).

import { DestroyRef, Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import type { SlotUpdatePayload, WireSlotUpdatePayload } from './models';
import { adaptSlotState } from './models';

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

@Injectable({ providedIn: 'root' })
export class SseService {
  private source: EventSource | null = null;
  private backoff = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  readonly slotUpdates$ = new Subject<SlotUpdatePayload>();
  readonly reconnected$ = new Subject<void>();
  readonly opened$ = new Subject<void>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Opens the SSE connection. Safe to call once during app bootstrap. */
  connect(url = '/api/stream'): void {
    if (this.source) return;
    this.open(url);
  }

  /** Closes the connection permanently (e.g. on logout). */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private open(url: string): void {
    const es = new EventSource(url);
    this.source = es;

    es.addEventListener('open', () => {
      const wasReconnect = this.backoff !== INITIAL_BACKOFF_MS;
      this.backoff = INITIAL_BACKOFF_MS;
      this.opened$.next();
      if (wasReconnect) this.reconnected$.next();
    });

    es.addEventListener('slot-update', (event: MessageEvent) => {
      try {
        const wire = JSON.parse(event.data) as WireSlotUpdatePayload;
        const state = adaptSlotState(wire.state);
        if (!state) return;
        // SAD §7 "SSE topology semantics" — we deliberately do NOT consume
        // any `topology` field that may exist on the wire during a
        // transition. The matrix GET endpoint is the single source of truth
        // for topology; the app component refreshes it on every event.
        this.slotUpdates$.next({
          service: wire.service,
          environment: wire.environment,
          state
        });
      } catch {
        // Malformed payload — skip; backend is the contract owner.
      }
    });

    es.addEventListener('error', () => {
      // EventSource transitions to CLOSED on terminal errors; layer our own
      // backoff on top so we never tight-loop.
      if (es.readyState === EventSource.CLOSED) {
        this.scheduleReconnect(url);
      }
      // For transient (CONNECTING) errors the browser will retry; no action.
    });
  }

  private scheduleReconnect(url: string): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open(url);
    }, delay);
  }
}
