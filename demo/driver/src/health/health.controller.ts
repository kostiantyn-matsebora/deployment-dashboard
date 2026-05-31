import { Controller, Get } from '@nestjs/common';
import { HealthService, HealthStatus } from './health.service';

/**
 * Liveness-aggregator controller.
 *
 * GET /demo/health — §4.10, DEMO_DRIVER_SPECIFICATION.
 *
 * Read-only; NEVER gated by the reset coordinator (the endpoint must answer
 * even while reset_state == blocked so the panel status bar stays live).
 */
@Controller('demo/health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}
