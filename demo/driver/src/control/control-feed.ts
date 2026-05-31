import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Wire shape of a parsed SSE frame received from GET /api/control/stream.
 *
 * Shape choice: we publish the raw SseEvent triple { id?, type?, data? } rather
 * than a normalised ControlStreamEvent object.  Rationale: the controller needs
 * to re-emit  `event: <type>\ndata: <data>\n\n`  onto the outbound SSE stream.
 * Publishing the raw string fields lets the controller write those lines directly
 * without re-serialising JSON — one less parse/stringify round-trip, and unknown
 * future types are forwarded verbatim with no schema coupling.
 */
export interface ControlFrame {
  id?:   string;
  type?: string;
  data?: string;
}

/**
 * In-process fan-out for control-stream frames.
 *
 * The ControlStreamSubscriber holds the single authenticated upstream connection
 * (X-Control-API-Key).  Every parsed frame — including unknown types — is
 * published here so that N browser panels can subscribe to GET /demo/control-stream
 * without each opening their own upstream connection.
 *
 * Subject semantics: no replay; late subscribers receive only post-subscription
 * frames (matching the spec §4.8 "no history replay" requirement).
 */
@Injectable()
export class ControlFeed {
  private readonly _subject = new Subject<ControlFrame>();

  /** Observable that controllers subscribe to for outbound SSE fan-out. */
  readonly frames$: Observable<ControlFrame> = this._subject.asObservable();

  /** Called by ControlStreamSubscriber for every parsed frame. */
  publish(frame: ControlFrame): void {
    this._subject.next(frame);
  }
}
