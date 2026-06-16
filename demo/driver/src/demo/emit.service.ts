import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { WriteApiClient } from '../write-api/write-api.client';
import { generateRandomEvent } from '../scenarios/random-event-generator';
import { StreamFrame } from '../scenarios/scenario-runner';
import { getConfig } from '../config/configuration';
import { ControlEventsClient } from '../control/control-events.client';

/**
 * Periodic random-event emitter.
 *
 * When enabled, fires every EMIT_INTERVAL_MS (default 8 s), generates one
 * random DeploymentEventIngest event, POSTs it to the write API, and emits a
 * StreamFrame so the SSE client feed stays live.
 *
 * Disabled by default â€” start via POST /demo/emit { "enabled": true }.
 */
@Injectable()
export class EmitService implements OnModuleDestroy {
  private timer:        ReturnType<typeof setInterval> | null = null;
  private eventsClient: ControlEventsClient | null = null;
  private runId:        string | null = null;

  /**
   * Frames from periodic emission â€” merged into DemoService.stream$ so every
   * SSE subscriber receives them alongside scenario-runner frames.
   */
  readonly stream$ = new Subject<StreamFrame>();

  get emitting(): boolean {
    return this.timer !== null;
  }

  /** Inject the component-events client (called from DemoService.onModuleInit). */
  setEventsClient(client: ControlEventsClient): void {
    this.eventsClient = client;
  }

  enable(): void {
    if (this.timer !== null) return;
    const config = getConfig();
    const client = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      'demo-driver/emit',
    );
    const reporter = client.progressReporter;

    // Per-run correlation (Â§4.12): one run_id per enable() call.
    const runId = crypto.randomUUID();
    this.runId  = runId;
    if (this.eventsClient) {
      this.eventsClient.postRunStart(runId, 'live emission started').catch(() => { /* fire-and-forget */ });
    }

    this.timer = setInterval(async () => {
      const event     = generateRandomEvent();
      const result    = await client.postDeployment(event);
      const posted_at = new Date().toISOString();

      if (result.ok) {
        this.stream$.next({
          type: 'posted',
          data: {
            deployment_id: event.deployment_id as string,
            service:       event.service       as string,
            environment:   event.environment   as string,
            status:        event.status        as string,
            happened_at:   event.happened_at   as string,
            posted_at,
            reporter,
          },
        });
      } else {
        this.stream$.next({
          type: 'error',
          data: {
            deployment_id: event.deployment_id as string,
            http_status:   result.status,
            attempt:       1,
            posted_at,
            reporter,
          },
        });
      }
    }, config.emitIntervalMs);
  }

  disable(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;

    // Per-run correlation (Â§4.12): close the run by posting idle status.
    const runId = this.runId;
    this.runId  = null;
    if (this.eventsClient && runId) {
      this.eventsClient.postRunComplete(runId).catch(() => { /* fire-and-forget */ });
    }
  }

  onModuleDestroy(): void {
    this.disable();
    this.stream$.complete();
  }
}
