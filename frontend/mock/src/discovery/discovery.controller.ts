import { Controller, Get } from '@nestjs/common';
import { store } from '../data/store';

/**
 * Derives distinct services / environments from the visible store so that
 * disabling demo data also removes demo-only values from discovery.
 */
@Controller('api')
export class DiscoveryController {
  @Get('services')
  listServices() {
    return { items: store.services() };
  }

  @Get('environments')
  listEnvironments() {
    return { items: store.environments() };
  }
}
