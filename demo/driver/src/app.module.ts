import { Module } from '@nestjs/common';
import { DemoModule } from './demo/demo.module';
import { ControlModule } from './control/control.module';
import { GithubModule } from './github/github.module';

@Module({
  imports: [ControlModule, DemoModule, GithubModule],
})
export class AppModule {}
