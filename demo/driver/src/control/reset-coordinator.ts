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

/** Callback invoked when the awaited reset cycle completes (normally or via timeout). */
type CycleCompleteCallback = (timedOut: boolean) => void;

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

  /**
   * Tracks the reset_id of the most recently completed cycle.
   * Used to resolve awaitCycleComplete() immediately when completion has
   * already been observed before the caller starts awaiting (race-safe).
   */
  private _lastCompletedResetId: string | null = null;

  /**
   * A reset_id that the driver has explicitly declared it expects to see.
   * Set via expectCycle() immediately after POST /api/control/reset returns,
   * before the SSE reset-initiated event has arrived.  Prevents the idle
   * fast-path in awaitCycleComplete() from resolving prematurely for that id.
   */
  private _expectedResetId: string | null = null;

  /**
   * Pending awaitCycleComplete() subscribers, keyed by reset_id.
   * Each entry is an array of callbacks that resolve/reject the caller's Promise.
   */
  private _cycleWaiters: Map<string, CycleCompleteCallback[]> = new Map();

  get resetState(): ResetState { return this._resetState; }
  get resetId():    string | null { return this._resetId; }

  /**
   * Declares that the driver has initiated cycle `resetId` and expects the
   * corresponding SSE events to arrive shortly.
   *
   * Must be called immediately after POST /api/control/reset returns a
   * reset_id and BEFORE awaitCycleComplete() is called for that id.  This
   * prevents awaitCycleComplete() from fast-resolving on the idle fast-path
   * during the window between the HTTP response and the SSE reset-initiated
   * event.
   *
   * A no-op when `resetId` matches `_lastCompletedResetId` (cycle already
   * done — awaitCycleComplete will take the race-safe fast path anyway).
   */
  expectCycle(resetId: string): void {
    if (resetId === this._lastCompletedResetId) return;
    this._expectedResetId = resetId;
  }

  /** Wired by the demo module after construction. */
  registerParticipant(p: ResetParticipant): void {
    this._participant = p;
  }

  registerEventsClient(c: ControlEventsClient): void {
    this._eventsClient = c;
  }

  onModuleDestroy(): void {
    this._clearSafetyTimer();
    this._drainWaiters(true);
  }

  // ── Event handlers (called by ControlStreamSubscriber) ───────────────────

  async onResetInitiated(resetId: string): Promise<void> {
    if (this._resetState === 'blocked') {
      // Already blocked — duplicate event; ignore.
      return;
    }

    this._resetState = 'blocked';
    this._resetId    = resetId;

    // Clear any pending expectation now that the cycle is officially tracked.
    if (this._expectedResetId === resetId) {
      this._expectedResetId = null;
    }

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

  // ── awaitCycleComplete ────────────────────────────────────────────────────

  /**
   * Resolves when the reset cycle identified by `resetId` has completed, or
   * immediately if it already completed before this call (race-safe).
   *
   * On timeout (bounded by `RESET_GATE_MAX_TTL_MS` or the caller-supplied
   * `timeoutMs`) the Promise resolves (not rejects) with a warning so that
   * the ingest caller can still proceed.
   *
   * It is safe to call this while onResetInitiated is still being awaited by
   * the coordinator because awaitCycleComplete only reads state and registers
   * a callback — it does not invoke stopWork/unblockWork itself.
   */
  awaitCycleComplete(resetId: string, timeoutMs?: number): Promise<void> {
    // Race-safe fast path: the cycle already completed before we got here.
    if (this._lastCompletedResetId === resetId) {
      return Promise.resolve();
    }

    // If the coordinator is idle and this reset_id was never tracked, the
    // cycle either completed before this instance started tracking, or the
    // reset_id is stale. Resolve immediately rather than hanging.
    //
    // Exception: when expectCycle() has been called for this id the driver
    // knows the SSE reset-initiated event has not arrived yet.  Skip the
    // fast-path and register a waiter so we block until the full cycle
    // completes (or the timeout fires).
    if (this._resetState === 'idle' && this._resetId !== resetId && this._expectedResetId !== resetId) {
      return Promise.resolve();
    }

    const config    = getConfig();
    const effectiveTimeout = timeoutMs ?? config.resetGateMaxTtlMs;

    return new Promise<void>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._removeWaiter(resetId, onComplete);
        console.warn(
          `[demo-driver] awaitCycleComplete(${resetId}) timed out after ` +
          `${effectiveTimeout} ms — proceeding with ingest (reset may still be in progress)`,
        );
        resolve();
      }, effectiveTimeout);

      const onComplete: CycleCompleteCallback = (_timedOut: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      this._addWaiter(resetId, onComplete);
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _addWaiter(resetId: string, cb: CycleCompleteCallback): void {
    const existing = this._cycleWaiters.get(resetId) ?? [];
    existing.push(cb);
    this._cycleWaiters.set(resetId, existing);
  }

  private _removeWaiter(resetId: string, cb: CycleCompleteCallback): void {
    const existing = this._cycleWaiters.get(resetId);
    if (!existing) return;
    const filtered = existing.filter(c => c !== cb);
    if (filtered.length === 0) {
      this._cycleWaiters.delete(resetId);
    } else {
      this._cycleWaiters.set(resetId, filtered);
    }
  }

  private _notifyWaiters(resetId: string, timedOut: boolean): void {
    const callbacks = this._cycleWaiters.get(resetId) ?? [];
    this._cycleWaiters.delete(resetId);
    for (const cb of callbacks) {
      cb(timedOut);
    }
  }

  /** Drain all pending waiters on module teardown — resolves them so callers don't hang. */
  private _drainWaiters(timedOut: boolean): void {
    for (const [resetId] of this._cycleWaiters) {
      this._notifyWaiters(resetId, timedOut);
    }
  }

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

    // Record the completed reset_id for the race-safe fast path in awaitCycleComplete.
    if (resetId) {
      this._lastCompletedResetId = resetId;
    }

    // Clear any lingering expectation for this cycle.
    if (this._expectedResetId === resetId) {
      this._expectedResetId = null;
    }

    // Notify any callers awaiting this specific cycle.
    this._notifyWaiters(resetId, false);
  }
}
