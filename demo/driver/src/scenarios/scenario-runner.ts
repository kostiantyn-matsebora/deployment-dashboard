import { Subject } from 'rxjs';
import { ScenarioEvent } from './scenario-loader';
import { WriteApiClient } from '../write-api/write-api.client';

export type RunnerState = 'idle' | 'running' | 'done' | 'failed' | 'blocked';

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
  reporter:      string;
}

export interface ErrorStreamEvent {
  deployment_id: string;
  http_status:   number;
  attempt:       number;
  posted_at:     string;
  reporter:      string;
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
  private _state:         RunnerState = 'idle';
  private _scenario:      string | null = null;
  private _eventsTotal:   number = 0;
  private _eventsSent:    number = 0;
  private _errors:        number = 0;
  private _startedAt:     string | null = null;
  private _finishedAt:    string | null = null;
  private _stopRequested  = false;

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
    this._state         = 'idle';
    this._scenario      = null;
    this._eventsTotal   = 0;
    this._eventsSent    = 0;
    this._errors        = 0;
    this._startedAt     = null;
    this._finishedAt    = null;
    this._stopRequested = false;
  }

  /**
   * Enter the `blocked` state — used by ResetCoordinator when a reset-initiated
   * event arrives.  The runner loop will also stop (stopRequested flag set by
   * the coordinator calling stop() first).
   */
  setBlocked(): void {
    this._state = 'blocked';
  }

  /**
   * Run a scenario: convert events (elapsed_minutes → happened_at), POST
   * sequentially, track counters.
   * Resolves when done (all events attempted) or failed (stop requested).
   * State transitions: idle/done/failed → running → done | failed
   */
  async run(
    scenarioName: string,
    events:       ScenarioEvent[],
    client:       WriteApiClient,
    delayMs:      number,
  ): Promise<void> {
    this._initRun(scenarioName, events.length);
    for (let i = 0; i < events.length; i++) {
      if (this._stopRequested) { return this._markFailed(); }
      const wire = toWireShape(events[i]);
      await this._postAndTrack(wire, client, i, events.length, delayMs);
    }
    this._markDone();
  }

  /**
   * Run pre-computed wire events (happened_at already set; no elapsed_minutes
   * conversion).  Used for random-dataset ingests.
   */
  async runWire(
    scenarioName: string,
    wireEvents:   Record<string, unknown>[],
    client:       WriteApiClient,
    delayMs:      number,
  ): Promise<void> {
    this._initRun(scenarioName, wireEvents.length);
    for (let i = 0; i < wireEvents.length; i++) {
      if (this._stopRequested) { return this._markFailed(); }
      await this._postAndTrack(wireEvents[i], client, i, wireEvents.length, delayMs);
    }
    this._markDone();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _initRun(scenarioName: string, total: number): void {
    this._state         = 'running';
    this._scenario      = scenarioName;
    this._eventsTotal   = total;
    this._eventsSent    = 0;
    this._errors        = 0;
    this._startedAt     = new Date().toISOString();
    this._finishedAt    = null;
    this._stopRequested = false;
  }

  private _markFailed(): void {
    this._state      = 'failed';
    this._finishedAt = new Date().toISOString();
  }

  private _markDone(): void {
    this._state      = 'done';
    this._finishedAt = new Date().toISOString();
  }

  private async _postAndTrack(
    wire:    Record<string, unknown>,
    client:  WriteApiClient,
    index:   number,
    total:   number,
    delayMs: number,
  ): Promise<void> {
    const result    = await client.postDeployment(wire);
    const posted_at = new Date().toISOString();
    const reporter  = client.progressReporter;

    if (result.ok) {
      this._eventsSent++;
      this.stream$.next({
        type: 'posted',
        data: {
          deployment_id: wire.deployment_id as string,
          service:       wire.service       as string,
          environment:   wire.environment   as string,
          status:        wire.status        as string,
          happened_at:   wire.happened_at   as string,
          posted_at,
          reporter,
        },
      });
    } else {
      this._errors++;
      this.stream$.next({
        type: 'error',
        data: {
          deployment_id: wire.deployment_id as string,
          http_status:   result.status,
          attempt:       3,
          posted_at,
          reporter,
        },
      });
    }

    if (delayMs > 0 && index < total - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
}
