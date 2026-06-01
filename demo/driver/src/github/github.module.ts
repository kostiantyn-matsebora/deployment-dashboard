import { Module } from '@nestjs/common';
import { GithubProxyController } from './github-proxy.controller';
import { GithubProxyClient } from './github-proxy.client';
import { DemoModule } from '../demo/demo.module';

/**
 * GitHub emulator proxy module.
 *
 * Exposes /demo/github/* as a same-origin proxy to the github-emulator's
 * /_github/* control surface (§5, DEMO_DRIVER_SPECIFICATION).
 *
 * Imports DemoModule to access DemoService for reset-blocking (§5.1).
 */
@Module({
  imports:     [DemoModule],
  controllers: [GithubProxyController],
  providers:   [GithubProxyClient],
})
export class GithubModule {}
