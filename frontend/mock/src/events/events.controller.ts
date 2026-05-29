import { Controller, Get, Query, Res, OnModuleDestroy } from '@nestjs/common';
import { Response } from 'express';
import { store, nextSseEvent } from '../data/store';
import { Subscription } from 'rxjs';

/**
 * SSE controller — GET /api/events/stream
 *
 * Uses raw Express response to emit named events ("event: deployment") required
 * by the Angular client's addEventListener('deployment', …) subscription.
 * Heartbeat comment ": ping" every 15 s keeps intermediaries alive.
 */
@Controller('api/events')
export class EventsController implements OnModuleDestroy {
  private readonly connections = new Set<Response>();

  private readonly emitTimer = setInterval(() => {
    nextSseEvent(); // appends to store and broadcasts via store.live$
  }, 8_000);

  onModuleDestroy() {
    clearInterval(this.emitTimer);
    for (const res of this.connections) {
      try { res.end(); } catch {}
    }
  }

  @Get('stream')
  stream(
    @Query('service') service: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    this.connections.add(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 15_000);

    const sub: Subscription = store.live$.subscribe((event) => {
      if (service && event.service !== service) return;
      try {
        res.write(`id: ${event.id}\n`);
        res.write(`event: deployment\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {}
    });

    res.on('close', () => {
      clearInterval(heartbeat);
      sub.unsubscribe();
      this.connections.delete(res);
    });
  }
}
