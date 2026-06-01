import { Controller, Get, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { GithubStoreService } from './github-store.service';

interface SeedBody {
  dataset?: 'demo' | 'random';
  count?:   number;
  reset?:   boolean;
}

interface EmitBody {
  enabled?: boolean;
}

@Controller('_github')
export class ControlController {
  constructor(private readonly storeService: GithubStoreService) {}

  // ── GET /_github/status ───────────────────────────────────────────────────

  @Get('status')
  getStatus(@Res() res: Response): void {
    res.json(this.storeService.status());
  }

  // ── POST /_github/seed ────────────────────────────────────────────────────

  @Post('seed')
  seed(@Body() body: SeedBody, @Res() res: Response): void {
    const dataset = body.dataset ?? 'demo';
    const count   = typeof body.count === 'number' ? body.count : 5;
    const reset   = body.reset === true;

    if (dataset !== 'demo' && dataset !== 'random') {
      res.status(400).json({ message: 'dataset must be "demo" or "random"' });
      return;
    }

    const status = this.storeService.seed(dataset, count, reset);
    res.status(200).json(status);
  }

  // ── POST /_github/clear ───────────────────────────────────────────────────

  @Post('clear')
  clear(@Res() res: Response): void {
    const status = this.storeService.clear();
    res.status(200).json(status);
  }

  // ── GET /_github/emit ─────────────────────────────────────────────────────

  @Get('emit')
  getEmit(@Res() res: Response): void {
    res.json(this.storeService.getEmitStatus());
  }

  // ── POST /_github/emit ────────────────────────────────────────────────────

  @Post('emit')
  setEmit(@Body() body: EmitBody, @Res() res: Response): void {
    let result: { emitting: boolean };

    if (typeof body.enabled === 'boolean') {
      result = this.storeService.setEmit(body.enabled);
    } else {
      result = this.storeService.toggleEmit();
    }

    res.status(200).json(result);
  }
}
