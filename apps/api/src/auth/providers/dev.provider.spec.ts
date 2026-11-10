import { AuthProviders } from './auth-providers.js';
import { DevProvider } from './dev.provider.js';

describe('DevProvider', () => {
  it('코드 = 닉네임 = providerUserId, 사진 없음, unlink 는 할 일 없음', async () => {
    const dev = new DevProvider();
    expect(dev.provider).toBe('DEV');
    expect(await dev.exchangeCode('개발')).toEqual({ providerUserId: '개발', nickname: '개발', profileImageUrl: null, raw: { nickname: '개발' } });
    await expect(dev.unlink('개발')).resolves.toBeUndefined();
  });
});

describe('AuthProviders', () => {
  it('이름으로 구현을 찾고, 붙이지 않은 제공자는 오류', () => {
    const kakao = { provider: 'KAKAO' as const, exchangeCode: vi.fn(), unlink: vi.fn() };
    const dev = new DevProvider();
    const providers = new AuthProviders(kakao as never, dev);
    expect(providers.get('KAKAO')).toBe(kakao);
    expect(providers.get('DEV')).toBe(dev);
    expect(() => providers.get('NAVER')).toThrow('지원하지 않는 로그인 제공자: NAVER');
  });
});
