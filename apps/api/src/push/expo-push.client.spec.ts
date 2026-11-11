import type { ConfigService } from '@nestjs/config';
import { urlOf } from '../testing/fetch-url.js';
import { DEFAULT_EXPO_PUSH_URL, ExpoPushClient, type FetchFn } from './expo-push.client.js';
import type { ExpoMessage } from './push-copy.js';

const message = (to: string): ExpoMessage => ({
  to,
  title: 't',
  sound: 'default',
  priority: 'high',
  channelId: 'default',
  data: { url: '/', kind: 'REMINDER', nid: 1 },
  expiration: 0,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** process.env 와 무관한 설정 (e2e globalSetup 이 EXPO_PUSH_URL 을 넣어 두므로 ConfigService 를 쓰지 않는다) */
function client(fetchFn: FetchFn, env: Record<string, string> = {}): ExpoPushClient {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new ExpoPushClient(config, fetchFn);
}

describe('ExpoPushClient (가짜 fetch, D-94)', () => {
  it('기본 주소 /send, 헤더, 액세스 토큰이 있으면 Bearer', async () => {
    const fetchFn = vi.fn(async () => json(200, { data: [{ status: 'ok', id: 'x' }] }));
    await client(fetchFn as FetchFn, { EXPO_ACCESS_TOKEN: 'secret' }).send([message('a')]);
    const [input, init] = fetchFn.mock.calls[0] as unknown as [RequestInfo, RequestInit];
    expect(urlOf(input)).toBe(`${DEFAULT_EXPO_PUSH_URL}/send`);
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate', Authorization: 'Bearer secret' });
    expect(JSON.parse(init.body as string)).toEqual([message('a')]);
  });

  it('토큰이 없으면 Authorization 을 보내지 않고, EXPO_PUSH_URL 을 따른다', async () => {
    const fetchFn = vi.fn(async () => json(200, { data: [{ status: 'ok', id: 'x' }] }));
    await client(fetchFn as FetchFn, { EXPO_PUSH_URL: 'http://127.0.0.1:9/push/' }).send([message('a')]);
    const [input, init] = fetchFn.mock.calls[0] as unknown as [RequestInfo, RequestInit];
    expect(urlOf(input)).toBe('http://127.0.0.1:9/push/send');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('티켓을 메시지 순서대로 ok / 오류 코드로', async () => {
    const fetchFn = vi.fn(async () =>
      json(200, { data: [{ status: 'ok', id: 'x' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }, { status: 'error' }] }),
    );
    expect(await client(fetchFn as FetchFn).send([message('a'), message('b'), message('c')])).toEqual({
      type: 'tickets',
      tickets: [
        { status: 'ok', id: 'x' },
        { status: 'error', code: 'DeviceNotRegistered' },
        { status: 'error', code: 'UnknownError' },
      ],
    });
  });

  it('429, 5xx, 연결 실패 → retry. 타임아웃, 본문 해석 실패, 티켓 수 불일치 → unknown. 그 밖 4xx → rejected', async () => {
    const send = (fetchFn: () => Promise<Response>) => client(fetchFn as FetchFn).send([message('a')]);
    expect(await send(async () => json(429, {}))).toMatchObject({ type: 'retry' });
    expect(await send(async () => json(502, {}))).toMatchObject({ type: 'retry' });
    expect(await send(async () => Promise.reject(new TypeError('fetch failed')))).toMatchObject({ type: 'retry', reason: 'CONNECTION' });
    expect(await send(async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))).toMatchObject({ type: 'unknown', reason: 'TIMEOUT' });
    expect(await send(async () => new Response('not json', { status: 200 }))).toMatchObject({ type: 'unknown' });
    expect(await send(async () => json(200, { data: [] }))).toMatchObject({ type: 'unknown' });
    expect(await send(async () => json(401, { errors: [] }))).toEqual({ type: 'rejected', code: 'HTTP_401' });
  });

  it('영수증: id → ok / 오류 코드, 실패하면 null', async () => {
    const fetchFn = vi.fn(async () => json(200, { data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }));
    const receipts = await client(fetchFn as FetchFn).getReceipts(['a', 'b']);
    expect(urlOf((fetchFn.mock.calls[0] as unknown as [RequestInfo])[0])).toBe(`${DEFAULT_EXPO_PUSH_URL}/getReceipts`);
    expect([...(receipts ?? [])]).toEqual([
      ['a', 'ok'],
      ['b', 'DeviceNotRegistered'],
    ]);
    expect(await client(async () => json(500, {})).getReceipts(['a'])).toBeNull();
    expect(await client(async () => Promise.reject(new TypeError('x'))).getReceipts(['a'])).toBeNull();
  });
});
