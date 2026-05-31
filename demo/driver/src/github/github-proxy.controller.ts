import {
  Controller, Get, Post, Body, Res, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { GithubProxyClient } from './github-proxy.client';
import { DemoService } from '../demo/demo.service';

/** RFC 9457 problem detail for reset-in-progress (mirrors demo.controller.ts §4.7). */
function resetInProgressProblem(): Record<string, unknown> {
  return {
    type:   'https://deployment-dashboard/errors/reset-in-progress',
    title:  'Reset in progress',
    status: 503,
    detail: 'A system reset is in progress. Retry after the indicated interval.',
  };
}

/**
 * Proxy controller — exposes /demo/github/* as a same-origin proxy to the
 * github-emulator's /_github/* control surface (§5, DEMO_DRIVER_SPECIFICATION).
 *
 * Mutator routes (POST seed / clear / emit) return 503 RFC 9457 while
 * reset_state == blocked (same gate as the /demo/ control endpoints — §5.1).
 * Read routes (GET status / GET emit) bypass the gate — they are data surfaces.
 */
@Controller('demo/github')
export class GithubProxyController {
  constructor(
    private readonly client:      GithubProxyClient,
    private readonly demoService: DemoService,
  ) {}

  // ── Guard ──────────────────────────────────────────────────────────────────

  /**
   * Returns true (and writes the 503 response) when a reset is in progress.
   * Returns false when the caller may proceed.
   */
  private guardNotBlocked(res: Response): boolean {
    if (!this.demoService.isBlocked()) return false;

    const retryAfter = this.demoService.getRetryAfterSeconds();
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('Content-Type', 'application/problem+json');
    res.status(HttpStatus.SERVICE_UNAVAILABLE).json(resetInProgressProblem());
    return true;
  }

  // ── Read routes (never blocked) ────────────────────────────────────────────

  /**
   * GET /demo/github/status
   * Proxies GET {GITHUB_EMULATOR_URL}/_github/status.
   * Read-only — never blocked during reset (§5.1).
   */
  @Get('status')
  async getStatus(@Res({ passthrough: false }) res: Response): Promise<void> {
    const { status, body } = await this.client.get('status');
    res.status(status).json(body);
  }

  /**
   * GET /demo/github/emit
   * Proxies GET {GITHUB_EMULATOR_URL}/_github/emit.
   * Read-only — never blocked during reset (§5.1).
   */
  @Get('emit')
  async getEmit(@Res({ passthrough: false }) res: Response): Promise<void> {
    const { status, body } = await this.client.get('emit');
    res.status(status).json(body);
  }

  // ── Mutator routes (blocked during reset) ─────────────────────────────────

  /**
   * POST /demo/github/seed
   * Proxies POST {GITHUB_EMULATOR_URL}/_github/seed.
   * Interactive mutator — returns 503 while reset_state == blocked (§5.1).
   */
  @Post('seed')
  async postSeed(
    @Body() body: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (this.guardNotBlocked(res)) return;
    const { status, body: upstreamBody } = await this.client.post('seed', body);
    res.status(status).json(upstreamBody);
  }

  /**
   * POST /demo/github/clear
   * Proxies POST {GITHUB_EMULATOR_URL}/_github/clear.
   * Interactive mutator — returns 503 while reset_state == blocked (§5.1).
   */
  @Post('clear')
  async postClear(
    @Body() body: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (this.guardNotBlocked(res)) return;
    const { status, body: upstreamBody } = await this.client.post('clear', body);
    res.status(status).json(upstreamBody);
  }

  /**
   * POST /demo/github/emit
   * Proxies POST {GITHUB_EMULATOR_URL}/_github/emit.
   * Interactive mutator — returns 503 while reset_state == blocked (§5.1).
   */
  @Post('emit')
  async postEmit(
    @Body() body: unknown,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    if (this.guardNotBlocked(res)) return;
    const { status, body: upstreamBody } = await this.client.post('emit', body);
    res.status(status).json(upstreamBody);
  }
}
