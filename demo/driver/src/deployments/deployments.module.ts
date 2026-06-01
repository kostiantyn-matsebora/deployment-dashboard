import { Module } from '@nestjs/common';
import { DeploymentsStreamController } from './deployments-stream.controller';

/**
 * DeploymentsModule — serves GET /demo/deployments-stream.
 *
 * Self-contained: no dependency on DemoModule, ControlModule, or HealthModule.
 * The endpoint is a data feed and is explicitly excluded from the reset gate.
 */
@Module({
  controllers: [DeploymentsStreamController],
})
export class DeploymentsModule {}
