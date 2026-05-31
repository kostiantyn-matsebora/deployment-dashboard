import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  const port = parseInt(process.env.PORT ?? '3100', 10);
  await app.listen(port);
  console.log(`[github-emulator] running on http://localhost:${port}/`);
}

bootstrap();
