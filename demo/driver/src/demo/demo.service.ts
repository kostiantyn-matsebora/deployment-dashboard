import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { ScenarioRunner, RunnerStatus, StreamFrame } from '../scenarios/scenario-runner';
import { WriteApiClient } from '../write-api/write-api.client';
import { Scenario, loadScenarios } from '../scenarios/scenario-loader';
import { getConfig } from '../config/configuration';

@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
  private readonly runner = new ScenarioRunner();
  private scenarios: Scenario[] = [];
  private streamSub: Subscription | null = null;

  /** SSE fan-out re-exported for controller subscriptions. */
  readonly stream$ = new Subject<StreamFrame>();

  onModuleInit(): void {
    const config = getConfig();
    try {
      this.scenarios = loadScenarios(config.scenariosDir);
      console.log(`[demo-driver] loaded ${this.scenarios.length} scenario(s): ${this.scenarios.map(s => s.name).join(', ') || '(none)'}`);
    } catch (err) {
      this.scenarios = [];
      console.warn('[demo-driver] scenario load failed:', err);
    }
    this.streamSub = this.runner.stream$.subscribe(frame => this.stream$.next(frame));
  }

  onModuleDestroy(): void {
    this.runner.stop();
    this.streamSub?.unsubscribe();
    this.stream$.complete();
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getStatus(): RunnerStatus {
    return this.runner.status;
  }

  getScenarios(): string[] {
    return this.scenarios.map(s => s.name);
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  /**
   * Start a scenario run.
   * Idempotent: returns current status when already running (§4.2).
   * delayMs overrides EMIT_DELAY_MS if provided.
   */
  async start(scenarioName: string, delayMs?: number): Promise<RunnerStatus> {
    if (this.runner.state === 'running') {
      return this.runner.status;
    }

    const scenario = this.scenarios.find(s => s.name === scenarioName);
    if (!scenario) {
      throw new Error(`Scenario '${scenarioName}' not found`);
    }

    const config        = getConfig();
    const effectiveDelay = delayMs !== undefined ? delayMs : config.emitDelayMs;
    const client        = new WriteApiClient(
      config.writeApiUrl,
      config.apiKey,
      `demo-driver/${scenarioName}`,
    );

    // Fire-and-forget — status is polled / streamed via /demo/status and /demo/stream
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
