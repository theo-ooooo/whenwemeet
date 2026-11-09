import { ApiException } from '../common/errors.js';
import { urlOf } from '../testing/fetch-url.js';
import { KAKAO_ME_URL, KAKAO_TOKEN_URL, KAKAO_UNLINK_URL, KakaoClient } from './kakao.client.js';

function configOf(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`${key} 없음`);
      return value;
    },
  } as never;
}

const FULL = {
  KAKAO_CLIENT_ID: 'cid',
  KAKAO_CLIENT_SECRET: 'csecret',
  KAKAO_REDIRECT_URI: 'http://localhost:4000/v1/auth/kakao/callback',
  KAKAO_ADMIN_KEY: 'admin',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('KakaoClient', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('설정 유무', () => {
    expect(new KakaoClient(configOf(FULL)).isLoginConfigured()).toBe(true);
    expect(new KakaoClient(configOf({ ...FULL, KAKAO_CLIENT_ID: '' })).isLoginConfigured()).toBe(false);
    expect(new KakaoClient(configOf({ ...FULL, KAKAO_ADMIN_KEY: undefined })).isUnlinkConfigured()).toBe(false);
  });

  it('authorizeUrl 은 필수 파라미터를 싣고, 미설정이면 KAKAO_NOT_CONFIGURED', () => {
    const url = new URL(new KakaoClient(configOf(FULL)).authorizeUrl('STATE'));
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe(FULL.KAKAO_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('scope')).toBe('profile_nickname,profile_image');
    expect(() => new KakaoClient(configOf({})).authorizeUrl('S')).toThrow(ApiException);
  });

  it('exchangeCode: 성공 / HTTP 실패 / 토큰 없음 / secret 없이', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ access_token: 'AT' }));
    globalThis.fetch = fetchMock;
    expect(await new KakaoClient(configOf(FULL)).exchangeCode('CODE')).toBe('AT');
    const [url, init] = fetchMock.mock.calls[0];
    expect(urlOf(url)).toBe(KAKAO_TOKEN_URL);
    const body = init!.body as URLSearchParams;
    expect(body.get('client_secret')).toBe('csecret');
    expect(body.get('code')).toBe('CODE');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}, 401));
    await expect(new KakaoClient(configOf(FULL)).exchangeCode('x')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}));
    await expect(new KakaoClient(configOf(FULL)).exchangeCode('x')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    const noSecret = vi.fn<typeof fetch>(async () => json({ access_token: 'AT' }));
    globalThis.fetch = noSecret;
    await new KakaoClient(configOf({ ...FULL, KAKAO_CLIENT_SECRET: undefined })).exchangeCode('x');
    expect((noSecret.mock.calls[0][1]!.body as URLSearchParams).has('client_secret')).toBe(false);

    await expect(new KakaoClient(configOf({})).exchangeCode('x')).rejects.toMatchObject({ code: 'KAKAO_NOT_CONFIGURED' });
  });

  it('fetchProfile: id/nickname/profile_image 만, 비어 있으면 기본값', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ id: 123456789012, kakao_account: { email: 'x@y', profile: { nickname: '  닉  ', profile_image_url: 'https://img' } } }),
    );
    globalThis.fetch = fetchMock;
    const profile = await new KakaoClient(configOf(FULL)).fetchProfile('AT');
    expect(profile).toEqual({ kakaoId: 123456789012n, nickname: '닉', profileImageUrl: 'https://img' });
    expect(urlOf(fetchMock.mock.calls[0][0])).toBe(KAKAO_ME_URL);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer AT');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ id: '77' }));
    expect(await new KakaoClient(configOf(FULL)).fetchProfile('AT')).toEqual({ kakaoId: 77n, nickname: '카카오 사용자', profileImageUrl: null });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}));
    await expect(new KakaoClient(configOf(FULL)).fetchProfile('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}, 500));
    await expect(new KakaoClient(configOf(FULL)).fetchProfile('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
  });

  it('unlink: 성공 / -101 은 성공 / 그 외 실패 / 본문 없는 실패 / 미설정', async () => {
    const ok = vi.fn<typeof fetch>(async () => json({ id: 1 }));
    globalThis.fetch = ok;
    await new KakaoClient(configOf(FULL)).unlink(99n);
    expect(urlOf(ok.mock.calls[0][0])).toBe(KAKAO_UNLINK_URL);
    expect((ok.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('KakaoAK admin');
    expect((ok.mock.calls[0][1]!.body as URLSearchParams).get('target_id')).toBe('99');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -101 }, 400));
    await expect(new KakaoClient(configOf(FULL)).unlink(99n)).resolves.toBeUndefined();

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -401 }, 401));
    await expect(new KakaoClient(configOf(FULL)).unlink(99n)).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response('not json', { status: 500 }));
    await expect(new KakaoClient(configOf(FULL)).unlink(99n)).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    await expect(new KakaoClient(configOf({ ...FULL, KAKAO_ADMIN_KEY: '' })).unlink(99n)).rejects.toMatchObject({ code: 'KAKAO_NOT_CONFIGURED' });
  });
});
