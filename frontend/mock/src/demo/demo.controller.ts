import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { store } from '../data/store';

export interface DemoState {
  enabled: boolean;
}

/**
 * GET  /api/demo — read current demo-data visibility state.
 * POST /api/demo — set or toggle demo-data visibility.
 *                  Body (optional): { "enabled": true | false }
 *                  Omitting body / "enabled" toggles current state.
 * POST /api/demo/reset — restore demo state: re-enables demo data and
 *                        removes all user-posted / SSE-emitted events.
 */
@Controller('api/demo')
export class DemoController {
  @Get()
  getState(): DemoState {
    return { enabled: store.isDemoEnabled };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  setState(@Body() body: { enabled?: boolean } = {}): DemoState {
    const target =
      typeof body?.enabled === 'boolean' ? body.enabled : !store.isDemoEnabled;
    store.setDemoEnabled(target);
    return { enabled: store.isDemoEnabled };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset(): DemoState & { event_count: number } {
    store.reset();
    return { enabled: store.isDemoEnabled, event_count: store.all().length };
  }
}
