import { Subject } from 'rxjs';
import { ScenarioEvent } from './scenario-loader';
import { WriteApiClient } from '../write-api/write-api.client';

export type RunnerState = 'idle' | 'running' | 'done' | 'failed';

export interface RunnerStatus {
  scenario:     string | null;
  state:        RunnerState;
  events_total: number;
  events_sent:  number;
  errors:       number;
  started_at:   string | null;
  finished_at:  string | null;
}

export interface PostedStreamEvent {
  deployment_id: string;
  service:       string;
  environment:   string;
  status:        string;
  happened_at:   string;
  posted_at:     string;
}

export interface ErrorStreamEvent {
  deployment_id: string;
  http_status:   number;
  attempt:       number;
  posted_at:     string;
}

export type StreamFrame =
  | { type: 'posted'; data: PostedStreamEvent }
  | { type: 'error';  data: ErrorStreamEvent };

/**
 * Converts a ScenarioEvent to the DeploymentEventIngest wire shape (§6):
 *  - happened_at = Date.now() - elapsed_minutes * 60_000  (D6)
 *  - elapsed_minutes stripped
 */
function toWireShape(event: ScenarioEvent): Record<string, unknown> {
  const { elapsed_minutes, ...rest } = event;
  return {
    ...rest,
    happened_at: new Date(Date.now() - elapsed_minutes * 60_000).toISOString(),
  };
}

/**
 * Stateful scenario runner.  One instance per DemoService.
 * Drives scenarios by POSTing events sequentially through WriteApiClient.
 */
export class ScenarioRunner {
  private _state:        RunnerState = 'idle';
  private _scenario:     string | null = null;
  private _eventsTotal:  number = 0;
  private _eventsSent:   number = 0;
  private _errors:       number = 0;
  private _startedAt:    string | null = null;
  private _finishedAt:   string | null = null;
  private _stopRequested = false;

  /** SSE fan-out — subscribers receive posted / error frames. */
  readonly stream$ = new Subject<StreamFrame>();

  get state(): RunnerState {
    return this._state;
  }

  get status(): RunnerStatus {
    return {
      scenario:     this._scenario,
      state:        this._state,
      events_total: this._eventsTotal,
      events_sent:  this._eventsSent,
      errors:       this._errors,
      started_at:   this._startedAt,
      finished_at:  this._finishedAt,
    };
  }

  /** Signal the running loop to stop after the current event. */
  stop(): void {
    this._stopRequested = true;
  }

  /** Reset all counters + state to idle. */
  reset(): void {
    this._state        = 'idle';
    this._scenario     = null;
    this._eventsTotal  = 0;
    this._eventsSent   = 0;
    this._errors       = 0;
    this._startedAt    = null;
    this._finishedAt   = null;
    this._stopRequested = false;
  }

  /**
   * Run a scenario: convert events, POST sequentially, track counters.
   * Resolves when done (all events attempted) or failed (stop requested).
   * State transitions: idle/done/failed → running → done | failed
   */
  async run(
    scenarioName: string,
    events: ScenarioEvent[],
    client: WriteApiClient,
    delayMs: number,
  ): Promise<void> {
    this._state        = 'running';
    this._scenario     = scenarioName;
    this._eventsTotal  = events.length;
    this._eventsSent   = 0;
    this._errors       = 0;
    this._startedAt    = new Date().toISOString();
    this._finishedAt   = null;
    this._stopRequested = false;

    for (let i = 0; i < events.length; i++) {
      if (this._stopRequested) {
        this._state      = 'failed';
        this._finishedAt = new Date().toISOString();
        return;
      }

      const event  = events[i];
      const wire   = toWireShape(event);
      const result = await client.postDeployment(wire);
      const posted_at = new Date().toISOString();

      if (result.ok) {
        this._eventsSent++;
        this.stream$.next({
          type: 'posted',
          data: {
            deployment_id: event.deployment_id,
            service:       event.service,
            environment:   event.environment,
            status:        event.status,
            happened_at:   wire.happened_at as string,
            posted_at,
          },
        });
      } else {
        this._errors++;
        this.stream$.next({
          type: 'error',
          data: {
            deployment_id: event.deployment_id,
            http_status:   result.status,
            attempt:       3,
            posted_at,
          },
        });
      }

      if (delayMs > 0 && i < events.length - 1) {
        await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      }
    }

    this._state      = 'done';
    this._finishedAt = new Date().toISOString();
  }
}
