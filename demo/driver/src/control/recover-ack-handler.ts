import { Injectable } from '@nestjs/common';
import { ControlEventsClient } from './control-events.client';

/**
 * Recover-participation coordinator — the demo-driver's single point of
 * truth for API-driven recover choreography (#423, D18).
 *
 * Deliberately separate from ResetCoordinator: recover is non-destructive
 * (no data is cleared) and does NOT block the driver's own `/demo/` surface
 * — it only acks the drain and reports `running` on completion. Keeping
 * this as its own small class (rather than folding recover-* handling into
 * ResetCoordinator) means the recover choreography can never accidentally
 * flip `ResetState` to `blocked` or dim the control panel — a reset and a
 * recover share the API's single-flight slot, but only reset drives this
 * driver's local block state.
 *
 * recover-started: no-op — nothing local to react to (no data cleared, no
 * gate on this side); state this explicitly so no double-handling is added.
 */
@Injectable()
export class RecoverAckHandler {
  private _eventsClient: ControlEventsClient | null = null;

  /** Wired by the demo module after construction. */
  registerEventsClient(c: ControlEventsClient): void {
    this._eventsClient = c;
  }

  /** On recover-initiated: ack the drain with a recover-ack event. */
  async onRecoverInitiated(correlationId: string): Promise<void> {
    if (this._eventsClient) {
      await this._eventsClient.postRecoverAck(correlationId);
    }
  }

  /** no-op — no local gate/block state to react to for a recover cycle. */
  onRecoverStarted(_correlationId: string): void {
    // Intentional no-op — recover clears no data and blocks nothing locally.
  }

  /** On recover-completed: report running, reusing the existing status event_type. */
  async onRecoverCompleted(correlationId: string): Promise<void> {
    if (this._eventsClient) {
      await this._eventsClient.postStatusRunning(correlationId);
    }
  }
}
