import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export type TestApp = INestApplication<App>;

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<TestApp>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** 모든 테이블 비우기. FK 순서를 피하려고 자식부터 지운다 */
export async function resetDb(app: TestApp): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.eventLog.deleteMany();
  await prisma.event.deleteMany();
  await prisma.anniversary.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
}

export interface Session {
  token: string;
  userId: string;
  nickname: string;
}

/** 개발 전용 로그인으로 세션 하나 */
export async function devLogin(app: TestApp, nickname: string): Promise<Session> {
  const res = await request(app.getHttpServer()).post('/v1/auth/dev-login').send({ nickname }).expect(200);
  return { token: res.body.data.token as string, userId: res.body.data.user.id as string, nickname };
}

export function auth(session: Session): { Authorization: string } {
  return { Authorization: `Bearer ${session.token}` };
}

export function api(app: TestApp) {
  return request(app.getHttpServer());
}
