import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthService, PERSONAL_GROUP_NAME } from './auth.service.js';

describe('AuthService', () => {
  let users: RepositoryMock<UsersRepository>;
  let service: AuthService;
  const jwt = { signAsync: vi.fn(async (payload: { sub: string }) => `jwt-for-${payload.sub}`) };
  const avatars = { importFromUrl: vi.fn() };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    avatars.importFromUrl.mockReset().mockResolvedValue(null);
    service = new AuthService(users as never, jwt as never, avatars as never);
  });

  it('sanitizeNext 는 같은 출처 상대 경로(+쿼리)만 허용 (세부 규칙은 next-path.spec)', () => {
    expect(service.sanitizeNext('/join/ABC123')).toBe('/join/ABC123');
    expect(service.sanitizeNext('/join/ABC123?auto=1')).toBe('/join/ABC123?auto=1');
    expect(service.sanitizeNext('//evil.example')).toBe('/');
    expect(service.sanitizeNext('https://evil.example')).toBe('/');
    expect(service.sanitizeNext(undefined)).toBe('/');
  });

  it('createState / parseState 는 왕복하고, 깨진 값은 null', () => {
    const { nonce, state } = service.createState('/join/ABC');
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(service.parseState(state)).toEqual({ nonce, next: '/join/ABC' });
    const withQuery = service.createState('/g/3/calendar?date=2026-11-12');
    expect(service.parseState(withQuery.state)?.next).toBe('/g/3/calendar?date=2026-11-12');
    expect(service.parseState('')).toBeNull();
    expect(service.parseState(undefined)).toBeNull();
    expect(service.parseState('@@@')).toBeNull();
    expect(service.parseState(Buffer.from('{"next":"/x"}').toString('base64url'))).toBeNull();
    // next 가 규칙 밖이면 / 로
    const bad = Buffer.from(JSON.stringify({ nonce: 'n', next: 'https://evil' })).toString('base64url');
    expect(service.parseState(bad)).toEqual({ nonce: 'n', next: '/' });
  });

  const kakaoProfile = {
    providerUserId: '123456789012',
    nickname: '카카오닉',
    profileImageUrl: 'https://img',
    raw: { id: 123456789012, nickname: '카카오닉', profile_image_url: 'https://img' },
  };

  it('login: 연결 계정이 있으면 rawProfile 만 갱신하고 닉네임/사진은 덮지 않는다 (D-36)', async () => {
    users.findAuthAccount.mockResolvedValue({ id: 7 });
    const existing = { id: 1, nickname: '내가바꾼닉', profileImageUrl: null, createdAt: new Date() };
    users.updateRawProfile.mockResolvedValue(existing);
    expect(await service.login('KAKAO', kakaoProfile)).toBe(existing);
    expect(users.findAuthAccount).toHaveBeenCalledWith('KAKAO', '123456789012');
    expect(users.updateRawProfile).toHaveBeenCalledWith(7, kakaoProfile.raw);
    expect(users.createWithAccountTx).not.toHaveBeenCalled();
    expect(avatars.importFromUrl).not.toHaveBeenCalled();
  });

  it('login: 신규면 User + AuthAccount + PERSONAL 팀 + 첫 색 멤버십을 한 트랜잭션으로', async () => {
    users.findAuthAccount.mockResolvedValue(null);
    users.createWithAccountTx.mockResolvedValue({ id: 2, nickname: '카카오닉', profileImageUrl: null, createdAt: new Date() });
    avatars.importFromUrl.mockResolvedValue('https://pub.example/avatars/2/a.webp');
    expect(await service.login('KAKAO', kakaoProfile)).toMatchObject({ id: 2, profileImageUrl: 'https://pub.example/avatars/2/a.webp' });
    expect(avatars.importFromUrl).toHaveBeenCalledWith(2, 'https://img');
    expect(users.updateRawProfile).not.toHaveBeenCalled();
    expect(users.createWithAccountTx).toHaveBeenCalledWith(
      {
        provider: 'KAKAO',
        providerUserId: '123456789012',
        email: null,
        rawProfile: kakaoProfile.raw,
        nickname: '카카오닉',
      },
      { name: PERSONAL_GROUP_NAME, color: '#F26D6D' },
    );
  });

  it('login: 제공자가 이메일을 주면 AuthAccount 에 같이 저장', async () => {
    users.findAuthAccount.mockResolvedValue(null);
    users.createWithAccountTx.mockResolvedValue({ id: 3, nickname: 'g', profileImageUrl: null, createdAt: new Date() });
    // 사진 복사가 실패(null) 하면 사진 없이 가입
    expect((await service.login('GOOGLE', { providerUserId: 'sub-1', nickname: 'g', profileImageUrl: null, email: 'g@example.com', raw: {} })).profileImageUrl).toBeNull();
    expect(users.createWithAccountTx.mock.calls[0][0]).toMatchObject({ provider: 'GOOGLE', email: 'g@example.com' });
  });

  it('signToken 은 숫자 ID 를 문자열 sub 로 서명', async () => {
    expect(await service.signToken(1)).toBe('jwt-for-1');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: '1' });
  });
});
