import { AdminAccess } from '../admin/admin-access.js';
import { AdminActionsRepository } from '../admin/admin-actions.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { type NoticeRow, NoticesRepository } from './notices.repository.js';
import { isUnread, NoticesService } from './notices.service.js';

function notice(id: number, overrides: Partial<NoticeRow> = {}): NoticeRow {
  const at = new Date('2026-11-20T00:00:00.000Z');
  return { id, title: `공지 ${id}`, body: '본문', kind: 'notice', pinned: false, publishedAt: at, createdAt: at, updatedAt: at, ...overrides };
}

describe('NoticesService (#515)', () => {
  let notices: RepositoryMock<NoticesRepository>;
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: NoticesService;
  const now = new Date('2026-11-25T00:00:00.000Z');
  const page = { limit: 20, cursor: null };

  beforeEach(() => {
    notices = mockRepository(NoticesRepository);
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new NoticesService(notices as never, users as never, new AdminAccess(users as never), actions as never);
  });

  it('isUnread: 본 적 없으면 새 공지, 본 시각보다 늦게 게시된 것만 새 공지 (같은 시각은 읽음)', () => {
    const seen = new Date('2026-11-20T00:00:00.000Z');
    expect(isUnread(new Date('2026-11-19T00:00:00.000Z'), null)).toBe(true);
    expect(isUnread(new Date('2026-11-21T00:00:00.000Z'), seen)).toBe(true);
    expect(isUnread(seen, seen)).toBe(false);
    expect(isUnread(new Date('2026-11-19T00:00:00.000Z'), seen)).toBe(false);
  });

  it('listPublished: 저장소 순서(고정 먼저, 게시 시각 내림차순)를 그대로, 본문은 빼고 익명은 unread false', async () => {
    notices.listPublished.mockResolvedValue({ items: [notice(3, { pinned: true }), notice(2)], nextCursor: 2 });
    const result = await service.listPublished(null, page);
    expect(notices.listPublished).toHaveBeenCalledWith(page);
    expect(users.findNoticesSeenAt).not.toHaveBeenCalled();
    expect(result.nextCursor).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual([3, 2]);
    expect(result.items[0]).toEqual({ id: 3, title: '공지 3', kind: 'notice', pinned: true, publishedAt: notice(3).publishedAt, unread: false });
  });

  it('listPublished: 로그인했으면 noticesSeenAt 보다 늦게 게시된 것만 unread', async () => {
    notices.listPublished.mockResolvedValue({
      items: [notice(5, { publishedAt: new Date('2026-11-24T00:00:00.000Z') }), notice(4, { publishedAt: new Date('2026-11-10T00:00:00.000Z') })],
      nextCursor: null,
    });
    users.findNoticesSeenAt.mockResolvedValue(new Date('2026-11-15T00:00:00.000Z'));
    const result = await service.listPublished(9, page);
    expect(users.findNoticesSeenAt).toHaveBeenCalledWith(9);
    expect(result.items.map((item) => item.unread)).toEqual([true, false]);
  });

  it('get: 게시된 공지는 누구나, 초안은 관리자만(아니면 404), 없으면 404', async () => {
    notices.findById.mockResolvedValueOnce(notice(1));
    expect((await service.get(null, 1)).id).toBe(1);

    notices.findById.mockResolvedValue(notice(2, { publishedAt: null }));
    await expect(service.get(null, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    users.findRole.mockResolvedValueOnce('user');
    await expect(service.get(5, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    users.findRole.mockResolvedValueOnce('admin');
    expect((await service.get(6, 2)).publishedAt).toBeNull();

    notices.findById.mockResolvedValue(null);
    await expect(service.get(6, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
    notices.create.mockImplementation(async (data) => notice(10, { ...data, publishedAt: data.publishedAt ?? null }));
    await service.create(1, { title: 't', body: 'b', kind: 'update', published: true }, now);
    expect(notices.create).toHaveBeenLastCalledWith({ title: 't', body: 'b', kind: 'update', pinned: false, publishedAt: now, createdById: 1 });
    await service.create(1, { title: 't', body: 'b', kind: 'notice', pinned: true }, now);
    expect(notices.create).toHaveBeenLastCalledWith({ title: 't', body: 'b', kind: 'notice', pinned: true, publishedAt: null, createdById: 1 });
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'notice_create', targetType: 'notice', targetId: 10 });
  });

  it('update: 초안 게시는 지금, 이미 게시면 처음 시각 유지, false 는 게시 취소. 생략은 그대로', async () => {
    const first = new Date('2026-11-01T00:00:00.000Z');
    notices.update.mockImplementation(async (id) => notice(id));
    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: null }));
    await service.update(1, 1, { published: true }, now);
    expect(notices.update).toHaveBeenLastCalledWith(1, { publishedAt: now });

    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: first }));
    await service.update(1, 1, { published: true, title: '새 제목' }, now);
    expect(notices.update).toHaveBeenLastCalledWith(1, { title: '새 제목', publishedAt: first });

    notices.findById.mockResolvedValueOnce(notice(1, { publishedAt: first }));
    await service.update(1, 1, { published: false, pinned: true }, now);
    expect(notices.update).toHaveBeenLastCalledWith(1, { pinned: true, publishedAt: null });
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'notice_update', targetType: 'notice', targetId: 1 });

    notices.findById.mockResolvedValueOnce(null);
    await expect(service.update(1, 2, { title: 'x' }, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remove: 지우고 기록, 없으면 404 (기록 없음)', async () => {
    notices.remove.mockResolvedValueOnce(true);
    expect(await service.remove(1, 4)).toEqual({ ok: true });
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'notice_delete', targetType: 'notice', targetId: 4 });
    actions.record.mockClear();
    notices.remove.mockResolvedValueOnce(false);
    await expect(service.remove(1, 5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(actions.record).not.toHaveBeenCalled();
  });
});
