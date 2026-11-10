import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { validateEnv } from './config/env.validation.js';

async function bootstrap() {
  // 운영(NODE_ENV=production) 에서 필수 환경 변수가 빠지면 여기서 멈춘다 (#50). 운영은 .env 파일 없이 플랫폼 변수만 쓴다
  validateEnv(process.env);
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 4000);
}
await bootstrap();
