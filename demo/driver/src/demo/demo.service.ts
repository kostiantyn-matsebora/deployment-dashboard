import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { ScenarioRunner, RunnerStatus, StreamFrame } from '../scenarios/scenario-runner';
import { WriteApiClient } from '../write-api/write-api.client';
import { ControlApiClient, ResetResult } from '../write-api/control-api.client';
import { generateRandomEvents } from '../scenarios/random-event-generator';
import { Scenario, loadScenarios } from '../scenarios/scenario-loader';
import { EmitService } from './emit.service';
import { getConfig } from '../config/configuration';

export interface IngestOptions {
  dataset?:  string;   // 'demo' | 'random'  (default 'demo')
  reset?:    boolean;  // call POST /api/control/reset first
  count?:    number;   // random only (default 20)
  delay_ms?: number;   // overrides EMIT_DELAY_MS
}

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly runner = new ScenarioRunner();
  private scenarios: Scenario[] = [];
  private streamSub:     Subscription | null = null;
  private emitStreamSub: Subscription | null = null;

  /** SSE fan-out re-exported for controller subscriptions. */
  readonly stream$ = new Subject<StreamFrame>();

  constructor(private readonly emitService: EmitService) {}

  onModuleInit(): void {
    const config = getConfig();
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

  // ── Queries ───────────────────────────────────────────────────────────────

  getStatus(): RunnerStatus {
    return this.runner.status;
  }

  getScenarios(): string[] {
    return this.scenarios.map(s => s.name);
  }

  getEmitStatus(): { emitting: boolean } {
    return { emitting: this.emitService.emitting };
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  /**
   * Unified ingest entry point for the new control group (§4.4).
   * - If reset=true: calls POST /api/control/reset on the target before starting.
   * - dataset='demo': posts the demo-set scenario events.
   * - dataset='random': generates and posts `count` random events.
   * Idempotent: returns current status when already running.
   */
  async startIngest(opts: IngestOptions): Promise<RunnerStatus> {
    const { dataset = 'demo', reset = false, count = 20, delay_ms } = opts;

    if (reset) {
      const config = getConfig();
      const ctrl   = new ControlApiClient(config.writeApiUrl, config.controlApiKey);
      const result = await ctrl.resetApi();
      if (!result.ok) {
        console.warn(`[demo-driver] pre-ingest API reset returned HTTP ${result.http_status}`);
      }
    }

    if (this.runner.state === 'running') return this.runner.status;

    const config        = getConfig();
    const effectiveDelay = delay_ms !== undefined ? delay_ms : config.emitDelayMs;
    const client        = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      `demo-driver/${dataset}`,
    );

    if (dataset === 'random') {
      const events = generateRandomEvents(Math.max(1, count));
      this.runner.runWire('random', events, client, effectiveDelay).catch(err => {
        console.error('[demo-driver] runner error:', err);
      });
    } else {
      const scenario = this.scenarios.find(s => s.name === 'demo-set') ?? this.scenarios[0];
      if (!scenario) throw new Error('No demo scenario available');
      this.runner.run(scenario.name, scenario.events, client, effectiveDelay).catch(err => {
        console.error('[demo-driver] runner error:', err);
      });
    }

    return this.runner.status;
  }

  /** Stop the running ingest (scenario or random). */
  stopIngest(): RunnerStatus {
    this.runner.stop();
    return this.runner.status;
  }

  // ── Live Emission ─────────────────────────────────────────────────────────

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

  // ── API Reset ─────────────────────────────────────────────────────────────

  /** Proxy POST /api/control/reset to the write-API target. */
  async resetApi(): Promise<ResetResult> {
    const config = getConfig();
    const ctrl   = new ControlApiClient(config.writeApiUrl, config.controlApiKey);
    return ctrl.resetApi();
  }

  // ── Legacy scenario commands (backwards compat) ───────────────────────────

  /**
   * Start a named scenario run.
   * Idempotent: returns current status when already running (§4.2).
   * delayMs overrides EMIT_DELAY_MS if provided.
   */
  async start(scenarioName: string, delayMs?: number): Promise<RunnerStatus> {
    if (this.runner.state === 'running') return this.runner.status;

    const scenario = this.scenarios.find(s => s.name === scenarioName);
    if (!scenario) throw new Error(`Scenario '${scenarioName}' not found`);

    const config        = getConfig();
    const effectiveDelay = delayMs !== undefined ? delayMs : config.emitDelayMs;
    const client        = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      `demo-driver/${scenarioName}`,
    );

    this.runner.run(scenarioName, scenario.events, client, effectiveDelay).catch(err => {
      console.error('[demo-driver] runner error:', err);
    });

    return this.runner.status;
  }

  stop(_scenarioName: string): RunnerStatus {
    this.runner.stop();
    return this.runner.status;
  }

  reset(): RunnerStatus {
    this.runner.reset();
    return this.runner.status;
  }
}
