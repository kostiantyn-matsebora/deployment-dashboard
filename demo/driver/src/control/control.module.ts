import { Module } from '@nestjs/common';
import { ResetCoordinator } from './reset-coordinator';
import { ControlStreamSubscriber } from './control-stream.subscriber';
import { ControlFeed } from './control-feed';
import { ControlEventsReadClient } from './control-events-read.client';

@Module({
  providers: [ResetCoordinator, ControlFeed, ControlEventsReadClient, ControlStreamSubscriber],
  exports:   [ResetCoordinator, ControlFeed, ControlEventsReadClient],
})
export class ControlModule {}
