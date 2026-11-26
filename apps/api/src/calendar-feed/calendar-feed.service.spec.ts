import { AnniversariesRepository } from '../anniversaries/anniversaries.repository.js';
import { BirthdaysRepository } from '../anniversaries/birthdays.repository.js';
import { ApiException } from '../common/errors.js';
import { deriveKey } from '../email-login/email-crypto.js';
import {
  membershipRow,
  mockRepository,
  RepositoryMock,
} from '../testing/repository-mock.js';
import {
  bodyEtag,
  CalendarFeedService,
  etagMatches,
} from './calendar-feed.service.js';
import { CalendarFeedsRepository } from './calendar-feeds.repository.js';
import { FEED_TOKEN_KEY_INFO, feedToken, feedTokenHash } from './feed-token.js';

const SECRET = 'calendar-feed-spec-secret-0123456789abcdef';
const KEY = deriveKey(SECRET, FEED_TOKEN_KEY_INFO);
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = feedToken(KEY, 1, 10, SALT);
const NOW = new Date('2026-11-13T03:00:00Z');
const kst = (value: string) => new Date(`${value}+09:00`);

const ROW = {
  id: 5,
  userId: 1,
  groupId: 10,
  tokenSalt: SALT,
  tokenHash: feedTokenHash(TOKEN),
  includeMemo: false,
  includeAnniversaries: true,
  lastFetchedAt: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
};
const ROW_WITH_GROUP = {
  ...ROW,
  group: { name: '우리', publicCode: 'teamcode', type: 'TEAM' as const },
};

const VIEW = {
  id: 7,
  publicCode: 'evntcode',
  title: '저녁',
  startsAt: kst('2026-11-22T18:00:00'),
  endsAt: kst('2026-11-22T20:00:00'),
  allDay: false,
  memo: '비밀 메모',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  repeat: null,
  occurrence: null,
  participants: { all: false, members: [{ displayName: '민지' }] },
};

function configWith(env: Record<string, string | undefined>) {
  const values: Record<string, string | undefined> = {
    JWT_SECRET: SECRET,
    WEB_ORIGIN: 'https://whenwemeet.day',
    ...env,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(key);
      return value;
    },
  } as never;
}

describe('CalendarFeedService (#193)', () => {
  let feeds: RepositoryMock<CalendarFeedsRepository>;
  let anniversaries: RepositoryMock<AnniversariesRepository>;
  let birthdays: RepositoryMock<BirthdaysRepository>;
  let memberships: {
    assertMember: ReturnType<typeof vi.fn>;
    isMember: ReturnType<typeof vi.fn>;
  };
  let events: { listForFeed: ReturnType<typeof vi.fn> };
  let service: CalendarFeedService;

  function build(
    env: Record<string, string | undefined> = {
      API_PUBLIC_ORIGIN: 'https://api.whenwemeet.day/',
    },
  ) {
    service = new CalendarFeedService(
      feeds as never,
      memberships as never,
      events as never,
      anniversaries as never,
      birthdays as never,
      configWith(env),
      { resolveQuietly: async () => null } as never,
    );
  }

  beforeEach(() => {
    feeds = mockRepository(CalendarFeedsRepository);
    anniversaries = mockRepository(AnniversariesRepository);
    birthdays = mockRepository(BirthdaysRepository);
    birthdays.listForFeed.mockResolvedValue([
      {
        userId: 2,
        name: '민지',
        birthday: '12-24',
        birthdayCalendar: 'SOLAR',
        birthdayLeapMonth: false,
        updatedAt: new Date('2026-10-02T00:00:00Z'),
      },
    ]);
    memberships = {
      assertMember: vi.fn().mockResolvedValue(membershipRow()),
      isMember: vi.fn().mockResolvedValue(true),
    };
    events = { listForFeed: vi.fn().mockResolvedValue([VIEW]) };
    anniversaries.listForFeed.mockResolvedValue([
      {
        id: 3,
        name: '만난 날',
        date: '2026-09-20',
        kind: 'COUNT_UP',
        calendar: 'SOLAR',
        isLeapMonth: false,
        updatedAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
    feeds.touchFetched.mockResolvedValue(undefined);
    build();
  });

  describe('설정 API', () => {
    it('get: 멤버 확인 후 없으면 null', async () => {
      feeds.findMine.mockResolvedValue(null);
      await expect(service.get(1, 10)).resolves.toBeNull();
      expect(memberships.assertMember).toHaveBeenCalledWith(1, 10);
    });

    it('get: 주소는 저장하지 않고 소금으로 다시 만든다 (https, webcal, 구글 추가)', async () => {
      feeds.findMine.mockResolvedValue(ROW);
      const view = await service.get(1, 10);
      expect(view).toEqual({
        httpsUrl: `https://api.whenwemeet.day/v1/ics/${TOKEN}.ics`,
        webcalUrl: `webcal://api.whenwemeet.day/v1/ics/${TOKEN}.ics`,
        googleAddUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://api.whenwemeet.day/v1/ics/${TOKEN}.ics`)}`,
        includeMemo: false,
        includeAnniversaries: true,
        createdAt: ROW.createdAt,
        lastFetchedAt: null,
      });
      expect(feeds.replaceToken).not.toHaveBeenCalled();
    });

    it('get: 서버 비밀이 바뀌어 해시가 안 맞으면 지금 비밀의 해시로 맞춘다 (같은 소금)', async () => {
      feeds.findMine.mockResolvedValue({ ...ROW, tokenHash: 'f'.repeat(64) });
      await service.get(1, 10);
      expect(feeds.replaceToken).toHaveBeenCalledWith(1, 10, {
        tokenSalt: SALT,
        tokenHash: feedTokenHash(TOKEN),
      });
    });

    it('비멤버는 403 이 그대로 (저장소를 부르지 않는다)', async () => {
      memberships.assertMember.mockRejectedValue(new ApiException('FORBIDDEN'));
      await expect(service.upsert(1, 10, {})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(service.rotate(1, 10)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(service.remove(1, 10)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(feeds.upsert).not.toHaveBeenCalled();
      expect(feeds.replaceToken).not.toHaveBeenCalled();
      expect(feeds.remove).not.toHaveBeenCalled();
    });

    it('upsert: 새 소금과 그 토큰의 해시를 넘기고, 설정을 그대로 전달', async () => {
      feeds.upsert.mockImplementation(async (_u, _g, settings, token) => ({
        ...ROW,
        ...settings,
        ...token,
      }));
      const view = await service.upsert(1, 10, { includeMemo: true });
      const [, , settings, token] = feeds.upsert.mock.calls[0];
      expect(settings).toEqual({ includeMemo: true });
      expect(token.tokenSalt).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(token.tokenHash).toBe(
        feedTokenHash(feedToken(KEY, 1, 10, token.tokenSalt)),
      );
      expect(view.includeMemo).toBe(true);
      expect(view.httpsUrl).toContain(feedToken(KEY, 1, 10, token.tokenSalt));
    });

    it('rotate: 새 소금으로 교체, 주소가 없으면 404', async () => {
      feeds.replaceToken.mockImplementation(async (_u, _g, token) => ({
        ...ROW,
        ...token,
      }));
      const view = await service.rotate(1, 10);
      const [, , token] = feeds.replaceToken.mock.calls[0];
      expect(token.tokenSalt).not.toBe(SALT);
      expect(view.httpsUrl).not.toContain(TOKEN);
      feeds.replaceToken.mockResolvedValue(null);
      await expect(service.rotate(1, 10)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('remove: 행 삭제, ok', async () => {
      await expect(service.remove(1, 10)).resolves.toEqual({ ok: true });
      expect(feeds.remove).toHaveBeenCalledWith(1, 10);
    });

    it('API 공개 주소: 설정값, 운영 기본값, 개발 localhost:PORT', async () => {
      feeds.findMine.mockResolvedValue(ROW);
      build({ NODE_ENV: 'production' });
      expect((await service.get(1, 10))?.httpsUrl).toBe(
        `https://api.whenwemeet.day/v1/ics/${TOKEN}.ics`,
      );
      build({ PORT: '4100' });
      const view = await service.get(1, 10);
      expect(view?.httpsUrl).toBe(`http://localhost:4100/v1/ics/${TOKEN}.ics`);
      expect(view?.webcalUrl).toBe(
        `webcal://localhost:4100/v1/ics/${TOKEN}.ics`,
      );
    });
  });

  describe('공개 피드', () => {
    it('형식이 틀린 토큰은 DB 를 부르지 않고 404', async () => {
      await expect(service.feed('nope', undefined, NOW)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(feeds.findByHash).not.toHaveBeenCalled();
    });

    it('없는 토큰, 다시 만든 토큰과 다름, 멤버 아님은 모두 같은 404', async () => {
      feeds.findByHash.mockResolvedValue(null);
      await expect(service.feed(TOKEN, undefined, NOW)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      feeds.findByHash.mockResolvedValue({
        ...ROW_WITH_GROUP,
        tokenSalt: 'BBBBBBBBBBBBBBBBBBBBBB',
      });
      await expect(service.feed(TOKEN, undefined, NOW)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      feeds.findByHash.mockResolvedValue(ROW_WITH_GROUP);
      memberships.isMember.mockResolvedValue(false);
      await expect(service.feed(TOKEN, undefined, NOW)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(memberships.isMember).toHaveBeenCalledWith(1, 10);
      expect(events.listForFeed).not.toHaveBeenCalled();
      expect(feeds.touchFetched).not.toHaveBeenCalled();
    });

    it('본문: 피드 창으로 일정을 읽고, 메모는 끔이면 빼고, 기념일을 넣고, 가져간 시각을 남긴다', async () => {
      feeds.findByHash.mockResolvedValue(ROW_WITH_GROUP);
      const result = await service.feed(TOKEN, undefined, NOW);
      expect(feeds.findByHash).toHaveBeenCalledWith(feedTokenHash(TOKEN));
      expect(events.listForFeed).toHaveBeenCalledWith(
        10,
        kst('2026-09-14T00:00:00'),
        kst('2027-12-19T00:00:00'),
      );
      if (result.notModified) throw new Error('200 이어야 한다');
      expect(result.body).toContain('X-WR-CALNAME:언제볼까 - 우리');
      expect(result.body).toContain('DESCRIPTION:참여: 민지');
      expect(result.body).not.toContain('비밀 메모');
      expect(result.body).toContain('SUMMARY:만난 날 100일');
      // (#305) 멤버 생일도 "기념일 포함" 을 따라 싣는다
      expect(birthdays.listForFeed).toHaveBeenCalledWith(10);
      expect(result.body).toContain('SUMMARY:민지 생일');
      expect(result.body).toContain('UID:b2-20261224@whenwemeet.day');
      expect(result.etag).toBe(bodyEtag(result.body));
      expect(feeds.touchFetched).toHaveBeenCalledWith(5, NOW);
    });

    it('메모 켬이면 설명에 메모, 기념일 끔이면 기념일을 읽지 않는다', async () => {
      feeds.findByHash.mockResolvedValue({
        ...ROW_WITH_GROUP,
        includeMemo: true,
        includeAnniversaries: false,
      });
      const result = await service.feed(TOKEN, undefined, NOW);
      if (result.notModified) throw new Error('200 이어야 한다');
      expect(result.body).toContain('비밀 메모');
      expect(result.body).not.toContain('만난 날');
      expect(anniversaries.listForFeed).not.toHaveBeenCalled();
      expect(result.body).not.toContain('생일');
      expect(birthdays.listForFeed).not.toHaveBeenCalled();
    });

    it('If-None-Match 가 같으면 304 (본문 없음), 가져간 시각은 남긴다', async () => {
      feeds.findByHash.mockResolvedValue(ROW_WITH_GROUP);
      const first = await service.feed(TOKEN, undefined, NOW);
      const second = await service.feed(TOKEN, `W/${first.etag}`, NOW);
      expect(second).toEqual({ notModified: true, etag: first.etag });
      expect(feeds.touchFetched).toHaveBeenCalledTimes(2);
    });
  });

  it('etagMatches: 목록, 약한 비교, *', () => {
    expect(etagMatches(undefined, '"a"')).toBe(false);
    expect(etagMatches('"b", "a"', '"a"')).toBe(true);
    expect(etagMatches('W/"a"', '"a"')).toBe(true);
    expect(etagMatches('*', '"a"')).toBe(true);
    expect(etagMatches('"b"', '"a"')).toBe(false);
  });
});
