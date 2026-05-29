import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { store } from '../data/store';

@Controller('api/deployments')
export class DeploymentsController {
  @Get()
  list(
    @Query('service') service?: string,
    @Query('environment') environment?: string,
    @Query('status') status?: string,
    @Query('deployment_id') deployment_id?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return store.list({
      service,
      environment,
      status,
      deployment_id,
      since,
      until,
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    const event = store.findById(id);
    if (!event) {
      throw new NotFoundException({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `Deployment event '${id}' not found.`,
      });
    }
    return event;
  }
}
