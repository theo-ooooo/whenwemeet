import { ApiException } from '../common/errors.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { NoticeReadsRepository } from './notice-reads.repository.js';
import {
  fillByVia,
  NoticeReadsService,
  parseReadVia,
  parseUnreadFlag,
  readRateOf,
} from './notice-reads.service.js';
import { type NoticeRow, NoticesRepository } from './notices.repository.js';

function notice(id: number, overrides: Partial<NoticeRow> = {}): NoticeRow {
  const at = new Date('2026-11-20T00:00:00.000Z');
  return {
    id,
    title: `공지 ${id}`,
    body: '본문',
    kind: 'notice',
    pinned: false,
    publishedAt: at,
    pushedAt: null,
    popup: false,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const counts = {
  targetUsers: 4,
  devices: 5,
  sent: 4,
  delivered: 3,
  failed: 2,
  pending: 0,
};

describe('NoticeReadsService (#544, D-293)', () => {
  let reads: RepositoryMock<NoticeReadsRepository>;
  let notices: RepositoryMock<NoticesRepository>;
  let service: NoticeReadsService;
  const page = { q: null, via: null, limit: 20, cursor: null };

  beforeEach(() => {
    reads = mockRepository(NoticeReadsRepository);
    notices = mockRepository(NoticesRepository);
    service = new NoticeReadsService(reads as never, notices as never);
  });

  it('parseReadVia: 다섯 경로만, 빈 값은 null, 그 밖은 400 (field via)', () => {
    expect(parseReadVia(undefined)).toBeNull();
    expect(parseReadVia('')).toBeNull();
    for (const via of ['list', 'detail', 'push', 'popup', 'banner'])
      expect(parseReadVia(via)).toBe(via);
    expect(() => parseReadVia('email')).toThrow(ApiException);
    expect(() => parseReadVia(['push'])).toThrow(ApiException);
  });

  it('parseUnreadFlag: 1, true 만 안 읽은 사람, 없음, 0, false 는 읽은 사람, 그 밖은 400', () => {
    expect(parseUnreadFlag(undefined)).toBe(false);
    expect(parseUnreadFlag('0')).toBe(false);
    expect(parseUnreadFlag('false')).toBe(false);
    expect(parseUnreadFlag('1')).toBe(true);
    expect(parseUnreadFlag('true')).toBe(true);
    expect(() => parseUnreadFlag('yes')).toThrow(ApiException);
  });

  it('readRateOf: 기준이 0 이면 null, 1 을 넘지 않는다. fillByVia 는 빈 경로를 0 으로', () => {
    expect(readRateOf({ of: 'push', read: 0, total: 0 })).toBeNull();
    expect(readRateOf({ of: 'push', read: 1, total: 4 })).toBe(0.25);
    expect(readRateOf({ of: 'users', read: 5, total: 4 })).toBe(1);
    expect(fillByVia({ push: 2 })).toEqual({
      list: 0,
      detail: 0,
      push: 2,
      popup: 0,
      banner: 0,
    });
  });

  it('markRead: 저장소가 남긴(또는 이미 있던) 기록을 돌려주고, 없거나 초안이면 404', async () => {
    const at = new Date('2026-11-25T01:00:00.000Z');
    reads.recordFirstRead.mockResolvedValueOnce({
      firstReadAt: at,
      via: 'push',
      created: true,
    });
    await expect(service.markRead(7, 3, 'push')).resolves.toEqual({
      firstReadAt: at,
      via: 'push',
      first: true,
    });
    expect(reads.recordFirstRead).toHaveBeenCalledWith(7, 3, 'push');

    // 두 번째는 처음 경로 그대로, first false
    reads.recordFirstRead.mockResolvedValueOnce({
      firstReadAt: at,
      via: 'push',
      created: false,
    });
    await expect(service.markRead(7, 3, 'list')).resolves.toEqual({
      firstReadAt: at,
      via: 'push',
      first: false,
    });

    reads.recordFirstRead.mockResolvedValueOnce(null);
    await expect(service.markRead(7, 99, 'detail')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('stats: 푸시를 보낸 공지는 발송 집계와 푸시 대상 중 읽은 비율', async () => {
    const pushedAt = new Date('2026-11-24T00:00:00.000Z');
    notices.findById.mockResolvedValue(notice(3, { pushedAt }));
    reads.findPush.mockResolvedValue({
      id: 50,
      status: 'DISPATCHED',
      dispatchedAt: pushedAt,
    });
    reads.countByVia.mockResolvedValue({ push: 2, list: 1, popup: 1 });
    reads.deliveryCounts.mockResolvedValue(counts);
    reads.countReadAmongTargets.mockResolvedValue(3);

    const stats = await service.stats(3);
    expect(reads.deliveryCounts).toHaveBeenCalledWith(50);
    expect(reads.countReadAmongTargets).toHaveBeenCalledWith(3, 50);
    expect(reads.countUsers).not.toHaveBeenCalled();
    expect(stats).toEqual({
      noticeId: 3,
      publishedAt: notice(3).publishedAt,
      pushedAt,
      push: { ...counts, status: 'DISPATCHED', dispatchedAt: pushedAt },
      reads: {
        total: 4,
        byVia: { list: 1, detail: 0, push: 2, popup: 1, banner: 0 },
        pushOpened: 2,
      },
      readRate: 0.75,
      readRateBasis: { of: 'push', read: 3, total: 4 },
    });
  });

  it('stats: 푸시를 보내지 않은 공지는 push null, 전체 사용자 중 읽은 비율. 없는 공지는 404', async () => {
    notices.findById.mockResolvedValueOnce(notice(4));
    reads.findPush.mockResolvedValue(null);
    reads.countByVia.mockResolvedValue({ detail: 1 });
    reads.countUsers.mockResolvedValue(10);
    const stats = await service.stats(4);
    expect(stats).toMatchObject({
      push: null,
      reads: { total: 1, pushOpened: 0 },
      readRate: 0.1,
      readRateBasis: { of: 'users', read: 1, total: 10 },
    });
    expect(reads.deliveryCounts).not.toHaveBeenCalled();

    notices.findById.mockResolvedValueOnce(null);
    await expect(service.stats(5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('readers: 읽은 사람은 저장소 그대로, 안 읽은 사람은 푸시 대상에서. 푸시가 없으면 빈 목록, 없는 공지는 404', async () => {
    notices.findById.mockResolvedValue(notice(3));
    const row = {
      id: 7,
      nickname: '지우',
      profileImageUrl: null,
      firstReadAt: new Date(),
      via: 'push' as const,
    };
    reads.listReaders.mockResolvedValue({ items: [row], nextCursor: null });
    await expect(
      service.readers(3, { ...page, via: 'push', unread: false }),
    ).resolves.toEqual({ items: [row], nextCursor: null });
    expect(reads.listReaders).toHaveBeenCalledWith(3, {
      ...page,
      via: 'push',
      unread: false,
    });

    reads.findPush.mockResolvedValueOnce({
      id: 50,
      status: 'DISPATCHED',
      dispatchedAt: null,
    });
    reads.listUnreadTargets.mockResolvedValue({ items: [], nextCursor: null });
    await service.readers(3, { ...page, q: '지', unread: true });
    expect(reads.listUnreadTargets).toHaveBeenCalledWith(3, 50, {
      ...page,
      q: '지',
      unread: true,
    });

    reads.findPush.mockResolvedValueOnce(null);
    reads.listUnreadTargets.mockClear();
    await expect(
      service.readers(3, { ...page, unread: true }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    expect(reads.listUnreadTargets).not.toHaveBeenCalled();

    notices.findById.mockResolvedValueOnce(null);
    await expect(
      service.readers(9, { ...page, unread: false }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('withReadCounts: 줄마다 readCount, 기록이 없으면 0', async () => {
    reads.countByNotice.mockResolvedValue(new Map([[2, 5]]));
    const result = await service.withReadCounts({
      items: [{ id: 2 }, { id: 1 }],
      nextCursor: 1,
    });
    expect(reads.countByNotice).toHaveBeenCalledWith([2, 1]);
    expect(result).toEqual({
      items: [
        { id: 2, readCount: 5 },
        { id: 1, readCount: 0 },
      ],
      nextCursor: 1,
    });
  });
});
