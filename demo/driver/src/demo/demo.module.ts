import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { EmitService } from './emit.service';

@Module({
  controllers: [DemoController],
  providers:   [DemoService, EmitService],
})
export class DemoModule {}
