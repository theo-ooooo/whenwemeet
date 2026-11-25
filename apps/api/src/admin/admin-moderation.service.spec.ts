import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { type AdminEventDetail, type AdminGroupDetail, AdminModerationRepository } from './admin-moderation.repository.js';
import { AdminModerationService } from './admin-moderation.service.js';

const at = new Date('2026-11-25T00:00:00.000Z');
const group: AdminGroupDetail = { id: 5, name: '팀', type: 'TEAM', memberCount: 2, eventCount: 1, createdAt: at, hidden: null, members: [], recentEvents: [] };
const event: AdminEventDetail = {
  id: 9,
  title: '광고',
  group: { id: 5, name: '팀', hidden: false },
  startsAt: at,
  endsAt: at,
  allDay: false,
  repeat: null,
  creator: null,
  createdAt: at,
  hidden: null,
  memo: null,
  place: null,
};

describe('AdminModerationService (#515, D-286)', () => {
  let repo: RepositoryMock<AdminModerationRepository>;
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: AdminModerationService;

  beforeEach(() => {
    repo = mockRepository(AdminModerationRepository);
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new AdminModerationService(repo as never, users as never, actions as never);
  });

  it('팀 숨기기: 사유와 관리자, 시각을 저장하고 group_hide 기록. 없는 팀은 404 (기록 없음)', async () => {
    repo.setGroupHidden.mockResolvedValueOnce(true);
    repo.findGroup.mockResolvedValue(group);
    await service.hideGroup(1, 5, '광고', at);
    expect(repo.setGroupHidden).toHaveBeenCalledWith(5, { reason: '광고', hiddenAt: at, hiddenById: 1 });
    expect(actions.record).toHaveBeenCalledWith({ adminId: 1, action: 'group_hide', targetType: 'group', targetId: 5, reason: '광고' });
    actions.record.mockClear();
    repo.setGroupHidden.mockResolvedValueOnce(false);
    await expect(service.hideGroup(1, 6, '광고', at)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('해제는 null 로, 기록 group_unhide / event_unhide', async () => {
    repo.setGroupHidden.mockResolvedValue(true);
    repo.findGroup.mockResolvedValue(group);
    await service.unhideGroup(1, 5);
    expect(repo.setGroupHidden).toHaveBeenCalledWith(5, null);
    repo.setEventHidden.mockResolvedValue(true);
    repo.findEvent.mockResolvedValue(event);
    await service.unhideEvent(1, 9);
    expect(repo.setEventHidden).toHaveBeenCalledWith(9, null);
    expect(actions.record.mock.calls.map(([input]) => input.action)).toEqual(['group_unhide', 'event_unhide']);
  });

  it('삭제: 이름(제목)을 reason 에 남기고, 없으면 404', async () => {
    repo.findGroup.mockResolvedValueOnce(group);
    repo.deleteGroupTx.mockResolvedValueOnce(true);
    expect(await service.deleteGroup(1, 5)).toEqual({ ok: true });
    expect(actions.record).toHaveBeenLastCalledWith({ adminId: 1, action: 'group_delete', targetType: 'group', targetId: 5, reason: '팀' });
    repo.findEvent.mockResolvedValueOnce(event);
    repo.deleteEvent.mockResolvedValueOnce(true);
    await service.deleteEvent(1, 9);
    expect(actions.record).toHaveBeenLastCalledWith({ adminId: 1, action: 'event_delete', targetType: 'event', targetId: 9, reason: '광고' });
    repo.findGroup.mockResolvedValueOnce(null);
    await expect(service.deleteGroup(1, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.deleteGroupTx).toHaveBeenCalledTimes(1);
  });

  it('일정 숨기기와 사용자 상세', async () => {
    repo.setEventHidden.mockResolvedValueOnce(true);
    repo.findEvent.mockResolvedValue(event);
    await service.hideEvent(2, 9, '스팸', at);
    expect(repo.setEventHidden).toHaveBeenCalledWith(9, { reason: '스팸', hiddenAt: at, hiddenById: 2 });
    users.findForAdmin.mockResolvedValueOnce(null);
    await expect(service.user(3)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    users.findForAdmin.mockResolvedValueOnce({ id: 3, nickname: 'a', role: 'user', profileImageUrl: null, createdAt: at, providers: [] });
    repo.listGroupsOfUser.mockResolvedValueOnce([group]);
    expect((await service.user(3)).teams).toEqual([group]);
  });
});
