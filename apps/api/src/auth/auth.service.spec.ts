import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AuthService, PERSONAL_GROUP_NAME } from './auth.service.js';

describe('AuthService', () => {
  let users: RepositoryMock<UsersRepository>;
  let service: AuthService;
  const jwt = { signAsync: vi.fn(async (payload: { sub: string }) => `jwt-for-${payload.sub}`) };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    service = new AuthService(users as never, jwt as never);
  });

  it('sanitizeNext 는 / 로 시작하는 경로만 허용', () => {
    expect(service.sanitizeNext('/join/ABC123')).toBe('/join/ABC123');
    expect(service.sanitizeNext('/g/x_y-z/calendar')).toBe('/g/x_y-z/calendar');
    expect(service.sanitizeNext('//evil.example')).toBe('/');
    expect(service.sanitizeNext('https://evil.example')).toBe('/');
    expect(service.sanitizeNext('/a?b=c')).toBe('/');
    expect(service.sanitizeNext(undefined)).toBe('/');
  });

  it('createState / parseState 는 왕복하고, 깨진 값은 null', () => {
    const { nonce, state } = service.createState('/join/ABC');
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(service.parseState(state)).toEqual({ nonce, next: '/join/ABC' });
    expect(service.parseState('')).toBeNull();
    expect(service.parseState(undefined)).toBeNull();
    expect(service.parseState('@@@')).toBeNull();
    expect(service.parseState(Buffer.from('{"next":"/x"}').toString('base64url'))).toBeNull();
    // next 가 규칙 밖이면 / 로
    const bad = Buffer.from(JSON.stringify({ nonce: 'n', next: 'https://evil' })).toString('base64url');
    expect(service.parseState(bad)).toEqual({ nonce: 'n', next: '/' });
  });

  it('upsertKakaoUser: 기존 사용자는 프로필만 갱신', async () => {
    users.findByKakaoId.mockResolvedValue({ id: 'u1' });
    users.updateProfile.mockResolvedValue({ id: 'u1', nickname: '새닉', profileImageUrl: null, createdAt: new Date() });
    const user = await service.upsertKakaoUser({ kakaoId: 10n, nickname: '새닉', profileImageUrl: null });
    expect(user.id).toBe('u1');
    expect(users.findByKakaoId).toHaveBeenCalledWith(10n);
    expect(users.updateProfile).toHaveBeenCalledWith('u1', { nickname: '새닉', profileImageUrl: null });
    expect(users.createWithPersonalGroupTx).not.toHaveBeenCalled();
  });

  it('upsertKakaoUser: 신규면 사용자 + PERSONAL 팀 + 첫 색 멤버십을 한 트랜잭션으로', async () => {
    users.findByKakaoId.mockResolvedValue(null);
    users.createWithPersonalGroupTx.mockResolvedValue({ id: 'u2', nickname: '신규', profileImageUrl: 'img', createdAt: new Date() });
    const user = await service.upsertKakaoUser({ kakaoId: 11n, nickname: '신규', profileImageUrl: 'img' });
    expect(user.id).toBe('u2');
    expect(users.updateProfile).not.toHaveBeenCalled();
    expect(users.createWithPersonalGroupTx).toHaveBeenCalledWith(
      { kakaoId: 11n, nickname: '신규', profileImageUrl: 'img' },
      { name: PERSONAL_GROUP_NAME, color: '#F26D6D' },
    );
  });

  it('upsertDevUser: 같은 닉네임의 개발 사용자가 있으면 재사용, 없으면 음수 kakaoId 로 생성', async () => {
    users.findDevUserByNickname.mockResolvedValueOnce({ id: 'dev1', nickname: '개발', profileImageUrl: null, createdAt: new Date() });
    expect((await service.upsertDevUser('개발')).id).toBe('dev1');
    expect(users.findDevUserByNickname).toHaveBeenCalledWith('개발');
    expect(users.findByKakaoId).not.toHaveBeenCalled();

    users.findDevUserByNickname.mockResolvedValueOnce(null);
    users.findByKakaoId.mockResolvedValue(null);
    users.createWithPersonalGroupTx.mockResolvedValue({ id: 'dev2', nickname: '개발', profileImageUrl: null, createdAt: new Date() });
    expect((await service.upsertDevUser('개발')).id).toBe('dev2');
    const input = users.createWithPersonalGroupTx.mock.calls[0][0];
    expect(input.kakaoId < 0n).toBe(true);
    expect(input).toMatchObject({ nickname: '개발', profileImageUrl: null });
  });

  it('signToken 은 { sub } 로 서명', async () => {
    expect(await service.signToken('u1')).toBe('jwt-for-u1');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1' });
  });
});
