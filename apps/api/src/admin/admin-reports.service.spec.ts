import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { type AdminGroupDetail, AdminModerationRepository } from './admin-moderation.repository.js';
import { type AdminReportRow, AdminReportsRepository } from './admin-reports.repository.js';
import { AdminReportsService } from './admin-reports.service.js';

const at = new Date('2026-11-25T00:00:00.000Z');
const group: AdminGroupDetail = { id: 5, name: '팀', type: 'TEAM', owner: null, memberPreview: [], memberCount: 2, eventCount: 1, createdAt: at, hidden: null, members: [], recentEvents: [] };
const row = (over: Partial<AdminReportRow> = {}): AdminReportRow => ({
  id: 3,
  reason: 'spam',
  detail: null,
  status: 'open',
  createdAt: at,
  reporter: { id: 2, nickname: '밥' },
  resolvedBy: null,
  resolvedAt: null,
  resolution: null,
  ...over,
});

describe('AdminReportsService (#536, D-289)', () => {
  let repo: RepositoryMock<AdminReportsRepository>;
  let moderation: RepositoryMock<AdminModerationRepository>;
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: AdminReportsService;

  beforeEach(() => {
    repo = mockRepository(AdminReportsRepository);
    moderation = mockRepository(AdminModerationRepository);
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new AdminReportsService(repo as never, moderation as never, users as never, actions as never);
  });

  it('대상 상세: 팀 미리 보기와 접수 중 수. 신고가 없는 대상은 404', async () => {
    repo.listOfTarget.mockResolvedValueOnce([row(), row({ id: 2, status: 'dismissed' })]);
    moderation.findGroup.mockResolvedValueOnce(group);
    expect(await service.target('group', 5)).toEqual({ targetType: 'group', targetId: 5, target: { type: 'group', group }, openCount: 1, reports: [row(), row({ id: 2, status: 'dismissed' })] });
    repo.listOfTarget.mockResolvedValueOnce([]);
    moderation.findGroup.mockResolvedValueOnce(null);
    await expect(service.target('group', 6)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('지워진 대상은 target null, 사용자는 그 사람의 팀(개인 달력 제외)', async () => {
    repo.listOfTarget.mockResolvedValue([row()]);
    moderation.findEvent.mockResolvedValueOnce(null);
    expect((await service.target('event', 9)).target).toBeNull();
    const user = { id: 7, nickname: '하늘', role: 'user' as const, profileImageUrl: null, createdAt: at, providers: [], platforms: [], platformLastSeen: [], lastAppLoginAt: null };
    users.findForAdmin.mockResolvedValueOnce(user);
    moderation.listGroupsOfUser.mockResolvedValueOnce([group, { ...group, id: 1, type: 'PERSONAL' }]);
    expect((await service.target('user', 7)).target).toEqual({ type: 'user', user, teams: [group] });
  });

  it('처리 완료: 그 대상의 접수 중 신고를 모두 닫고 report_resolve 기록. 이미 다 닫혔으면 기록 없음', async () => {
    repo.findTargetOf.mockResolvedValue({ targetType: 'group', targetId: 5 });
    repo.listOfTarget.mockResolvedValue([row({ status: 'resolved' })]);
    moderation.findGroup.mockResolvedValue(group);
    repo.closeOpen.mockResolvedValueOnce(3);
    const out = await service.resolve(1, 3, '경고함', at);
    expect(repo.closeOpen).toHaveBeenCalledWith({ targetType: 'group', targetId: 5, status: 'resolved', adminId: 1, resolution: '경고함', at });
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'report_resolve', targetType: 'group', targetId: 5, reason: '경고함' });
    expect(out.openCount).toBe(0);
    actions.record.mockClear();
    repo.closeOpen.mockResolvedValueOnce(0);
    await service.resolve(1, 3, '경고함', at);
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('기각: 메모 없이도, 기록 report_dismiss. 없는 신고는 404', async () => {
    repo.findTargetOf.mockResolvedValueOnce({ targetType: 'event', targetId: 9 });
    repo.closeOpen.mockResolvedValueOnce(1);
    repo.listOfTarget.mockResolvedValue([row({ status: 'dismissed' })]);
    moderation.findEvent.mockResolvedValue(null);
    await service.dismiss(1, 3, null, at);
    expect(repo.closeOpen).toHaveBeenCalledWith(expect.objectContaining({ status: 'dismissed', resolution: null }));
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'report_dismiss', targetType: 'event', targetId: 9, reason: null });
    repo.findTargetOf.mockResolvedValueOnce(null);
    await expect(service.dismiss(1, 99, null, at)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('배지: 접수 중 대상 수', async () => {
    repo.countOpenTargets.mockResolvedValueOnce(4);
    expect(await service.openCount()).toEqual({ openTargets: 4 });
  });
});
