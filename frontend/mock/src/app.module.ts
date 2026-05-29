import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MatrixController } from './matrix/matrix.controller';
import { DeploymentsController } from './deployments/deployments.controller';
import { DiscoveryController } from './discovery/discovery.controller';
import { EventsController } from './events/events.controller';

@Module({
  controllers: [
    AppController,
    MatrixController,
    DeploymentsController,
    DiscoveryController,
    EventsController,
  ],
})
export class AppModule {}
