import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { EmitService } from './emit.service';
import { ControlModule } from '../control/control.module';

@Module({
  imports:     [ControlModule],
  controllers: [DemoController],
  providers:   [DemoService, EmitService],
  exports:     [DemoService],
})
export class DemoModule {}
