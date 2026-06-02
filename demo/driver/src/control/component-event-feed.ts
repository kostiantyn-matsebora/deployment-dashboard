import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Wire shape of a parsed SSE frame received from GET /api/control/events/stream.
 *
 * Shape choice: we publish the raw SseEvent triple { id?, type?, data? } rather
 * than a normalised ComponentEventRecord object.  Rationale: the controller needs
 * to re-emit  `event: component\ndata: <data>\n\n`  onto the outbound SSE stream.
 * Publishing the raw string fields lets the controller write those lines directly
 * without re-serialising JSON — one less parse/stringify round-trip, and the
 * upstream wire shape is forwarded verbatim with no schema coupling.
 *
 * Per §4.9 spec: every accepted POST /api/control/events produces exactly one
 * named `component` frame on GET /api/control/events/stream; that frame is
 * published here as-is.
 */
export interface ComponentEventFrame {
  id?:   string;
  type?: string;
  data?: string;
}

/**
 * In-process fan-out for component-event frames.
 *
 * The ComponentEventsSubscriber holds the single upstream connection to
 * GET /api/control/events/stream.  Every parsed frame is published here so
 * that N browser panels can subscribe to GET /demo/control-events without
 * each opening their own upstream connection.
 *
 * Subject semantics: no replay; late subscribers receive only post-subscription
 * frames (matching the spec §4.9 "no history replay" requirement).
 */
@Injectable()
export class ComponentEventFeed {
  private readonly _subject = new Subject<ComponentEventFrame>();

  /** Observable that controllers subscribe to for outbound SSE fan-out. */
  readonly frames$: Observable<ComponentEventFrame> = this._subject.asObservable();

  /** Called by ComponentEventsSubscriber for every parsed frame. */
  publish(frame: ComponentEventFrame): void {
    this._subject.next(frame);
  }
}
