import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ControlEventsClient } from './control-events.client';
import { getConfig } from '../config/configuration';

export type ResetState = 'idle' | 'blocked';

export interface ResetParticipant {
  /** Stop any running ingest/scenario and disable live emission. */
  stopWork(): void;
  /** Re-enable the control surface (does not auto-restart work). */
  unblockWork(): void;
}

/**
 * Reset lifecycle coordinator — the demo-driver's single point of truth for
 * API-driven reset participation (§4.7 DEMO_DRIVER_SPECIFICATION).
 *
 * State machine:
 *   idle ──reset-initiated──► blocked ──reset-completed──► idle
 *                                │
 *                       RESET_GATE_MAX_TTL_MS (safety unblock, no running ack)
 *
 * reset-started: no-op (already blocked from reset-initiated).
 */
@Injectable()
export class ResetCoordinator implements OnModuleDestroy {
  private _resetState: ResetState = 'idle';
  private _resetId:    string | null = null;
  private _safetyTimer: ReturnType<typeof setTimeout> | null = null;

  private _participant: ResetParticipant | null = null;
  private _eventsClient: ControlEventsClient | null = null;

  get resetState(): ResetState { return this._resetState; }
  get resetId():    string | null { return this._resetId; }

  /** Wired by the demo module after construction. */
  registerParticipant(p: ResetParticipant): void {
    this._participant = p;
  }

  registerEventsClient(c: ControlEventsClient): void {
    this._eventsClient = c;
  }

  onModuleDestroy(): void {
    this._clearSafetyTimer();
  }

  // ── Event handlers (called by ControlStreamSubscriber) ───────────────────

  async onResetInitiated(resetId: string): Promise<void> {
    if (this._resetState === 'blocked') {
      // Already blocked — duplicate event; ignore.
      return;
    }

    this._resetState = 'blocked';
    this._resetId    = resetId;

    // 1. Stop work; the participant disables ingest/emission.
    this._participant?.stopWork();

    // 2. Start local safety unblock timer.
    this._startSafetyTimer();

    // 3. Post reset-ack (paused) to the API.
    if (this._eventsClient) {
      await this._eventsClient.postResetAck(resetId);
    }
  }

  /** no-op — already blocked from reset-initiated. */
  onResetStarted(_resetId: string): void {
    // Intentional no-op per spec §4.7.
  }

  async onResetCompleted(resetId: string): Promise<void> {
    if (this._resetState !== 'blocked') return;

    const completedResetId = resetId ?? this._resetId ?? '';
    await this._recover(completedResetId, /* postRunning */ true);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _startSafetyTimer(): void {
    this._clearSafetyTimer();
    const config = getConfig();
    this._safetyTimer = setTimeout(async () => {
      if (this._resetState !== 'blocked') return;
      console.warn(
        '[demo-driver] RESET_GATE_MAX_TTL_MS elapsed without reset-completed — ' +
        'safety-unblocking (no running event will be posted)',
      );
      await this._recover(this._resetId ?? '', /* postRunning */ false);
    }, config.resetGateMaxTtlMs);
  }

  private _clearSafetyTimer(): void {
    if (this._safetyTimer !== null) {
      clearTimeout(this._safetyTimer);
      this._safetyTimer = null;
    }
  }

  private async _recover(resetId: string, postRunning: boolean): Promise<void> {
    this._clearSafetyTimer();
    this._participant?.unblockWork();

    if (postRunning && this._eventsClient && resetId) {
      await this._eventsClient.postStatusRunning(resetId);
    }

    this._resetState = 'idle';
    this._resetId    = null;
  }
}
