import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  readyz() {
    return {
      status: 'ready',
      checks: { db: 'ok', listen: 'ok' },
    };
  }
}
