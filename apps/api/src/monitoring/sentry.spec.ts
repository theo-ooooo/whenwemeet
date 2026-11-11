import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ApiException } from '../common/errors.js';
import { HttpExceptionFilter } from '../common/http-exception.filter.js';
import { FILTERED } from './sentry-scrub.js';
import { initSentry, PRIVATE_DATA_COLLECTION, reportError, sentryOptions, shouldReport } from './sentry.js';

const DSN = 'https://public@o0.ingest.sentry.io/0';

describe('sentryOptions', () => {
  it('SENTRY_DSN 이 비거나 공백이면 null (SDK 를 띄우지 않음)', () => {
    expect(sentryOptions({})).toBeNull();
    expect(sentryOptions({ SENTRY_DSN: '  ' })).toBeNull();
    expect(initSentry({})).toBe(false);
    expect(Sentry.isInitialized()).toBe(false);
  });

  it('오류만: 트레이싱 표본 없음, 개인정보 수집 끔, 환경은 SENTRY_ENVIRONMENT > NODE_ENV', () => {
    const o = sentryOptions({ SENTRY_DSN: ` ${DSN} `, NODE_ENV: 'production' });
    expect(o?.dsn).toBe(DSN);
    expect(o?.environment).toBe('production');
    expect(o?.tracesSampleRate).toBeUndefined();
    expect(o?.tracesSampler).toBeUndefined();
    expect(o?.dataCollection).toBe(PRIVATE_DATA_COLLECTION);
    expect(PRIVATE_DATA_COLLECTION).toMatchObject({ userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
    expect(sentryOptions({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'staging', NODE_ENV: 'production' })?.environment).toBe('staging');
    expect(sentryOptions({ SENTRY_DSN: DSN })?.environment).toBe('development');
  });
});

describe('shouldReport', () => {
  it.each([
    [new Error('boom'), 500, true],
    [new InternalServerErrorException(), 500, true],
    [new ApiException('INTERNAL'), 500, true],
    [new ApiException('KAKAO_ERROR'), 502, true],
    [new ApiException('KAKAO_NOT_CONFIGURED'), 503, false],
    [new ApiException('DB_UNAVAILABLE'), 503, false],
    [new ApiException('FORBIDDEN'), 403, false],
    [new NotFoundException(), 404, false],
  ])('%s (%i) → %s', (exception, status, expected) => {
    expect(shouldReport(exception, status)).toBe(expected);
  });
});

describe('Sentry 로 실제 나가는 이벤트 (가짜 전송)', () => {
  const sent: unknown[] = [];

  beforeAll(() => {
    const options = sentryOptions({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'test' });
    Sentry.init({
      ...options,
      transport: (transportOptions) =>
        Sentry.createTransport(transportOptions, async (request) => {
          sent.push(request.body);
          return { statusCode: 200 };
        }),
    });
  });

  afterAll(async () => {
    await Sentry.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  /** 보낸 봉투들의 본문. 스택 프레임의 소스 줄(이 테스트 파일의 문자열이 그대로 보인다)은 빼고 본다 */
  async function payloads(): Promise<string> {
    await Sentry.flush(2000);
    const text = sent.map((body) => (typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('utf8'))).join('\n');
    return text
      .split('\n')
      .map((line) => {
        if (!line.startsWith('{"exception"')) return line;
        const event = JSON.parse(line) as { exception: { values: Array<{ stacktrace?: unknown }> } };
        for (const v of event.exception.values) delete v.stacktrace;
        return JSON.stringify(event);
      })
      .join('\n');
  }

  it('예외 필터: 5xx 는 보내고, 4xx ApiException 과 설정 없음 503 은 보내지 않는다', async () => {
    const res = { status: () => res, json: () => res };
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    const filter = new HttpExceptionFilter();
    (filter as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };

    filter.catch(new ApiException('FORBIDDEN'), host as never);
    filter.catch(new ApiException('STORAGE_NOT_CONFIGURED'), host as never);
    expect(await payloads()).toBe('');

    filter.catch(new Error('db 깨짐 kim@example.com'), host as never);
    const body = await payloads();
    expect(body).toContain('db 깨짐');
    expect(body).toContain(FILTERED);
    expect(body).not.toContain('kim@example.com');
    expect(body).toContain('"environment":"test"');
  });

  it('스케줄러 등 HTTP 밖 오류는 where 태그를 단다. 요청 정보와 사용자도 거른다', async () => {
    Sentry.withScope((scope) => {
      scope.setUser({ id: 'u1', email: 'a@b.com', ip_address: '203.0.113.1' });
      scope.setSDKProcessingMetadata({
        normalizedRequest: { url: 'http://x/v1/auth/email?token=secret1', headers: { cookie: 'wwm_session=s1', 'x-internal-key': 'k1' }, data: '{"email":"a@b.com"}' },
      });
      reportError(new Error('tick 실패'), 'push.tick');
    });
    const body = await payloads();
    expect(body).toContain('"where":"push.tick"');
    expect(body).toContain('"id":"u1"');
    for (const secret of ['a@b.com', '203.0.113.1', 'secret1', 'wwm_session', 'k1']) expect(body).not.toContain(secret);
  });
});
