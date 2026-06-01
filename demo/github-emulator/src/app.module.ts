import { Module } from '@nestjs/common';
import { GithubStoreService } from './github-store.service';
import { GithubRestController } from './github-rest.controller';
import { ControlController } from './control.controller';

@Module({
  controllers: [GithubRestController, ControlController],
  providers:   [GithubStoreService],
})
export class AppModule {}
