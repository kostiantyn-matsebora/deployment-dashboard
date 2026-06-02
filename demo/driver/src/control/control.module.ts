import { Module } from '@nestjs/common';
import { ResetCoordinator } from './reset-coordinator';
import { ControlStreamSubscriber } from './control-stream.subscriber';
import { ControlFeed } from './control-feed';
import { ComponentEventFeed } from './component-event-feed';
import { ComponentEventsSubscriber } from './component-events.subscriber';

@Module({
  providers: [
    ResetCoordinator,
    ControlFeed,
    ControlStreamSubscriber,
    ComponentEventFeed,
    ComponentEventsSubscriber,
  ],
  exports: [ResetCoordinator, ControlFeed, ComponentEventFeed],
})
export class ControlModule {}
