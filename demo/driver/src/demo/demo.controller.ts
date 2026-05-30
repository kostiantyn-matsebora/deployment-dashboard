import {
  Controller, Get, Post, Param, Body,
  Res, HttpCode, HttpStatus, NotFoundException, OnModuleDestroy,
} from '@nestjs/common';
import { Response } from 'express';
import { Subscription } from 'rxjs';
import { DemoService } from './demo.service';
import { PANEL_HTML } from '../ui/panel';

@Controller('demo')
export class DemoController implements OnModuleDestroy {
  private readonly sseConnections = new Set<Response>();

  constructor(private readonly demoService: DemoService) {}

  onModuleDestroy() {
    for (const res of this.sseConnections) {
      try { res.end(); } catch {}
    }
  }

  // ── Control panel ─────────────────────────────────────────────────────────

  /** GET /demo/ — browser control panel. */
  @Get()
  panel(@Res() res: Response): void {
    res.type('html').send(PANEL_HTML);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /** GET /demo/status */
  @Get('status')
  status() {
    return this.demoService.getStatus();
  }

  // ── Scenarios ─────────────────────────────────────────────────────────────

  /** GET /demo/scenarios */
  @Get('scenarios')
  scenarios() {
    return { items: this.demoService.getScenarios() };
  }

  /**
   * POST /demo/scenarios/:name/run
   * Idempotent: returns current status if already running.
   */
  @Post('scenarios/:name/run')
  @HttpCode(HttpStatus.OK)
  async run(
    @Param('name') name: string,
    @Body() body: { delay_ms?: number } = {},
  ) {
    try {
      return await this.demoService.start(name, body?.delay_ms);
    } catch (err: unknown) {
      throw new NotFoundException({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** POST /demo/scenarios/:name/stop */
  @Post('scenarios/:name/stop')
  @HttpCode(HttpStatus.OK)
  stop(@Param('name') name: string) {
    return this.demoService.stop(name);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  /** POST /demo/reset */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    return this.demoService.reset();
  }

  // ── SSE stream ────────────────────────────────────────────────────────────

  /**
   * GET /demo/stream — SSE fan-out.
   * Events: posted | error.  Heartbeat ping every 15 s.
   * No history — only events emitted after connection opens.
   */
  @Get('stream')
  stream(@Res() res: Response): void {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection',    'keep-alive');
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
