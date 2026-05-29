import { nextSseEvent } from '../data/store';

/**
 * Singleton that owns the periodic SSE-emission timer.
 *
 * Disabled by default — start it explicitly via POST /api/events/stream/emit.
 */
class EmitService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = 8_000;

  get emitting(): boolean {
    return this.timer !== null;
  }

  enable(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      nextSseEvent();
    }, this.intervalMs);
  }

  disable(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  destroy(): void {
    this.disable();
  }
}

export const emitService = new EmitService();
