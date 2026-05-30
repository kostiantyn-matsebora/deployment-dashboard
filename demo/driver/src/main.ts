import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`[demo-driver] running on http://localhost:${port}/demo/`);
}

bootstrap();
