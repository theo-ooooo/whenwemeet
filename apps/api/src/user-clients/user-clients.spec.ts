import {
  CLIENT_UA_HEADER,
  parseClientUserAgent,
  trustedClientOf,
} from './client-platform.js';
import {
  TOUCH_CACHE_MAX,
  TOUCH_INTERVAL_MS,
  UserClientsClock,
  UserClientsService,
} from './user-clients.service.js';
import { UserClientsRepository } from './user-clients.repository.js';
import {
  mockRepository,
  type RepositoryMock,
} from '../testing/repository-mock.js';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhenwemeetApp/1.3.0 (ios)';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 WhenwemeetApp/1.2.1 (android)';
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

describe('parseClientUserAgent (#532, D-288)', () => {
  it('앱 셸 UA 는 기종과 앱 버전', () => {
    expect(parseClientUserAgent(IOS_UA)).toEqual({
      platform: 'ios',
      appVersion: '1.3.0',
    });
    expect(parseClientUserAgent(ANDROID_UA)).toEqual({
      platform: 'android',
      appVersion: '1.2.1',
    });
  });

  it('브라우저 UA 는 web, 버전 없음', () => {
    expect(parseClientUserAgent(WEB_UA)).toEqual({
      platform: 'web',
      appVersion: null,
    });
  });

  it('깨진 값, 비슷한 값은 web', () => {
    for (const ua of [
      '',
      '%%%',
      'WhenwemeetApp/1.3.0',
      'WhenwemeetApp/1.3.0 (windows)',
      'WhenwemeetApp/ (ios)',
      'XWhenwemeetApp/1.3.0 (ios)',
      'WhenwemeetApp/1.3.0 (IOS)',
      `WhenwemeetApp/${'9'.repeat(33)} (ios)`,
    ]) {
      expect(parseClientUserAgent(ua)).toEqual({
        platform: 'web',
        appVersion: null,
      });
    }
  });

  it('버전은 32자까지, 512자 뒤의 표시는 보지 않는다', () => {
    expect(
      parseClientUserAgent(`WhenwemeetApp/${'1'.repeat(32)} (android)`),
    ).toEqual({ platform: 'android', appVersion: '1'.repeat(32) });
    expect(
      parseClientUserAgent(`${'x'.repeat(600)} WhenwemeetApp/1.3.0 (ios)`)
        .platform,
    ).toBe('web');
  });
});

describe('trustedClientOf (#532): 내부 키가 맞을 때만 X-Client-UA 를 믿는다', () => {
  const KEY = 'internal-key';
  const req = (headers: Record<string, string | string[]>) => ({ headers });

  it('키가 맞으면 UA 해석', () => {
    expect(
      trustedClientOf(
        req({ 'x-internal-key': KEY, [CLIENT_UA_HEADER]: IOS_UA }),
        KEY,
      ),
    ).toEqual({ platform: 'ios', appVersion: '1.3.0' });
    expect(
      trustedClientOf(
        req({ 'x-internal-key': [KEY], [CLIENT_UA_HEADER]: [WEB_UA] }),
        KEY,
      ),
    ).toEqual({ platform: 'web', appVersion: null });
  });

  it('키가 틀리거나 없거나 서버 키가 비었으면 null (직접 온 요청의 헤더는 무시)', () => {
    expect(
      trustedClientOf(
        req({ 'x-internal-key': 'wrong', [CLIENT_UA_HEADER]: IOS_UA }),
        KEY,
      ),
    ).toBeNull();
    expect(
      trustedClientOf(
        req({ [CLIENT_UA_HEADER]: IOS_UA, 'user-agent': IOS_UA }),
        KEY,
      ),
    ).toBeNull();
    expect(
      trustedClientOf(
        req({ 'x-internal-key': '', [CLIENT_UA_HEADER]: IOS_UA }),
        '',
      ),
    ).toBeNull();
    expect(
      trustedClientOf(
        req({ 'x-internal-key': KEY, [CLIENT_UA_HEADER]: IOS_UA }),
        undefined,
      ),
    ).toBeNull();
  });

  it('키는 맞지만 UA 헤더가 없거나 비면 null (웹 서버 자신의 호출)', () => {
    expect(trustedClientOf(req({ 'x-internal-key': KEY }), KEY)).toBeNull();
    expect(
      trustedClientOf(
        req({ 'x-internal-key': KEY, [CLIENT_UA_HEADER]: '  ' }),
        KEY,
      ),
    ).toBeNull();
  });
});

describe('UserClientsService (#532): 1시간에 한 번만 쓴다', () => {
  let repo: RepositoryMock<UserClientsRepository>;
  let clock: UserClientsClock;
  let service: UserClientsService;
  let now: number;
  const ios = { platform: 'ios' as const, appVersion: '1.3.0' };
  const web = { platform: 'web' as const, appVersion: null };

  beforeEach(() => {
    repo = mockRepository(UserClientsRepository);
    repo.touch.mockResolvedValue(undefined);
    now = Date.parse('2026-11-25T00:00:00Z');
    clock = { now: () => now };
    service = new UserClientsService(repo as never, clock);
  });

  it('처음은 쓰고, 1시간 안은 건너뛰고, 1시간이 지나면 다시 쓴다', async () => {
    expect(await service.record(1, ios)).toBe(true);
    expect(repo.touch).toHaveBeenLastCalledWith(1, ios, new Date(now));
    now += TOUCH_INTERVAL_MS - 1;
    expect(await service.record(1, ios)).toBe(false);
    now += 1;
    expect(await service.record(1, ios)).toBe(true);
    expect(repo.touch).toHaveBeenCalledTimes(2);
  });

  it('사용자, 기종이 다르면 따로 센다', async () => {
    expect(await service.record(1, ios)).toBe(true);
    expect(await service.record(1, web)).toBe(true);
    expect(await service.record(2, ios)).toBe(true);
    expect(await service.record(1, web)).toBe(false);
    expect(repo.touch).toHaveBeenCalledTimes(3);
  });

  it('앱 버전이 바뀌면 간격 안이라도 쓴다', async () => {
    await service.record(1, ios);
    now += 60_000;
    expect(
      await service.record(1, { platform: 'ios', appVersion: '1.4.0' }),
    ).toBe(true);
    expect(repo.touch).toHaveBeenCalledTimes(2);
  });

  it('동시에 온 두 요청은 한 번만 쓴다', async () => {
    const results = await Promise.all([
      service.record(1, ios),
      service.record(1, ios),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(repo.touch).toHaveBeenCalledTimes(1);
  });

  it('DB 실패는 던지지 않고 false, 다음 요청에서 다시 시도한다', async () => {
    repo.touch.mockRejectedValueOnce(new Error('FK 실패'));
    expect(await service.record(1, ios)).toBe(false);
    expect(await service.record(1, ios)).toBe(true);
    expect(repo.touch).toHaveBeenCalledTimes(2);
  });

  it('캐시는 상한을 넘지 않는다 (가장 오래된 것부터 버림)', async () => {
    for (let id = 1; id <= TOUCH_CACHE_MAX + 5; id++)
      await service.record(id, web);
    expect(service.cacheSize).toBe(TOUCH_CACHE_MAX);
    // 1번은 버려졌으니 다시 쓰고, 마지막 사람은 남아 있어 건너뛴다
    expect(await service.record(1, web)).toBe(true);
    expect(await service.record(TOUCH_CACHE_MAX + 5, web)).toBe(false);
  });
});
