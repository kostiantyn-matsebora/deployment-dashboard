import { Module } from '@nestjs/common';
import { DemoModule } from './demo/demo.module';
import { ControlModule } from './control/control.module';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ControlModule, DemoModule, GithubModule, HealthModule],
})
export class AppModule {}
