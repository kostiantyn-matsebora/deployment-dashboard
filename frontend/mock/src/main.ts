import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

  // Allow the Angular dev server (port 4200) to call the mock.
  app.enableCors({ origin: 'http://localhost:4200', credentials: false });

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`[mock] Deployment Dashboard mock API running on http://localhost:${port}`);
}

bootstrap();
