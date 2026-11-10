import { ApiException } from '../../common/errors.js';
import { urlOf } from '../../testing/fetch-url.js';
import { KAKAO_ME_URL, KAKAO_TOKEN_INFO_URL, KAKAO_TOKEN_URL, KAKAO_UNLINK_URL, KakaoProvider } from './kakao.provider.js';

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
  KAKAO_APP_ID: '1234',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('KakaoProvider', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('설정 유무', () => {
    expect(new KakaoProvider(configOf(FULL)).isLoginConfigured()).toBe(true);
    expect(new KakaoProvider(configOf({ ...FULL, KAKAO_CLIENT_ID: '' })).isLoginConfigured()).toBe(false);
    expect(new KakaoProvider(configOf({ ...FULL, KAKAO_ADMIN_KEY: undefined })).isUnlinkConfigured()).toBe(false);
    expect(new KakaoProvider(configOf(FULL)).isAppConfigured()).toBe(true);
    expect(new KakaoProvider(configOf({ ...FULL, KAKAO_APP_ID: '' })).isAppConfigured()).toBe(false);
  });

  describe('verifyAppToken (앱.md 3.1)', () => {
    it('app_id 가 같으면 통과, Bearer 로 access_token_info 를 부른다 (숫자/문자열 app_id 모두)', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => json({ id: 5, expires_in: 100, app_id: 1234 }));
      globalThis.fetch = fetchMock;
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).resolves.toBeUndefined();
      expect(urlOf(fetchMock.mock.calls[0][0])).toBe(KAKAO_TOKEN_INFO_URL);
      expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer AT');

      globalThis.fetch = vi.fn<typeof fetch>(async () => json({ app_id: '1234' }));
      await expect(new KakaoProvider(configOf({ ...FULL, KAKAO_APP_ID: ' 1234 ' })).verifyAppToken('AT')).resolves.toBeUndefined();
    });

    it('다른 앱의 토큰(app_id 불일치) → 401 SOCIAL_TOKEN_INVALID', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () => json({ id: 5, app_id: 9999 }));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });
    });

    it('토큰 무효(401) → SOCIAL_TOKEN_INVALID, 그 밖의 실패와 app_id 없음 → KAKAO_ERROR', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -401 }, 401));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'SOCIAL_TOKEN_INVALID' });

      globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -2 }, 400));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

      globalThis.fetch = vi.fn<typeof fetch>(async () => json({}, 503));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

      globalThis.fetch = vi.fn<typeof fetch>(async () => json({ id: 5 }));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

      globalThis.fetch = vi.fn<typeof fetch>(async () => new Response('not json', { status: 200 }));
      await expect(new KakaoProvider(configOf(FULL)).verifyAppToken('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    });

    it('KAKAO_APP_ID 가 없으면 카카오를 부르지 않고 503 KAKAO_NOT_CONFIGURED (D-55)', async () => {
      const fetchMock = vi.fn<typeof fetch>();
      globalThis.fetch = fetchMock;
      await expect(new KakaoProvider(configOf({ ...FULL, KAKAO_APP_ID: undefined })).verifyAppToken('AT')).rejects.toMatchObject({
        code: 'KAKAO_NOT_CONFIGURED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('authorizeUrl 은 필수 파라미터를 싣고, 미설정이면 KAKAO_NOT_CONFIGURED', () => {
    const url = new URL(new KakaoProvider(configOf(FULL)).authorizeUrl('STATE'));
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe(FULL.KAKAO_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('scope')).toBe('profile_nickname,profile_image');
    expect(() => new KakaoProvider(configOf({})).authorizeUrl('S')).toThrow(ApiException);
  });

  it('requestAccessToken: 성공 / HTTP 실패 / 토큰 없음 / secret 없이', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ access_token: 'AT' }));
    globalThis.fetch = fetchMock;
    expect(await new KakaoProvider(configOf(FULL)).requestAccessToken('CODE')).toBe('AT');
    const [url, init] = fetchMock.mock.calls[0];
    expect(urlOf(url)).toBe(KAKAO_TOKEN_URL);
    const body = init!.body as URLSearchParams;
    expect(body.get('client_secret')).toBe('csecret');
    expect(body.get('code')).toBe('CODE');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}, 401));
    await expect(new KakaoProvider(configOf(FULL)).requestAccessToken('x')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}));
    await expect(new KakaoProvider(configOf(FULL)).requestAccessToken('x')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    const noSecret = vi.fn<typeof fetch>(async () => json({ access_token: 'AT' }));
    globalThis.fetch = noSecret;
    await new KakaoProvider(configOf({ ...FULL, KAKAO_CLIENT_SECRET: undefined })).requestAccessToken('x');
    expect((noSecret.mock.calls[0][1]!.body as URLSearchParams).has('client_secret')).toBe(false);

    await expect(new KakaoProvider(configOf({})).requestAccessToken('x')).rejects.toMatchObject({ code: 'KAKAO_NOT_CONFIGURED' });
  });

  it('fetchProfile: id/nickname/profile_image 만, 비어 있으면 기본값', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ id: 123456789012, kakao_account: { email: 'x@y', profile: { nickname: '  닉  ', profile_image_url: 'https://img' } } }),
    );
    globalThis.fetch = fetchMock;
    const profile = await new KakaoProvider(configOf(FULL)).fetchProfile('AT');
    expect(profile).toEqual({
      providerUserId: '123456789012',
      nickname: '닉',
      profileImageUrl: 'https://img',
      raw: { id: 123456789012, nickname: '  닉  ', profile_image_url: 'https://img' },
    });
    expect(urlOf(fetchMock.mock.calls[0][0])).toBe(KAKAO_ME_URL);
    expect((fetchMock.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('Bearer AT');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ id: '77' }));
    expect(await new KakaoProvider(configOf(FULL)).fetchProfile('AT')).toEqual({
      providerUserId: '77',
      nickname: '카카오 사용자',
      profileImageUrl: null,
      raw: { id: '77', nickname: null, profile_image_url: null },
    });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}));
    await expect(new KakaoProvider(configOf(FULL)).fetchProfile('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({}, 500));
    await expect(new KakaoProvider(configOf(FULL)).fetchProfile('AT')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
  });

  it('exchangeCode: 토큰 교환 후 프로필 조회까지 한 번에, 이메일은 수집하지 않는다', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input) === KAKAO_TOKEN_URL
        ? json({ access_token: 'AT' })
        : json({ id: 5, kakao_account: { email: 'x@y', profile: { nickname: '닉' } } }),
    );
    globalThis.fetch = fetchMock;
    const provider = new KakaoProvider(configOf(FULL));
    expect(provider.provider).toBe('KAKAO');
    const profile = await provider.exchangeCode('CODE');
    expect(profile).toMatchObject({ providerUserId: '5', nickname: '닉', profileImageUrl: null });
    expect(profile).not.toHaveProperty('email');
    expect(JSON.stringify(profile.raw)).not.toContain('x@y');
    expect((fetchMock.mock.calls[1][1]!.headers as Record<string, string>).Authorization).toBe('Bearer AT');
  });

  it('unlink: 성공 / -101 은 성공 / 그 외 실패 / 본문 없는 실패 / 미설정', async () => {
    const ok = vi.fn<typeof fetch>(async () => json({ id: 1 }));
    globalThis.fetch = ok;
    await new KakaoProvider(configOf(FULL)).unlink('99');
    expect(urlOf(ok.mock.calls[0][0])).toBe(KAKAO_UNLINK_URL);
    expect((ok.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('KakaoAK admin');
    expect((ok.mock.calls[0][1]!.body as URLSearchParams).get('target_id')).toBe('99');

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -101 }, 400));
    await expect(new KakaoProvider(configOf(FULL)).unlink('99')).resolves.toBeUndefined();

    globalThis.fetch = vi.fn<typeof fetch>(async () => json({ code: -401 }, 401));
    await expect(new KakaoProvider(configOf(FULL)).unlink('99')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response('not json', { status: 500 }));
    await expect(new KakaoProvider(configOf(FULL)).unlink('99')).rejects.toMatchObject({ code: 'KAKAO_ERROR' });

    await expect(new KakaoProvider(configOf({ ...FULL, KAKAO_ADMIN_KEY: '' })).unlink('99')).rejects.toMatchObject({ code: 'KAKAO_NOT_CONFIGURED' });
  });
});
