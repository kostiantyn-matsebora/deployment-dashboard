import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { ScenarioRunner, RunnerStatus, StreamFrame } from '../scenarios/scenario-runner';
import { WriteApiClient } from '../write-api/write-api.client';
import { ControlApiClient, ResetResult } from '../write-api/control-api.client';
import { generateRandomEvents, SERVICE_COUNT } from '../scenarios/random-event-generator';
import { Scenario, loadScenarios } from '../scenarios/scenario-loader';
import { EmitService } from './emit.service';
import { getConfig } from '../config/configuration';
import { ResetCoordinator, ResetParticipant } from '../control/reset-coordinator';
import { ControlEventsClient } from '../control/control-events.client';

export interface IngestOptions {
  dataset?:  string;   // 'demo' | 'random'  (default 'demo')
  reset?:    boolean;  // call POST /api/control/reset first
  count?:    number;   // random only â€” number of service scenarios (1â€“10, default 10 = all services)
  delay_ms?: number;   // overrides EMIT_DELAY_MS
}

/** Extended status including reset-participation fields (Â§4.1). */
export interface DemoStatus extends RunnerStatus {
  reset_state: 'idle' | 'blocked';
  reset_id:    string | null;
}

/**
 * Upper bound for the per-event emit delay (ms). The delay is forwarded to
 * setTimeout in the ScenarioRunner; an unbounded, caller-supplied value would
 * let a single request schedule an enormous timer and stall the runner
 * indefinitely (resource exhaustion â€” CodeQL js/resource-exhaustion). 60s per
 * event is far beyond any legitimate demo pacing.
 */
export const MAX_EMIT_DELAY_MS = 60_000;

/**
 * Clamp a (possibly caller-supplied) delay to a safe [0, MAX_EMIT_DELAY_MS]
 * range. Non-finite values (NaN / Infinity from malformed JSON bodies) collapse
 * to 0. The Math.min upper bound also sanitizes the value for static analysis.
 */
function clampDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), MAX_EMIT_DELAY_MS);
}

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy, ResetParticipant {
  private readonly runner = new ScenarioRunner();
  private scenarios: Scenario[] = [];
  private streamSub:     Subscription | null = null;
  private emitStreamSub: Subscription | null = null;
  private eventsClient:  ControlEventsClient | null = null;

  /** SSE fan-out re-exported for controller subscriptions. */
  readonly stream$ = new Subject<StreamFrame>();

  constructor(
    private readonly emitService:       EmitService,
    private readonly resetCoordinator:  ResetCoordinator,
  ) {}

  onModuleInit(): void {
    const config = getConfig();

    // Wire the coordinator with participant + events client.
    this.resetCoordinator.registerParticipant(this);
    const eventsClient = new ControlEventsClient(
      config.writeApiUrl,
      config.apiKey,
      config.componentId,
    );
    this.eventsClient = eventsClient;
    this.resetCoordinator.registerEventsClient(eventsClient);
    this.emitService.setEventsClient(eventsClient);

    try {
      this.scenarios = loadScenarios(config.scenariosDir);
      console.log(
        `[demo-driver] loaded ${this.scenarios.length} scenario(s): ` +
        (this.scenarios.map(s => s.name).join(', ') || '(none)'),
      );
    } catch (err) {
      this.scenarios = [];
      console.warn('[demo-driver] scenario load failed:', err);
    }
    this.streamSub     = this.runner.stream$.subscribe(frame => this.stream$.next(frame));
    this.emitStreamSub = this.emitService.stream$.subscribe(frame => this.stream$.next(frame));
  }

  onModuleDestroy(): void {
    this.runner.stop();
    this.streamSub?.unsubscribe();
    this.emitStreamSub?.unsubscribe();
    this.stream$.complete();
  }

  // â”€â”€ ResetParticipant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Called by ResetCoordinator on reset-initiated: stop work, enter blocked state. */
  stopWork(): void {
    this.runner.stop();
    this.emitService.disable();
    this.runner.setBlocked();
  }

  /** Called by ResetCoordinator on reset-completed (or safety unblock): restore idle. */
  unblockWork(): void {
    this.runner.reset();
  }

  // â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getStatus(): DemoStatus {
    return {
      ...this.runner.status,
      reset_state: this.resetCoordinator.resetState,
      reset_id:    this.resetCoordinator.resetId,
    };
  }

  isBlocked(): boolean {
    return this.resetCoordinator.resetState === 'blocked';
  }

  getRetryAfterSeconds(): number {
    const config = getConfig();
    return Math.ceil(config.resetGateMaxTtlMs / 1000);
  }

  getScenarios(): string[] {
    return this.scenarios.map(s => s.name);
  }

  getEmitStatus(): { emitting: boolean } {
    return { emitting: this.emitService.emitting };
  }

  // â”€â”€ Ingest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Unified ingest entry point for the new control group (Â§4.4).
   * - If reset=true: calls POST /api/control/reset on the target before starting.
   * - dataset='demo': posts the demo-set scenario events.
   * - dataset='random': generates and posts `count` random events.
   * Idempotent: returns current status when already running.
   */
  async startIngest(opts: IngestOptions): Promise<DemoStatus> {
    const { dataset = 'demo', reset = false, count = 10, delay_ms } = opts;

    if (reset) {
      const config = getConfig();
      const ctrl   = new ControlApiClient(config.writeApiUrl, config.controlApiKey);
      const result = await ctrl.resetApi();
      if (!result.ok) {
        console.warn(`[demo-driver] pre-ingest API reset returned HTTP ${result.http_status}`);
      } else if (result.reset_id) {
        // Declare the expected cycle immediately so the coordinator does not
        // fast-resolve awaitCycleComplete in the window before reset-initiated
        // arrives via SSE (which is the race that causes mid-flight stopWork).
        this.resetCoordinator.expectCycle(result.reset_id);
        // Wait for the reset cycle to complete before ingesting.  The coordinator
        // will be blocked by its own reset-initiated handler during this window;
        // awaitCycleComplete only reads state and registers a waiter â€” it does
        // not call stopWork/unblockWork, so there is no deadlock risk.
        await this.resetCoordinator.awaitCycleComplete(result.reset_id);
      } else {
        console.warn('[demo-driver] API reset accepted but returned no reset_id â€” proceeding without waiting');
      }
    }

    if (this.runner.state === 'running') return this.getStatus();

    const config        = getConfig();
    const effectiveDelay = clampDelayMs(delay_ms !== undefined ? delay_ms : config.emitDelayMs);
    const client        = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      `demo-driver/${dataset}`,
    );

    // Generate a per-run correlation id for component-event grouping (Â§4.12).
    const runId = crypto.randomUUID();
    const eventsClient = this.eventsClient;
    if (eventsClient) {
      eventsClient.postRunStart(runId, `ingest ${dataset} started`).catch(() => { /* fire-and-forget */ });
    }

    const onRunComplete = () => {
      if (eventsClient) {
        eventsClient.postRunComplete(runId).catch(() => { /* fire-and-forget */ });
      }
    };

    if (dataset === 'random') {
      const events = generateRandomEvents(Math.min(Math.max(1, count), SERVICE_COUNT));
      this.runner.runWire('random', events, client, effectiveDelay)
        .then(onRunComplete)
        .catch(err => {
          console.error('[demo-driver] runner error:', err);
          onRunComplete();
        });
    } else {
      const scenario = this.scenarios.find(s => s.name === 'demo-set') ?? this.scenarios[0];
      if (!scenario) throw new Error('No demo scenario available');
      this.runner.run(scenario.name, scenario.events, client, effectiveDelay)
        .then(onRunComplete)
        .catch(err => {
          console.error('[demo-driver] runner error:', err);
          onRunComplete();
        });
    }

    return this.getStatus();
  }

  /** Stop the running ingest (scenario or random). */
  stopIngest(): DemoStatus {
    this.runner.stop();
    return this.getStatus();
  }

  // â”€â”€ Live Emission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Enable / disable periodic random event emission.
   * Omitting `enabled` toggles the current state (matching mock /_mock/emit pattern).
   */
  setEmit(enabled?: boolean): { emitting: boolean } {
    const shouldEnable = enabled !== undefined ? enabled : !this.emitService.emitting;
    if (shouldEnable) {
      this.emitService.enable();
    } else {
      this.emitService.disable();
    }
    return { emitting: this.emitService.emitting };
  }

  // â”€â”€ API Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Proxy POST /api/control/reset to the write-API target. */
  async resetApi(): Promise<ResetResult> {
    const config = getConfig();
    const ctrl   = new ControlApiClient(config.writeApiUrl, config.controlApiKey);
    return ctrl.resetApi();
  }

  // â”€â”€ Legacy scenario commands (backwards compat) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Start a named scenario run.
   * Idempotent: returns current status when already running (Â§4.2).
   * delayMs overrides EMIT_DELAY_MS if provided.
   */
  async start(scenarioName: string, delayMs?: number): Promise<DemoStatus> {
    if (this.runner.state === 'running') return this.getStatus();

    const scenario = this.scenarios.find(s => s.name === scenarioName);
    if (!scenario) throw new Error(`Scenario '${scenarioName}' not found`);

    const config        = getConfig();
    const effectiveDelay = clampDelayMs(delayMs !== undefined ? delayMs : config.emitDelayMs);
    const client        = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      `demo-driver/${scenarioName}`,
    );

    this.runner.run(scenarioName, scenario.events, client, effectiveDelay).catch(err => {
      console.error('[demo-driver] runner error:', err);
    });

    return this.getStatus();
  }

  stop(_scenarioName: string): DemoStatus {
    this.runner.stop();
    return this.getStatus();
  }

  reset(): DemoStatus {
    this.runner.reset();
    return this.getStatus();
  }
}
