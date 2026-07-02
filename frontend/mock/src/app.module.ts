import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { MatrixController } from './matrix/matrix.controller';
import { DeploymentsController } from './deployments/deployments.controller';
import { DiscoveryController } from './discovery/discovery.controller';
import { EventsController } from './events/events.controller';
import { FetcherController } from './fetcher/fetcher.controller';
import { MockController } from './mock/mock.controller';
import { AnalyticsController } from './analytics/analytics.controller';
import { PresetsController } from './presets/presets.controller';
@Module({
  controllers: [
    AppController,
    MatrixController,
    DeploymentsController,
    DiscoveryController,
    EventsController,
    FetcherController,
    MockController,
    AnalyticsController,
    PresetsController,
  ],
})
export class AppModule {}
