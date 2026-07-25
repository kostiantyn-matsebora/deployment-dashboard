import {
  Controller, Get, Post, Param, Body,
  Res, HttpCode, HttpStatus, NotFoundException, BadRequestException, OnModuleDestroy,
} from '@nestjs/common';
import { Response } from 'express';
import { Subscription } from 'rxjs';
import { DemoService, IngestOptions } from './demo.service';
import { ControlFeed } from '../control/control-feed';
import { ComponentEventFeed } from '../control/component-event-feed';
import { PANEL_HTML, FAVICON_SVG } from '../ui/panel';

/** RFC 9457 problem detail for reset-in-progress (§4.7). */
function resetInProgressProblem(retryAfterSeconds: number): Record<string, unknown> {
  return {
    type:   'https://deployment-dashboard/errors/reset-in-progress',
    title:  'Reset in progress',
    status: 503,
    detail: 'A system reset is in progress. Retry after the indicated interval.',
  };
}

/** True only for finite, whole, positive numbers — the days_back contract (#423). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

@Controller('demo')
export class DemoController implements OnModuleDestroy {
  private readonly sseConnections            = new Set<Response>();
  private readonly controlSseConnections     = new Set<Response>();
  private readonly compEventSseConnections   = new Set<Response>();

  constructor(
    private readonly demoService:          DemoService,
    private readonly controlFeed:          ControlFeed,
    private readonly componentEventFeed:   ComponentEventFeed,
  ) {}

  onModuleDestroy() {
    for (const res of this.sseConnections) {
      try { res.end(); } catch {}
    }
    for (const res of this.controlSseConnections) {
      try { res.end(); } catch {}
    }
    for (const res of this.compEventSseConnections) {
      try { res.end(); } catch {}
    }
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  /**
   * Throws 503 with RFC 9457 body + Retry-After when a reset is in progress.
   * GET /demo/status and GET /demo/stream are exempt (§4.7).
   */
  private guardNotBlocked(res: Response): void {
    if (!this.demoService.isBlocked()) return;

    const retryAfter = this.demoService.getRetryAfterSeconds();
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('Content-Type', 'application/problem+json');
    res
      .status(HttpStatus.SERVICE_UNAVAILABLE)
      .json(resetInProgressProblem(retryAfter));
  }

  // ── Control panel ─────────────────────────────────────────────────────────

  /** GET /demo/ — browser control panel. */
  @Get()
  panel(@Res() res: Response): void {
    res.type('html').send(PANEL_HTML);
  }

  /** GET /demo/favicon.svg — flat SVG mark used as browser tab icon. */
  @Get('favicon.svg')
  favicon(@Res() res: Response): void {
    res
      .setHeader('Content-Type', 'image/svg+xml')
      .setHeader('Cache-Control', 'public, max-age=86400')
      .send(FAVICON_SVG);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /** GET /demo/status — always answers, even while blocked (§4.7). */
  @Get('status')
  status() {
    return this.demoService.getStatus();
  }

  // ── Scenarios (legacy, backwards compat) ──────────────────────────────────

  /** GET /demo/scenarios */
  @Get('scenarios')
  scenarios() {
    return { items: this.demoService.getScenarios() };
  }

  /**
   * POST /demo/scenarios/:name/run
   * Idempotent: returns current status if already running.
   * Blocked during reset.
   */
  @Post('scenarios/:name/run')
  @HttpCode(HttpStatus.OK)
  async run(
    @Param('name') name: string,
    @Body() body: { delay_ms?: number } = {},
    @Res({ passthrough: false }) res: Response,
  ) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    try {
      const result = await this.demoService.start(name, body?.delay_ms);
      res.json(result);
    } catch (err: unknown) {
      throw new NotFoundException({
        type:   'about:blank',
        title:  'Not Found',
        status: 404,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** POST /demo/scenarios/:name/stop — blocked during reset. */
  @Post('scenarios/:name/stop')
  @HttpCode(HttpStatus.OK)
  stop(
    @Param('name') name: string,
    @Res({ passthrough: false }) res: Response,
  ) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    res.json(this.demoService.stop(name));
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  /**
   * POST /demo/ingest — blocked during reset.
   */
  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  async ingest(
    @Body() body: IngestOptions = {},
    @Res({ passthrough: false }) res: Response,
  ) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    try {
      const result = await this.demoService.startIngest(body);
      res.json(result);
    } catch (err: unknown) {
      throw new NotFoundException({
        type:   'about:blank',
        title:  'Not Found',
        status: 404,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** POST /demo/ingest/stop — blocked during reset. */
  @Post('ingest/stop')
  @HttpCode(HttpStatus.OK)
  ingestStop(@Res({ passthrough: false }) res: Response) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    res.json(this.demoService.stopIngest());
  }

  // ── Live Emission ─────────────────────────────────────────────────────────

  /** GET /demo/emit */
  @Get('emit')
  getEmit() {
    return this.demoService.getEmitStatus();
  }

  /**
   * POST /demo/emit — blocked during reset.
   * { "enabled": true|false } — omit to toggle.
   */
  @Post('emit')
  @HttpCode(HttpStatus.OK)
  postEmit(
    @Body() body: { enabled?: boolean } = {},
    @Res({ passthrough: false }) res: Response,
  ) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    res.json(this.demoService.setEmit(body?.enabled));
  }

  // ── API Reset ─────────────────────────────────────────────────────────────

  /**
   * POST /demo/api-reset — blocked during reset.
   * Proxies POST /api/control/reset to the configured write-API target.
   * Returns { ok, http_status }.
   */
  @Post('api-reset')
  @HttpCode(HttpStatus.OK)
  async apiReset(@Res({ passthrough: false }) res: Response) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;
    res.json(await this.demoService.resetApi());
  }

  // ── API Recover ────────────────────────────────────────────────────────────

  /**
   * POST /demo/api-recover — blocked during reset (#423, D18).
   * Proxies POST /api/control/recover to the configured write-API target
   * with the panel's days_back-only input. Non-destructive — the driver's
   * own surface participates via RecoverAckHandler but is never blocked by
   * a recover cycle; this guard exists only because recover and reset are
   * mutually exclusive at the API (409 while either is in flight), so a
   * request submitted mid-reset would fail anyway.
   * Validates days_back is a positive integer — else 400.
   * Returns { ok, http_status, correlation_id?, since? }.
   */
  @Post('api-recover')
  @HttpCode(HttpStatus.OK)
  async apiRecover(
    @Body() body: { days_back?: number } = {},
    @Res({ passthrough: false }) res: Response,
  ) {
    this.guardNotBlocked(res);
    if (res.headersSent) return;

    if (!isPositiveInteger(body?.days_back)) {
      throw new BadRequestException({
        type:   'about:blank',
        title:  'Bad Request',
        status: 400,
        detail: 'days_back must be a positive integer.',
      });
    }

    res.json(await this.demoService.recoverApi({ days_back: body.days_back }));
  }

  // ── Reset (driver state only) ─────────────────────────────────────────────

  /** POST /demo/reset — resets the driver's own state counters to idle. */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    return this.demoService.reset();
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  /**
   * GET /demo/stream — SSE fan-out. Never blocked (§4.7).
   * Events: posted | error.  Heartbeat ping every 15 s.
   * No history — only events emitted after connection opens.
   */
  @Get('stream')
  stream(@Res() res: Response): void {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache, no-transform');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.sseConnections.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15_000);

    const sub: Subscription = this.demoService.stream$.subscribe(frame => {
      try {
        res.write(`event: ${frame.type}\n`);
        res.write(`data: ${JSON.stringify(frame.data)}\n\n`);
      } catch {}
    });

    res.on('close', () => {
      clearInterval(heartbeat);
      sub.unsubscribe();
      this.sseConnections.delete(res);
    });
  }

  // ── Control API event feed (SSE) ──────────────────────────────────────────

  /**
   * GET /demo/control-stream — SSE fan-out of upstream control-stream frames.
   *
   * Re-broadcasts every frame received from GET /api/control/stream via the
   * in-process ControlFeed subject.  Never blocked during reset (§4.8).
   * No history replay — only frames received after the panel connects.
   * Wire format mirrors /demo/stream: named events + 15 s heartbeat.
   */
  @Get('control-stream')
  controlStream(@Res() res: Response): void {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache, no-transform');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.controlSseConnections.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15_000);

    const sub: Subscription = this.controlFeed.frames$.subscribe(frame => {
      try {
        if (frame.type) {
          res.write(`event: ${frame.type}\n`);
        }
        res.write(`data: ${frame.data ?? ''}\n\n`);
      } catch {}
    });

    res.on('close', () => {
      clearInterval(heartbeat);
      sub.unsubscribe();
      this.controlSseConnections.delete(res);
    });
  }

  // ── Component event feed (SSE) ───────────────────────────────────────────

  /**
   * GET /demo/control-events — SSE fan-out of upstream component-event frames.
   *
   * Re-broadcasts every frame received from GET /api/control/events/stream via
   * the in-process ComponentEventFeed subject.  Mirrors the GET /demo/control-stream
   * pattern (§4.8) exactly.  Never blocked during reset (§4.9).
   * No history replay — only frames received after the panel connects.
   * Wire format: named `component` events + 15 s heartbeat (§4.9).
   */
  @Get('control-events')
  controlEvents(@Res() res: Response): void {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache, no-transform');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.compEventSseConnections.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15_000);

    const sub: Subscription = this.componentEventFeed.frames$.subscribe(frame => {
      try {
        if (frame.type) {
          res.write(`event: ${frame.type}\n`);
        }
        res.write(`data: ${frame.data ?? ''}\n\n`);
      } catch {}
    });

    res.on('close', () => {
      clearInterval(heartbeat);
      sub.unsubscribe();
      this.compEventSseConnections.delete(res);
    });
  }
}
