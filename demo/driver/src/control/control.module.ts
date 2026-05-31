import { Module } from '@nestjs/common';
import { ResetCoordinator } from './reset-coordinator';
import { ControlStreamSubscriber } from './control-stream.subscriber';

@Module({
  providers: [ResetCoordinator, ControlStreamSubscriber],
  exports:   [ResetCoordinator],
})
export class ControlModule {}
