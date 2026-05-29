import {
  Controller, Get, Post, Body, Res,
  HttpCode, HttpStatus, OnModuleDestroy,
} from '@nestjs/common';
import { Response } from 'express';
import { Subscription } from 'rxjs';
import { store } from '../data/store';
import { emitService } from '../events/emit.service';
import { fetcherStore } from '../fetcher/fetcher.store';

/**
 * Mock control surface — all endpoints outside /api/ so the application API
 * namespace stays clean.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 * GET  /_mock/status        full snapshot of all controllable state
 * POST /_mock/reset         restore deterministic clean slate
 *
 * ── SSE emission ─────────────────────────────────────────────────────────────
 * GET  /_mock/emit          { emitting, event_count }
 * POST /_mock/emit          body: { enabled?: boolean } (omit = toggle)
 *
 * ── Demo data ─────────────────────────────────────────────────────────────────
 * GET  /_mock/demo          { enabled }
 * POST /_mock/demo          body: { enabled?: boolean } (omit = toggle)
 * POST /_mock/demo/reset    purge user events + re-enable demo
 *
 * ── Live ingest feed ─────────────────────────────────────────────────────────
 * GET  /_mock/stream        SSE — event: ingest; data: FeedEntry JSON
 *                           event: source-changed; data: { source, emitting }
 */

export interface MockStatus {
  emitting:         boolean;
  demo_enabled:     boolean;
  event_count:      number;
  fetcher_adapters: string[];
}

@Controller('_mock')
export class MockController implements OnModuleDestroy {
  private readonly feedConnections = new Set<Response>();

  onModuleDestroy() {
    for (const res of this.feedConnections) {
      try { res.end(); } catch {}
    }
  }

  // ── Status + full reset ───────────────────────────────────────────────────

  @Get('status')
  status(): MockStatus {
    return {
      emitting:         emitService.emitting,
      demo_enabled:     store.isDemoEnabled,
      event_count:      store.all().length,
      fetcher_adapters: fetcherStore.adapters(),
    };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  resetAll(): MockStatus {
    emitService.disable();
    store.reset();
    fetcherStore.clear();
    return this.status();
  }

  // ── SSE emission control ──────────────────────────────────────────────────

  @Get('emit')
  emitState(): { emitting: boolean; event_count: number } {
    return { emitting: emitService.emitting, event_count: store.all().length };
  }

  @Post('emit')
  @HttpCode(HttpStatus.OK)
  controlEmit(@Body() body: { enabled?: boolean } = {}): { emitting: boolean; event_count: number } {
    const target = typeof body?.enabled === 'boolean' ? body.enabled : !emitService.emitting;
    if (target) { emitService.enable(); } else { emitService.disable(); }
    return { emitting: emitService.emitting, event_count: store.all().length };
  }

  // ── Demo data control ─────────────────────────────────────────────────────

  @Get('demo')
  demoState(): { enabled: boolean } {
    return { enabled: store.isDemoEnabled };
  }

  @Post('demo')
  @HttpCode(HttpStatus.OK)
  controlDemo(@Body() body: { enabled?: boolean } = {}): { enabled: boolean } {
    const target = typeof body?.enabled === 'boolean' ? body.enabled : !store.isDemoEnabled;
    store.setDemoEnabled(target);
    return { enabled: store.isDemoEnabled };
  }

  @Post('demo/reset')
  @HttpCode(HttpStatus.OK)
  resetDemo(): { enabled: boolean; event_count: number } {
    store.reset();
    return { enabled: store.isDemoEnabled, event_count: store.all().length };
  }

  // ── Live ingest feed ──────────────────────────────────────────────────────

  @Get('stream')
  feedStream(@Res() res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.feedConnections.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15_000);

    const sub: Subscription = store.feed$.subscribe((entry) => {
      try {
        res.write(`event: ingest\n`);
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      } catch {}
    });

    res.on('close', () => {
      clearInterval(heartbeat);
      sub.unsubscribe();
      this.feedConnections.delete(res);
    });
  }
}
