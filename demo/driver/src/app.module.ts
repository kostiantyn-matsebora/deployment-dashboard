import { Module } from '@nestjs/common';
import { DemoModule } from './demo/demo.module';
import { ControlModule } from './control/control.module';

@Module({
  imports: [ControlModule, DemoModule],
})
export class AppModule {}
