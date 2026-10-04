import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

dotenv.config({ path: '../.env' });
dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({ origin: origins, credentials: false, methods: ['GET', 'POST'] });
  const port = Number(process.env.PORT ?? 8000);
  await app.listen(port);
  console.log(`Image Number Detection API listening on port ${port}`);
}

void bootstrap();
