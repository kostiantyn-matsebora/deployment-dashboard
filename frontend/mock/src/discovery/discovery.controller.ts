import { Controller, Get } from '@nestjs/common';
import type { DemoData } from '../data/demo-types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { services, environments }: DemoData = require('../../../../demo/data/events.json');

@Controller('api')
export class DiscoveryController {
  @Get('services')
  listServices() {
    return { items: services };
  }

  @Get('environments')
  listEnvironments() {
    return { items: environments };
  }
}
