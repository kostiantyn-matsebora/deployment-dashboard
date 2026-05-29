import { Controller, Get, Query } from '@nestjs/common';
import { store } from '../data/store';

@Controller('api/matrix')
export class MatrixController {
  @Get()
  getMatrix(@Query('service') service?: string) {
    return store.matrix(service);
  }
}
