import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Res,
  HttpCode,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { store } from '../data/store';
import { validateApiKey } from '../auth/api-key';

// ── Ingest request shape ──────────────────────────────────────────────────────

interface DeploymentEventIngest {
  deployment_id?: unknown;
  service?: unknown;
  environment?: unknown;
  status?: unknown;
  happened_at?: unknown;
  version?: unknown;
  run_url?: unknown;
  run_number?: unknown;
  actor?: unknown;
  ref?: unknown;
  sha?: unknown;
  parent_deployments?: unknown;
}

const VALID_STATUSES = new Set([
  'in-progress', 'success', 'failure',
  'pending', 'queued', 'waiting', 'cancelled', 'rejected',
]);

function validateIngest(body: DeploymentEventIngest): void {
  const errors: Array<{ pointer: string; message: string }> = [];

  if (!body.deployment_id || typeof body.deployment_id !== 'string' || body.deployment_id.length === 0)
    errors.push({ pointer: '/deployment_id', message: 'Required non-empty string.' });
  if (!body.service || typeof body.service !== 'string' || body.service.length === 0)
    errors.push({ pointer: '/service', message: 'Required non-empty string.' });
  if (!body.environment || typeof body.environment !== 'string' || body.environment.length === 0)
    errors.push({ pointer: '/environment', message: 'Required non-empty string.' });
  if (!body.status || !VALID_STATUSES.has(body.status as string))
    errors.push({ pointer: '/status', message: 'Required; must be one of: pending, queued, waiting, in-progress, success, failure, cancelled, rejected.' });
  if (!body.happened_at || typeof body.happened_at !== 'string')
    errors.push({ pointer: '/happened_at', message: 'Required RFC 3339 date-time string.' });

  if (errors.length > 0) {
    throw new HttpException(
      {
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        detail: 'One or more fields failed validation.',
        errors,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

@Controller('api/deployments')
export class DeploymentsController {
  /**
   * POST /api/deployments — ingest a deployment event.
   * Requires X-Api-Key. Returns 201 + Location header + created event.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  ingest(
    @Headers('x-api-key') apiKey: string | undefined,
    @Body() body: DeploymentEventIngest,
    @Res({ passthrough: true }) res: Response,
  ) {
    validateApiKey(apiKey);
    validateIngest(body);

    const event = store.append({
      deployment_id: body.deployment_id as string,
      service:       body.service as string,
      environment:   body.environment as string,
      status:        body.status as 'in-progress' | 'success' | 'failure',
      happened_at:   body.happened_at as string,
      version:       body.version as string | undefined,
      run_url:       body.run_url as string | undefined,
      run_number:    body.run_number as string | undefined,
      actor:         body.actor as string | undefined,
      ref:           body.ref as string | undefined,
      sha:           body.sha as string | undefined,
      parent_deployments: body.parent_deployments as string[] | undefined,
    });

    res.setHeader('Location', `/api/deployments/${event.id}`);
    return event;
  }

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
