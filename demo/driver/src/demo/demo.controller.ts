import {
  Controller, Get, Post, Param, Body,
  Res, HttpCode, HttpStatus, NotFoundException, OnModuleDestroy,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { Subscription } from 'rxjs';
import { DemoService, IngestOptions } from './demo.service';
import { PANEL_HTML } from '../ui/panel';

/** RFC 9457 problem detail for reset-in-progress (§4.7). */
function resetInProgressProblem(retryAfterSeconds: number): Record<string, unknown> {
  return {
    type:   'https://deployment-dashboard/errors/reset-in-progress',
    title:  'Reset in progress',
    status: 503,
    detail: 'A system reset is in progress. Retry after the indicated interval.',
  };
}

@Controller('demo')
export class DemoController implements OnModuleDestroy {
  private readonly sseConnections = new Set<Response>();

  constructor(private readonly demoService: DemoService) {}

  onModuleDestroy() {
    for (const res of this.sseConnections) {
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
}
