import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { readCookie } from './auth.controller.js';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY, JwtAuthGuard } from './jwt-auth.guard.js';

function contextOf(headers: Record<string, string | undefined>, isPublic = false, isOptional = false) {
  const request: { headers: Record<string, string | undefined>; user?: unknown } = { headers };
  return {
    request,
    context: {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => request }),
    } as never,
    reflector: {
      getAllAndOverride: vi.fn((key: string) => (key === IS_PUBLIC_KEY ? isPublic : key === IS_OPTIONAL_AUTH_KEY ? isOptional : undefined)),
    } as never,
  };
}

describe('JwtAuthGuard', () => {
  let users: RepositoryMock<UsersRepository>;
  const jwt = { verifyAsync: vi.fn() };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    jwt.verifyAsync.mockReset();
  });

  it('@Public 이면 토큰 없이 통과', async () => {
    const { context, reflector } = contextOf({}, true);
    const guard = new JwtAuthGuard(reflector, jwt as never, users as never);
    expect(await guard.canActivate(context)).toBe(true);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it.each([{}, { authorization: 'Basic abc' }, { authorization: 'Bearer' }])('헤더 %o → UNAUTHORIZED', async (headers) => {
    const { context, reflector } = contextOf(headers);
    const guard = new JwtAuthGuard(reflector, jwt as never, users as never);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('서명/만료 실패, sub 없음, sub 가 양의 정수 문자열이 아님, 사용자 없음(탈퇴) → UNAUTHORIZED', async () => {
    const { context, reflector } = contextOf({ authorization: 'Bearer t' });
    const guard = new JwtAuthGuard(reflector, jwt as never, users as never);

    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    jwt.verifyAsync.mockResolvedValueOnce({});
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    // 예전 cuid 토큰, 숫자 타입, 0, 앞자리 0
    for (const sub of ['ckabc123', 7, '0', '007']) {
      jwt.verifyAsync.mockResolvedValueOnce({ sub });
      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }
    expect(users.findById).not.toHaveBeenCalled();

    jwt.verifyAsync.mockResolvedValueOnce({ sub: '404' });
    users.findById.mockResolvedValueOnce(null);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(users.findById).toHaveBeenCalledWith(404);
  });

  it('(#196) @OptionalAuth: 토큰 없음, 틀림, 만료, 사용자 없음이면 익명 통과(user 없음), 유효하면 user', async () => {
    for (const headers of [{}, { authorization: 'Basic abc' }]) {
      const { context, reflector, request } = contextOf(headers, false, true);
      const guard = new JwtAuthGuard(reflector, jwt as never, users as never);
      expect(await guard.canActivate(context)).toBe(true);
      expect(request.user).toBeUndefined();
    }

    const { context, reflector, request } = contextOf({ authorization: 'Bearer t' }, false, true);
    const guard = new JwtAuthGuard(reflector, jwt as never, users as never);
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    expect(await guard.canActivate(context)).toBe(true);
    jwt.verifyAsync.mockResolvedValueOnce({ sub: '404' });
    users.findById.mockResolvedValueOnce(null);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toBeUndefined();

    const user = { id: 1, nickname: '닉', profileImageUrl: null, createdAt: new Date() };
    jwt.verifyAsync.mockResolvedValueOnce({ sub: '1' });
    users.findById.mockResolvedValueOnce(user);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(user);
  });

  it('유효하면 request.user 를 채운다 (대소문자 무관 bearer)', async () => {
    const { context, reflector, request } = contextOf({ authorization: 'bearer good' });
    const guard = new JwtAuthGuard(reflector, jwt as never, users as never);
    jwt.verifyAsync.mockResolvedValueOnce({ sub: '1' });
    const user = { id: 1, nickname: '닉', profileImageUrl: null, createdAt: new Date() };
    users.findById.mockResolvedValueOnce(user);
    expect(await guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual(user);
    expect(users.findById).toHaveBeenCalledWith(1);
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
