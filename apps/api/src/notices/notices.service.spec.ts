import { AdminAccess } from '../admin/admin-access.js';
import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import {
  NoticeAlreadyPushedError,
  type NoticeRow,
  NoticesRepository,
} from './notices.repository.js';
import {
  isUnread,
  noticePreview,
  NoticesService,
  POPUP_PREVIEW_MAX,
} from './notices.service.js';

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

describe('NoticesService (#515)', () => {
  let notices: RepositoryMock<NoticesRepository>;
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: NoticesService;
  let scheduler: { kick: ReturnType<typeof vi.fn> };
  const now = new Date('2026-11-25T00:00:00.000Z');
  const page = { limit: 20, cursor: null };

  beforeEach(() => {
    notices = mockRepository(NoticesRepository);
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    scheduler = { kick: vi.fn() };
    service = new NoticesService(
      notices as never,
      users as never,
      new AdminAccess(users as never),
      actions as never,
      scheduler as never,
    );
  });

  it('isUnread: 본 적 없으면 새 공지, 본 시각보다 늦게 게시된 것만 새 공지 (같은 시각은 읽음)', () => {
    const seen = new Date('2026-11-20T00:00:00.000Z');
    expect(isUnread(new Date('2026-11-19T00:00:00.000Z'), null)).toBe(true);
    expect(isUnread(new Date('2026-11-21T00:00:00.000Z'), seen)).toBe(true);
    expect(isUnread(seen, seen)).toBe(false);
    expect(isUnread(new Date('2026-11-19T00:00:00.000Z'), seen)).toBe(false);
  });

  it('listPublished: 저장소 순서(고정 먼저, 게시 시각 내림차순)를 그대로, 본문은 빼고 익명은 unread false', async () => {
    notices.listPublished.mockResolvedValue({
      items: [notice(3, { pinned: true }), notice(2)],
      nextCursor: 2,
    });
    const result = await service.listPublished(null, page);
    expect(notices.listPublished).toHaveBeenCalledWith(page);
    expect(users.findNoticesSeenAt).not.toHaveBeenCalled();
    expect(result.nextCursor).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual([3, 2]);
    expect(result.items[0]).toEqual({
      id: 3,
      title: '공지 3',
      kind: 'notice',
      pinned: true,
      publishedAt: notice(3).publishedAt,
      unread: false,
    });
  });

  it('listPublished: 로그인했으면 noticesSeenAt 보다 늦게 게시된 것만 unread', async () => {
    notices.listPublished.mockResolvedValue({
      items: [
        notice(5, { publishedAt: new Date('2026-11-24T00:00:00.000Z') }),
        notice(4, { publishedAt: new Date('2026-11-10T00:00:00.000Z') }),
      ],
      nextCursor: null,
    });
    users.findNoticesSeenAt.mockResolvedValue(
      new Date('2026-11-15T00:00:00.000Z'),
    );
    const result = await service.listPublished(9, page);
    expect(users.findNoticesSeenAt).toHaveBeenCalledWith(9);
    expect(result.items.map((item) => item.unread)).toEqual([true, false]);
  });

  it('get: 게시된 공지는 누구나, 초안은 관리자만(아니면 404), 없으면 404', async () => {
    notices.findById.mockResolvedValueOnce(notice(1));
    expect((await service.get(null, 1)).id).toBe(1);

    notices.findById.mockResolvedValue(notice(2, { publishedAt: null }));
    await expect(service.get(null, 2)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    users.findRole.mockResolvedValueOnce('user');
    await expect(service.get(5, 2)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    users.findRole.mockResolvedValueOnce('admin');
    expect((await service.get(6, 2)).publishedAt).toBeNull();

    notices.findById.mockResolvedValue(null);
    await expect(service.get(6, 99)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('markSeen 은 지금 시각, hasUnread 는 본 시각 이후 게시가 있는지', async () => {
    users.markNoticesSeen.mockResolvedValue(now);
    expect(await service.markSeen(3, now)).toEqual({ noticesSeenAt: now });
    expect(users.markNoticesSeen).toHaveBeenCalledWith(3, now);

    const seen = new Date('2026-11-01T00:00:00.000Z');
    users.findNoticesSeenAt.mockResolvedValue(seen);
    notices.existsPublishedAfter.mockResolvedValue(true);
    expect(await service.hasUnread(3)).toBe(true);
    expect(notices.existsPublishedAfter).toHaveBeenCalledWith(seen);
  });

  it('create: published 면 지금 게시, 아니면 초안. pinned 기본 false. 조치 기록', async () => {
    notices.create.mockImplementation(async (data) =>
      notice(10, { ...data, publishedAt: data.publishedAt ?? null }),
    );
    await service.create(
      1,
      { title: 't', body: 'b', kind: 'update', published: true },
      now,
    );
    expect(notices.create).toHaveBeenLastCalledWith(
      {
        title: 't',
        body: 'b',
        kind: 'update',
        pinned: false,
        popup: false,
        publishedAt: now,
        createdById: 1,
      },
      null,
    );
    await service.create(
      1,
      { title: 't', body: 'b', kind: 'notice', pinned: true },
      now,
    );
    expect(notices.create).toHaveBeenLastCalledWith(
      {
        title: 't',
        body: 'b',
        kind: 'notice',
        pinned: true,
        popup: false,
        publishedAt: null,
        createdById: 1,
      },
      null,
    );
    expect(actions.record).toHaveBeenCalledWith({
      adminId: 1,
      action: 'notice_create',
      targetType: 'notice',
      targetId: 10,
    });
  });

  it('update: 초안 게시는 지금, 이미 게시면 처음 시각 유지, false 는 게시 취소. 생략은 그대로', async () => {
    const first = new Date('2026-11-01T00:00:00.000Z');
    notices.update.mockImplementation(async (id) => notice(id));
    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: null }));
    await service.update(1, 1, { published: true }, now);
    expect(notices.update).toHaveBeenLastCalledWith(
      1,
      { publishedAt: now },
      null,
    );

    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: first }));
    await service.update(1, 1, { published: true, title: '새 제목' }, now);
    expect(notices.update).toHaveBeenLastCalledWith(
      1,
      { title: '새 제목', publishedAt: first },
      null,
    );

    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: first }));
    await service.update(1, 1, { published: false, pinned: true }, now);
    expect(notices.update).toHaveBeenLastCalledWith(
      1,
      { pinned: true, publishedAt: null },
      null,
    );
    expect(actions.record).toHaveBeenCalledWith({
      adminId: 1,
      action: 'notice_update',
      targetType: 'notice',
      targetId: 1,
    });

    notices.findById.mockResolvedValueOnce(null);
    await expect(
      service.update(1, 2, { title: 'x' }, now),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remove: 지우고 기록, 없으면 404 (기록 없음)', async () => {
    notices.remove.mockResolvedValueOnce(true);
    expect(await service.remove(1, 4)).toEqual({ ok: true });
    expect(actions.record).toHaveBeenCalledWith({
      adminId: 1,
      action: 'notice_delete',
      targetType: 'notice',
      targetId: 4,
    });
    actions.record.mockClear();
    notices.remove.mockResolvedValueOnce(false);
    await expect(service.remove(1, 5)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(actions.record).not.toHaveBeenCalled();
  });

  describe('(#528) 푸시 (D-287)', () => {
    it('create: 게시와 push 면 같은 시각으로 예약하고 notice_create, notice_push 기록, 틱을 깨운다', async () => {
      notices.create.mockImplementation(async (data, pushAt) =>
        notice(11, {
          ...data,
          publishedAt: data.publishedAt ?? null,
          pushedAt: pushAt ?? null,
        }),
      );
      const row = await service.create(
        1,
        { title: 't', body: 'b', kind: 'notice', published: true, push: true },
        now,
      );
      expect(notices.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ publishedAt: now }),
        now,
      );
      expect(row.pushedAt).toEqual(now);
      expect(actions.record.mock.calls.map(([input]) => input.action)).toEqual([
        'notice_create',
        'notice_push',
      ]);
      expect(actions.record).toHaveBeenLastCalledWith({
        adminId: 1,
        action: 'notice_push',
        targetType: 'notice',
        targetId: 11,
      });
      expect(scheduler.kick).toHaveBeenCalledTimes(1);
    });

    it('create: 초안에 push 는 400 (field push), 저장도 기록도 없다. push false 는 보내지 않는다', async () => {
      await expect(
        service.create(
          1,
          { title: 't', body: 'b', kind: 'notice', push: true },
          now,
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'push', message: expect.any(String) }],
      });
      expect(notices.create).not.toHaveBeenCalled();
      expect(actions.record).not.toHaveBeenCalled();

      notices.create.mockImplementation(async (data) =>
        notice(12, { ...data, publishedAt: data.publishedAt ?? null }),
      );
      await service.create(
        1,
        { title: 't', body: 'b', kind: 'notice', published: true, push: false },
        now,
      );
      expect(notices.create).toHaveBeenLastCalledWith(expect.anything(), null);
      expect(scheduler.kick).not.toHaveBeenCalled();
    });

    it('update: 초안을 게시하면서 push, 이미 게시된 공지에 push 는 예약. 고친 결과가 초안이면 400', async () => {
      notices.update.mockImplementation(async (id) =>
        notice(id, { pushedAt: now }),
      );
      notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: null }));
      await service.update(1, 1, { published: true, push: true }, now);
      expect(notices.update).toHaveBeenLastCalledWith(
        1,
        { publishedAt: now },
        now,
      );

      notices.findById.mockResolvedValueOnce(notice(2));
      await service.update(1, 2, { title: '고침', push: true }, now);
      expect(notices.update).toHaveBeenLastCalledWith(
        2,
        { title: '고침' },
        now,
      );
      expect(scheduler.kick).toHaveBeenCalledTimes(2);

      notices.update.mockClear();
      notices.findById.mockResolvedValueOnce(notice(3, { publishedAt: null }));
      await expect(
        service.update(1, 3, { push: true }, now),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      notices.findById.mockResolvedValueOnce(notice(4));
      await expect(
        service.update(1, 4, { published: false, push: true }, now),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(notices.update).not.toHaveBeenCalled();
    });

    it('update: 이미 보낸 공지에 push 는 409 이고 아무것도 바꾸지 않는다. push 없이 고치기는 된다', async () => {
      notices.findById.mockResolvedValueOnce(notice(5, { pushedAt: now }));
      await expect(
        service.update(1, 5, { title: 'x', push: true }, now),
      ).rejects.toMatchObject({ code: 'NOTICE_ALREADY_PUSHED' });
      expect(notices.update).not.toHaveBeenCalled();
      expect(actions.record).not.toHaveBeenCalled();

      notices.update.mockImplementation(async (id) =>
        notice(id, { pushedAt: now }),
      );
      notices.findById.mockResolvedValueOnce(notice(5, { pushedAt: now }));
      await service.update(1, 5, { title: 'x' }, now);
      expect(notices.update).toHaveBeenLastCalledWith(5, { title: 'x' }, null);
      expect(scheduler.kick).not.toHaveBeenCalled();
    });

    it('update: 동시에 두 번 눌러 저장소가 NoticeAlreadyPushedError 를 던지면 409', async () => {
      notices.findById.mockResolvedValueOnce(notice(6));
      notices.update.mockRejectedValueOnce(new NoticeAlreadyPushedError());
      await expect(
        service.update(1, 6, { push: true }, now),
      ).rejects.toMatchObject({ code: 'NOTICE_ALREADY_PUSHED' });
      expect(actions.record).not.toHaveBeenCalled();
    });
  });

  describe('팝업과 새 공지 띠 (#538, D-291)', () => {
    const at = new Date('2026-11-24T00:00:00.000Z');
    const row = (id: number, body = '첫 문단') => ({
      id,
      title: `공지 ${id}`,
      body,
      kind: 'maintenance' as const,
      publishedAt: at,
    });

    it('noticePreview: 빈 줄로 나눈 첫 문단, 앞 빈 줄은 건너뛰고 문단 안 줄바꿈은 둔다', () => {
      expect(noticePreview('\n\n  \n첫 줄\n둘째 줄\n\n다음 문단')).toBe(
        '첫 줄\n둘째 줄',
      );
      expect(noticePreview('윈도 줄바꿈\r\n\r\n다음')).toBe('윈도 줄바꿈');
      expect(noticePreview('   ')).toBe('');
    });

    it('noticePreview: 상한을 넘으면 글자(이모지 포함) 단위로 자르고 … 를 붙인다', () => {
      const long = '가'.repeat(POPUP_PREVIEW_MAX + 5);
      expect(noticePreview(long)).toBe(`${'가'.repeat(POPUP_PREVIEW_MAX)}…`);
      expect(noticePreview('가'.repeat(POPUP_PREVIEW_MAX))).toBe(
        '가'.repeat(POPUP_PREVIEW_MAX),
      );
      expect(noticePreview('😀😀😀', 2)).toBe('😀😀…');
    });

    it('attention: 팝업은 닫지 않은 최근 팝업 공지 + 첫 문단, 띠는 본 시각 이후 가장 최근 공지', async () => {
      const seen = new Date('2026-11-20T00:00:00.000Z');
      notices.findPopupFor.mockResolvedValue(row(7, '점검해요\n\n자세한 내용'));
      users.findNoticesSeenAt.mockResolvedValue(seen);
      notices.findLatestPublishedAfter.mockResolvedValue(row(8));
      expect(await service.attention(3)).toEqual({
        popup: {
          id: 7,
          title: '공지 7',
          kind: 'maintenance',
          publishedAt: at,
          preview: '점검해요',
        },
        banner: {
          id: 8,
          title: '공지 8',
          kind: 'maintenance',
          publishedAt: at,
        },
      });
      expect(notices.findPopupFor).toHaveBeenCalledWith(3);
      expect(notices.findLatestPublishedAfter).toHaveBeenCalledWith(seen);
    });

    it('attention: 둘 다 없으면 null. 공지 목록을 본 적이 없으면 게시된 최근 공지를 띠로 찾는다', async () => {
      notices.findPopupFor.mockResolvedValue(null);
      users.findNoticesSeenAt.mockResolvedValue(null);
      notices.findLatestPublishedAfter.mockResolvedValue(null);
      expect(await service.attention(3)).toEqual({ popup: null, banner: null });
      expect(notices.findLatestPublishedAfter).toHaveBeenCalledWith(null);
    });

    it('dismiss: 게시된 공지면 ok, 없거나 초안이면 404', async () => {
      notices.dismiss.mockResolvedValueOnce(true);
      expect(await service.dismiss(3, 7)).toEqual({ ok: true });
      expect(notices.dismiss).toHaveBeenCalledWith(3, 7);
      notices.dismiss.mockResolvedValueOnce(false);
      await expect(service.dismiss(3, 99)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('create, update: popup 을 그대로 저장하고 생략하면 create 는 false, update 는 그대로', async () => {
      notices.create.mockImplementation(async (data) =>
        notice(13, { ...data, publishedAt: data.publishedAt ?? null }),
      );
      await service.create(
        1,
        { title: 't', body: 'b', kind: 'notice', published: true, popup: true },
        now,
      );
      expect(notices.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ popup: true }),
        null,
      );

      notices.findById.mockResolvedValue(notice(14));
      notices.update.mockResolvedValue(notice(14, { popup: true }));
      await service.update(1, 14, { popup: true }, now);
      expect(notices.update).toHaveBeenLastCalledWith(
        14,
        { popup: true },
        null,
      );
      await service.update(1, 14, { title: '제목' }, now);
      expect(notices.update).toHaveBeenLastCalledWith(
        14,
        { title: '제목' },
        null,
      );
    });
  });
});
