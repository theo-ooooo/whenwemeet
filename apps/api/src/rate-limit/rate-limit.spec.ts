import type { ArgumentsHost } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { RateLimitedException } from '../common/errors.js';
import { HttpExceptionFilter } from '../common/http-exception.filter.js';
import { clientIpOf, INTERNAL_IP } from './client-ip.js';
import { RateLimit, SkipRateLimit } from './rate-limit.decorator.js';
import { bucketsFor, pathTokenOf, RateLimitGuard, RateLimitSettings } from './rate-limit.guard.js';
import { DEFAULT_IP_RULE, DEFAULT_USER_RULE, RATE_LIMIT_POLICIES } from './rate-limit.policies.js';
import { RateLimitStore } from './rate-limit.store.js';

const KEY = 'internal-key-for-test';
const SECRET = 'rate-limit-spec-secret-0123456789abcdef';

describe('RateLimitStore (고정 창)', () => {
  const bucket = { key: 'b', limit: 2, windowSec: 60 };

  it('한도까지 통과, 넘으면 창이 끝날 때까지의 초(올림)', () => {
    const store = new RateLimitStore();
    expect(store.consume([bucket], 0)).toEqual({ allowed: true });
    expect(store.consume([bucket], 1_000)).toEqual({ allowed: true });
    expect(store.consume([bucket], 10_500)).toEqual({ allowed: false, retryAfterSec: 50 });
  });

  it('창이 지나면 다시 0 부터', () => {
    const store = new RateLimitStore();
    store.consume([bucket], 0);
    store.consume([bucket], 0);
    expect(store.consume([bucket], 60_000)).toEqual({ allowed: true });
  });

  it('retryAfterSec 은 최소 1', () => {
    const store = new RateLimitStore();
    store.consume([bucket], 0);
    store.consume([bucket], 0);
    expect(store.consume([bucket], 59_999)).toEqual({ allowed: false, retryAfterSec: 1 });
  });

  it('하나라도 막히면 다른 버킷도 세지 않고, 가장 늦게 풀리는 버킷 기준으로 알린다', () => {
    const store = new RateLimitStore();
    const short = { key: 's', limit: 1, windowSec: 10 };
    const long = { key: 'l', limit: 1, windowSec: 100 };
    const free = { key: 'f', limit: 1, windowSec: 10 };
    store.consume([short], 0);
    store.consume([long], 0);
    expect(store.consume([short, long, free], 1_000)).toEqual({ allowed: false, retryAfterSec: 99 });
    // free 는 세지 않았으므로 아직 1번 남았다
    expect(store.consume([free], 1_000)).toEqual({ allowed: true });
  });

  it('만료된 카운터는 1분마다 지운다', () => {
    const store = new RateLimitStore();
    store.consume([{ key: 'a', limit: 5, windowSec: 1 }], 60_000);
    store.consume([{ key: 'b', limit: 5, windowSec: 1 }], 60_000);
    expect(store.size).toBe(2);
    store.consume([{ key: 'c', limit: 5, windowSec: 1 }], 120_001);
    expect(store.size).toBe(1);
  });
});

describe('clientIpOf (IP 판정)', () => {
  const req = (headers: Record<string, string | string[]>, remoteAddress?: string) => ({ headers, socket: { remoteAddress } });

  it('내부 키가 맞으면 X-Client-IP', () => {
    expect(clientIpOf(req({ 'x-internal-key': KEY, 'x-client-ip': ' 203.0.113.9 ', 'x-real-ip': '76.76.21.1' }), KEY)).toBe('203.0.113.9');
  });

  it('내부 키가 맞지만 X-Client-IP 가 없거나 너무 길면 "internal" 한 묶음', () => {
    expect(clientIpOf(req({ 'x-internal-key': KEY }), KEY)).toBe(INTERNAL_IP);
    expect(clientIpOf(req({ 'x-internal-key': KEY, 'x-client-ip': 'x'.repeat(101) }), KEY)).toBe(INTERNAL_IP);
  });

  it('키가 다르거나 없으면 X-Client-IP 를 믿지 않고 X-Real-IP', () => {
    expect(clientIpOf(req({ 'x-internal-key': 'wrong', 'x-client-ip': '1.1.1.1', 'x-real-ip': '198.51.100.7' }), KEY)).toBe('198.51.100.7');
    expect(clientIpOf(req({ 'x-client-ip': '1.1.1.1', 'x-real-ip': '198.51.100.7' }), KEY)).toBe('198.51.100.7');
  });

  it('API 에 키가 없으면(개발) 누구의 X-Client-IP 도 믿지 않는다', () => {
    expect(clientIpOf(req({ 'x-internal-key': '', 'x-client-ip': '1.1.1.1' }, '10.0.0.5'), undefined)).toBe('10.0.0.5');
    expect(clientIpOf(req({ 'x-internal-key': '', 'x-client-ip': '1.1.1.1' }, '10.0.0.5'), '')).toBe('10.0.0.5');
  });

  it('X-Forwarded-For 는 쓰지 않는다. X-Real-IP 가 없으면 소켓 주소, 그것도 없으면 "unknown"', () => {
    expect(clientIpOf(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, '::ffff:127.0.0.1'), KEY)).toBe('::ffff:127.0.0.1');
    expect(clientIpOf(req({}), KEY)).toBe('unknown');
  });

  it('배열 헤더는 첫 값', () => {
    expect(clientIpOf(req({ 'x-internal-key': [KEY, 'x'], 'x-client-ip': ['203.0.113.1', '9.9.9.9'] }), KEY)).toBe('203.0.113.1');
  });
});

describe('bucketsFor (한도 고르기)', () => {
  const anon = { ip: '1.2.3.4', userId: null };
  const user = { ip: '1.2.3.4', userId: 7 };

  it('기본 한도: 로그인이면 사용자 300/1분, 아니면 IP 600/1분', () => {
    expect(DEFAULT_USER_RULE).toEqual({ scope: 'user', limit: 300, windowSec: 60 });
    expect(DEFAULT_IP_RULE).toEqual({ scope: 'ip', limit: 600, windowSec: 60 });
    expect(bucketsFor(anon, undefined)).toEqual([{ key: 'default:ip:1.2.3.4', limit: 600, windowSec: 60 }]);
    expect(bucketsFor(user, undefined)).toEqual([{ key: 'default:user:7', limit: 300, windowSec: 60 }]);
  });

  it('경로 한도는 승인된 표 그대로', () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      login: [{ scope: 'ip', limit: 20, windowSec: 60 }],
      invitePreview: [{ scope: 'ip', limit: 30, windowSec: 60 }],
      inviteJoin: [
        { scope: 'user', limit: 10, windowSec: 600 },
        { scope: 'ip', limit: 30, windowSec: 600 },
      ],
      avatarUpload: [{ scope: 'user', limit: 20, windowSec: 3600 }],
      icsPreview: [{ scope: 'user', limit: 30, windowSec: 3600 }],
      icsImport: [{ scope: 'user', limit: 10, windowSec: 3600 }],
      eventSharePreview: [{ scope: 'ip', limit: 30, windowSec: 60 }],
      eventShareCreate: [{ scope: 'user', limit: 30, windowSec: 3600 }],
      icsFeed: [
        { scope: 'token', limit: 10, windowSec: 60 },
        { scope: 'ip', limit: 60, windowSec: 60 },
      ],
      placeSearch: [{ scope: 'user', limit: 60, windowSec: 60 }],
    });
  });

  it('(#193) 구독 피드는 기본 + 주소(경로 토큰) + IP. 토큰이 없으면 주소 한도는 건너뛴다', () => {
    expect(bucketsFor({ ...anon, token: 'tok' }, { policy: 'icsFeed' })).toEqual([
      { key: 'default:ip:1.2.3.4', limit: 600, windowSec: 60 },
      { key: 'icsFeed:token:tok', limit: 10, windowSec: 60 },
      { key: 'icsFeed:ip:1.2.3.4', limit: 60, windowSec: 60 },
    ]);
    expect(bucketsFor(anon, { policy: 'icsFeed' }).map((b) => b.key)).toEqual(['default:ip:1.2.3.4', 'icsFeed:ip:1.2.3.4']);
  });

  it('(#193) pathTokenOf: 문자열 `:token` 만, 64자까지', () => {
    expect(pathTokenOf({ params: { token: 'abc' } } as never)).toBe('abc');
    expect(pathTokenOf({ params: { token: 'x'.repeat(100) } } as never)).toBe('x'.repeat(64));
    expect(pathTokenOf({ params: {} } as never)).toBeNull();
    expect(pathTokenOf({ params: { token: '' } } as never)).toBeNull();
    expect(pathTokenOf({} as never)).toBeNull();
  });

  it('초대 합류는 기본 + 사용자 + IP', () => {
    expect(bucketsFor(user, { policy: 'inviteJoin' }).map((b) => b.key)).toEqual([
      'default:user:7',
      'inviteJoin:user:7',
      'inviteJoin:ip:1.2.3.4',
    ]);
  });

  it('로그인하지 않은 요청에는 user 한도를 걸지 않는다', () => {
    expect(bucketsFor(anon, { policy: 'avatarUpload' }).map((b) => b.key)).toEqual(['default:ip:1.2.3.4']);
  });
});

describe('RateLimitGuard', () => {
  const jwt = new JwtService({ secret: SECRET, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } });
  const config = new ConfigService({ INTERNAL_API_KEY: KEY, WEB_ORIGIN: 'https://whenwemeet.day' });

  class Ctrl {
    plain(): void {}
    @RateLimit('login', { redirectToLogin: true })
    login(): void {}
    @RateLimit('inviteJoin')
    join(): void {}
    @SkipRateLimit()
    health(): void {}
  }

  function setup(enabled = true) {
    const store = new RateLimitStore();
    const settings = new RateLimitSettings();
    settings.enabled = enabled;
    let now = 1_000_000;
    settings.now = () => now;
    const guard = new RateLimitGuard(new Reflector(), jwt, config, store, settings);
    const run = (handler: keyof Ctrl, headers: Record<string, string> = {}) =>
      guard.canActivate({
        getType: () => 'http',
        getHandler: () => Ctrl.prototype[handler],
        getClass: () => Ctrl,
        switchToHttp: () => ({ getRequest: () => ({ headers, socket: { remoteAddress: '10.0.0.1' } }) }),
      } as never);
    return { run, store, advance: (ms: number) => (now += ms) };
  }

  async function hit(run: () => Promise<boolean>, times: number): Promise<void> {
    for (let i = 0; i < times; i++) await run();
  }

  it('IP 기본 한도 600 을 넘으면 429 RATE_LIMITED + retryAfterSec', async () => {
    const { run, advance } = setup();
    await hit(() => run('plain'), 600);
    advance(15_000);
    const error = await run('plain').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedException);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 45 });
    expect((error as RateLimitedException).toBody().error).toEqual({ code: 'RATE_LIMITED', details: { retryAfterSec: 45 } });
    // 창이 지나면 다시 통과
    advance(45_000);
    await expect(run('plain')).resolves.toBe(true);
  });

  it('유효한 JWT 면 사용자 300 한도. 같은 IP 의 다른 사용자는 따로 센다', async () => {
    const { run } = setup();
    const a = { authorization: `Bearer ${jwt.sign({ sub: '7' })}` };
    const b = { authorization: `Bearer ${jwt.sign({ sub: '8' })}` };
    await hit(() => run('plain', a), 300);
    await expect(run('plain', a)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(run('plain', b)).resolves.toBe(true);
  });

  it('서명이 틀린 토큰은 IP 로 센다 (남의 sub 로 그 사람 한도를 소진시키지 못한다)', async () => {
    const { run } = setup();
    const forged = new JwtService({ secret: 'other-secret-0123456789abcdef0123' }).sign({ sub: '7' });
    await hit(() => run('plain', { authorization: `Bearer ${forged}` }), 600);
    await expect(run('plain', { authorization: `Bearer ${forged}` })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(run('plain', { authorization: `Bearer ${jwt.sign({ sub: '7' })}` })).resolves.toBe(true);
  });

  it('브라우저 로그인 경로는 웹 로그인 화면으로 보낼 주소를 싣는다', async () => {
    const { run } = setup();
    await hit(() => run('login'), 20);
    await expect(run('login')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      redirectTo: 'https://whenwemeet.day/login?error=RATE_LIMITED',
    });
  });

  it('초대 합류: 사용자 10/10분, 계정을 바꿔도 IP 30/10분', async () => {
    const { run } = setup();
    const userA = { authorization: `Bearer ${jwt.sign({ sub: '1' })}`, 'x-internal-key': KEY, 'x-client-ip': '203.0.113.5' };
    await hit(() => run('join', userA), 10);
    await expect(run('join', userA)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSec: 600 });
    for (const sub of ['2', '3']) {
      await hit(() => run('join', { ...userA, authorization: `Bearer ${jwt.sign({ sub })}` }), 10);
    }
    const userD = { ...userA, authorization: `Bearer ${jwt.sign({ sub: '4' })}` };
    await expect(run('join', userD)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // 다른 IP 의 같은 사용자 D 는 통과
    await expect(run('join', { ...userD, 'x-client-ip': '203.0.113.6' })).resolves.toBe(true);
  });

  it('@SkipRateLimit 과 꺼진 설정은 세지 않는다', async () => {
    const skip = setup();
    await hit(() => skip.run('health'), 700);
    expect(skip.store.size).toBe(0);
    const off = setup(false);
    await hit(() => off.run('plain'), 700);
    expect(off.store.size).toBe(0);
  });
});

describe('HttpExceptionFilter 의 RATE_LIMITED', () => {
  function response() {
    const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), redirect: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  }
  const hostOf = (res: unknown) => ({ switchToHttp: () => ({ getResponse: () => res }) }) as unknown as ArgumentsHost;

  it('429 봉투와 Retry-After', () => {
    const res = response();
    new HttpExceptionFilter().catch(new RateLimitedException(42), hostOf(res));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '42');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      status: 429,
      data: null,
      message: '잠시 후 다시 시도해 주세요',
      error: { code: 'RATE_LIMITED', details: { retryAfterSec: 42 } },
    });
  });

  it('redirectTo 가 있으면 JSON 대신 302', () => {
    const res = response();
    new HttpExceptionFilter().catch(new RateLimitedException(5, 'https://w.example/login?error=RATE_LIMITED'), hostOf(res));
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://w.example/login?error=RATE_LIMITED');
    expect(res.json).not.toHaveBeenCalled();
  });
});
