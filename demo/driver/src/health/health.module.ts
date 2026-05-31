import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health module — liveness aggregator for GET /demo/health (§4.10).
 *
 * Self-contained: no dependency on DemoModule or ControlModule.
 * The endpoint is explicitly excluded from the reset gate by design —
 * the controller never calls DemoService.isBlocked().
 */
@Module({
  controllers: [HealthController],
  providers:   [HealthService],
})
export class HealthModule {}
