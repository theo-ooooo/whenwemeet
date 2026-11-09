import { asPrisma, createPrismaMock, PrismaMock } from '../testing/prisma-mock.js';
import { readCookie } from './auth.controller.js';
import { IS_PUBLIC_KEY, JwtAuthGuard } from './jwt-auth.guard.js';

function contextOf(headers: Record<string, string>, isPublic = false) {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  return {
    request,
    context: {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
    reflector: { getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined)) } as never,
  };
}

describe('JwtAuthGuard', () => {
  let prisma: PrismaMock;
  const jwt = { verifyAsync: vi.fn() };

  beforeEach(() => {
    prisma = createPrismaMock();
    jwt.verifyAsync.mockReset();
  });

  it('@Public 이면 토큰 없이 통과', async () => {
    const { context, reflector } = contextOf({}, true);
    const guard = new JwtAuthGuard(reflector, jwt as never, asPrisma(prisma));
    expect(await guard.canActivate(context)).toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it.each([{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }])('헤더 %o → UNAUTHORIZED', async (headers) => {
    const { context, reflector } = contextOf(headers);
    const guard = new JwtAuthGuard(reflector, jwt as never, asPrisma(prisma));
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('서명/만료 실패, sub 없음, 사용자 없음(탈퇴) → UNAUTHORIZED', async () => {
    const { context, reflector } = contextOf({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(reflector, jwt as never, asPrisma(prisma));

    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    jwt.verifyAsync.mockResolvedValueOnce({});
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'gone' });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('유효하면 request.user 를 채운다 (대소문자 무관 bearer)', async () => {
    const { context, reflector, request } = contextOf({ authorization: 'bearer good' });
    const guard = new JwtAuthGuard(reflector, jwt as never, asPrisma(prisma));
    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'u1' });
    const user = { id: 'u1', nickname: '닉', profileImageUrl: null, createdAt: new Date() };
    prisma.user.findUnique.mockResolvedValueOnce(user);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(user);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, nickname: true, profileImageUrl: true, createdAt: true },
    });
  });
});

describe('readCookie', () => {
  it('Cookie 헤더에서 이름 하나만', () => {
    expect(readCookie('a=1; wwm_oauth_state=abc%20d; b=2', 'wwm_oauth_state')).toBe('abc d');
    expect(readCookie('a=1', 'none')).toBeNull();
    expect(readCookie(undefined, 'a')).toBeNull();
    expect(readCookie('garbage; a=1', 'a')).toBe('1');
  });
});
