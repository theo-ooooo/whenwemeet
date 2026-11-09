import { asPrisma, createPrismaMock, PrismaMock } from '../testing/prisma-mock.js';
import { AuthService, PERSONAL_GROUP_NAME } from './auth.service.js';

describe('AuthService', () => {
  let prisma: PrismaMock;
  let service: AuthService;
  const jwt = { signAsync: vi.fn(async (payload: { sub: string }) => `jwt-for-${payload.sub}`) };

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AuthService(asPrisma(prisma), jwt as never);
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
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    prisma.user.update.mockResolvedValue({ id: 'u1', nickname: '새닉', profileImageUrl: null, createdAt: new Date() });
    const user = await service.upsertKakaoUser({ kakaoId: 10n, nickname: '새닉', profileImageUrl: null });
    expect(user.id).toBe('u1');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: { nickname: '새닉', profileImageUrl: null } }));
    expect(prisma.group.create).not.toHaveBeenCalled();
  });

  it('upsertKakaoUser: 신규면 사용자 + PERSONAL 팀 + 첫 색 멤버십', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u2', nickname: '신규', profileImageUrl: 'img', createdAt: new Date() });
    const user = await service.upsertKakaoUser({ kakaoId: 11n, nickname: '신규', profileImageUrl: 'img' });
    expect(user.id).toBe('u2');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.group.create).toHaveBeenCalledWith({
      data: {
        type: 'PERSONAL',
        name: PERSONAL_GROUP_NAME,
        inviteCode: null,
        memberships: { create: { userId: 'u2', color: '#F26D6D' } },
      },
    });
  });

  it('upsertDevUser: 같은 닉네임의 개발 사용자가 있으면 재사용, 없으면 음수 kakaoId 로 생성', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dev1', nickname: '개발', profileImageUrl: null, createdAt: new Date() });
    expect((await service.upsertDevUser('개발')).id).toBe('dev1');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { nickname: '개발', kakaoId: { lt: 0n } } }));

    prisma.user.findFirst.mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'dev2', nickname: '개발', profileImageUrl: null, createdAt: new Date() });
    expect((await service.upsertDevUser('개발')).id).toBe('dev2');
    const kakaoId = prisma.user.create.mock.calls[0][0].data.kakaoId as bigint;
    expect(kakaoId < 0n).toBe(true);
  });

  it('signToken 은 { sub } 로 서명', async () => {
    expect(await service.signToken('u1')).toBe('jwt-for-u1');
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1' });
  });
});
