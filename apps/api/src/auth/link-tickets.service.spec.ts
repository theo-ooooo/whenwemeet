import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../common/errors.js';
import { verifySessionSub } from './jwt-auth.guard.js';
import {
  assertFreshSession,
  LINK_TICKET_TTL_SECONDS,
  LinkTicketsService,
} from './link-tickets.service.js';
import { sha256hex } from './pkce.js';

const jwt = new JwtService({
  secret: 'unit-secret-0123456789abcdef0123456789',
  signOptions: { algorithm: 'HS256', expiresIn: '30d' },
  verifyOptions: { algorithms: ['HS256'] },
});

describe('assertFreshSession (#198, 10분)', () => {
  const now = 1_800_000_000_000;
  const sec = now / 1000;
  it('10분 안이면 통과, 지났거나 없거나 1분 넘게 미래면 409 REAUTH_REQUIRED', () => {
    expect(() => assertFreshSession(sec - 600, now)).not.toThrow();
    expect(() => assertFreshSession(sec + 60, now)).not.toThrow();
    for (const iat of [sec - 601, null, sec + 61]) {
      expect(() => assertFreshSession(iat, now)).toThrow(
        expect.objectContaining({ code: 'REAUTH_REQUIRED' }),
      );
    }
  });
});

describe('LinkTicketsService (#198)', () => {
  const repo = {
    create: vi.fn(),
    deleteExpiredBefore: vi.fn(),
    consume: vi.fn(),
  };
  const service = new LinkTicketsService(jwt, repo as never);

  beforeEach(() => {
    repo.create.mockReset();
    repo.deleteExpiredBefore.mockReset();
    repo.consume.mockReset();
  });

  it('시작 표식은 같은 제공자로만 풀리고 세션으로 쓰이지 않는다(sub 없음). 세션 JWT 는 표식이 아니다', async () => {
    const intent = await service.createIntent(7, 'KAKAO');
    expect(await service.verifyIntent(intent, 'KAKAO')).toBe(7);
    expect(await service.verifyIntent(intent, 'APPLE')).toBeNull();
    expect(await verifySessionSub(jwt, intent)).toBeNull();
    const session = await jwt.signAsync({ sub: '7' });
    expect(await service.verifyIntent(session, 'KAKAO')).toBeNull();
    expect(await service.verifyIntent(`${intent}x`, 'KAKAO')).toBeNull();
    expect(await service.verifyIntent(undefined, 'KAKAO')).toBeNull();
    const other = new JwtService({
      secret: 'another-secret-0123456789abcdef012345',
    });
    expect(
      await service.verifyIntent(
        await other.signAsync({ typ: 'wwm-link-intent', uid: 7, prv: 'KAKAO' }),
        'KAKAO',
      ),
    ).toBeNull();
    const expired = await jwt.signAsync(
      { typ: 'wwm-link-intent', uid: 7, prv: 'KAKAO' },
      { expiresIn: -10 },
    );
    expect(await service.verifyIntent(expired, 'KAKAO')).toBeNull();
  });

  it('티켓 발급: 원문은 돌려주는 값에만, DB 에는 해시와 시작한 사용자, 5분. 청소를 겸한다', async () => {
    const now = new Date('2026-11-13T00:00:00Z');
    const ticket = await service.issue(
      7,
      'APPLE',
      {
        providerUserId: 'sub',
        nickname: 'x',
        profileImageUrl: null,
        email: null,
        raw: { sub: 'sub' },
        credentials: { providerClientId: 'svc', refreshToken: 'RT' },
      },
      now,
    );
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repo.deleteExpiredBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - 24 * 3600 * 1000),
    );
    expect(repo.create).toHaveBeenCalledWith({
      userId: 7,
      tokenHash: sha256hex(ticket),
      provider: 'APPLE',
      providerUserId: 'sub',
      email: null,
      rawProfile: { sub: 'sub' },
      credentials: { providerClientId: 'svc', refreshToken: 'RT' },
      expiresAt: new Date(now.getTime() + LINK_TICKET_TTL_SECONDS * 1000),
    });
  });

  it('소비는 해시와 세션 사용자로. 못 쓰면 400 LINK_TICKET_INVALID', async () => {
    repo.consume.mockResolvedValueOnce({
      provider: 'KAKAO',
      providerUserId: '1',
      email: null,
      rawProfile: null,
    });
    await expect(service.consume(7, 'abc')).resolves.toMatchObject({
      provider: 'KAKAO',
    });
    expect(repo.consume).toHaveBeenCalledWith(
      sha256hex('abc'),
      7,
      expect.any(Date),
    );
    repo.consume.mockResolvedValueOnce(null);
    await expect(service.consume(8, 'abc')).rejects.toBeInstanceOf(
      ApiException,
    );
  });
});
