import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types.js';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APPLE_JWKS } from '../src/auth/providers/apple.provider.js';
import { EmailLoginConfig } from '../src/email-login/email-login.config.js';
import { MAIL_CLIENT, type MailClient } from '../src/email-login/mail-client.js';
import { FileUrlBuilder } from '../src/files/file-url.builder.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RateLimitSettings } from '../src/rate-limit/rate-limit.guard.js';
import { StorageService } from '../src/storage/storage.service.js';
import { fakeConfig } from '../src/testing/fake-config.js';

export type TestApp = INestApplication<App>;

export interface TestAppOptions {
  /** R2 대신 쓸 저장소 (MemoryStorage). 없으면 실제 StorageService 가 미설정 상태로 뜬다 */
  storage?: unknown;
  /** 파일 공개 주소 (R2_PUBLIC_BASE_URL). test-env 가 R2 변수를 비우므로 없으면 파일 URL 은 null */
  publicBaseUrl?: string;
  /** Apple JWKS 대신 쓸 로컬 키 집합 (apple.e2e-spec) */
  appleJwks?: unknown;
  /** (#245) 메일러 (가짜). 없으면 콘솔 메일러(보내지 않음) */
  mail?: MailClient;
  /** (#245) 이메일 로그인 설정을 process.env 위에 덮어쓴다 (스위치 끔 등) */
  emailEnv?: Record<string, string>;
  /**
   * (#186) 요청 제한. 기존 e2e 는 한 IP 로 수백 번 부르므로 기본은 끔. 켜면 now 로 시계를 바꿀 수 있다
   * (rate-limit.e2e-spec)
   */
  rateLimit?: { now?: () => number };
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.storage) builder.overrideProvider(StorageService).useValue(options.storage);
  if (options.publicBaseUrl) {
    builder.overrideProvider(FileUrlBuilder).useValue(new FileUrlBuilder(new ConfigService({ R2_PUBLIC_BASE_URL: options.publicBaseUrl })));
  }
  if (options.appleJwks) builder.overrideProvider(APPLE_JWKS).useValue(options.appleJwks);
  if (options.mail) builder.overrideProvider(MAIL_CLIENT).useValue(options.mail);
  if (options.emailEnv) builder.overrideProvider(EmailLoginConfig).useValue(new EmailLoginConfig(fakeConfig({ ...process.env, ...options.emailEnv })));
  const settings = new RateLimitSettings();
  settings.enabled = options.rateLimit !== undefined;
  if (options.rateLimit?.now) settings.now = options.rateLimit.now;
  builder.overrideProvider(RateLimitSettings).useValue(settings);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<TestApp>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

/** 모든 테이블 비우기. FK 순서를 피하려고 자식부터 지운다. 푸시 임대 행은 처음 상태로 (#188) */
export async function resetDb(app: TestApp): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.pushDelivery.deleteMany();
  await prisma.pushNotification.deleteMany();
  await prisma.pushDevice.deleteMany();
  await prisma.schedulerLease.deleteMany();
  await prisma.schedulerLease.create({ data: { name: 'push', leaseUntil: new Date(0) } });
  await prisma.groupActivity.deleteMany();
  await prisma.eventLog.deleteMany();
  await prisma.event.deleteMany();
  await prisma.anniversary.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.file.deleteMany();
  await prisma.authHandoff.deleteMany();
  await prisma.emailLoginChallenge.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();
}

export interface Session {
  token: string;
  userId: number;
  nickname: string;
}

/** 개발 전용 로그인으로 세션 하나 */
export async function devLogin(app: TestApp, nickname: string): Promise<Session> {
  const res = await api(app).post('/v1/auth/dev-login').send({ nickname }).expect(200);
  return { token: res.body.data.token as string, userId: res.body.data.user.id as number, nickname };
}

export function auth(session: Session): { Authorization: string } {
  return { Authorization: `Bearer ${session.token}` };
}

/**
 * 응답 봉투 불변식 (api.md 1장, 결정기록 D-33). 리다이렉트(3xx) 는 봉투 대상이 아니라 건너뛴다
 * - 공통: `status` 는 실제 HTTP 상태 코드와 같다
 * - 성공: `{ status, data, message: "OK" }`, error 없음
 * - 실패: `{ status, data: null, message, error: { code, details? } }`
 */
export function assertEnvelope(res: Response): void {
  if (res.status >= 300 && res.status < 400) return;
  expect(res.body.status).toBe(res.status);
  if (res.status < 300) {
    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'status']);
    expect(res.body.message).toBe('OK');
    return;
  }
  expect(res.body.data).toBeNull();
  expect(typeof res.body.message).toBe('string');
  expect(res.body.message).not.toBe('');
  expect(typeof res.body.error.code).toBe('string');
  expect(Object.keys(res.body.error).every((key) => key === 'code' || key === 'details')).toBe(true);
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/** supertest 요청. 모든 응답에 assertEnvelope 를 자동으로 건다 */
export function api(app: TestApp): ReturnType<typeof request> {
  const agent = request(app.getHttpServer());
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop === 'string' && HTTP_METHODS.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => (value as (...a: unknown[]) => request.Test).apply(target, args).expect(assertEnvelope);
      }
      return value;
    },
  });
}
