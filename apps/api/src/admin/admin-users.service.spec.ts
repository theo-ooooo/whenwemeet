import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { AdminUsersService } from './admin-users.service.js';

describe('AdminUsersService (#515)', () => {
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: AdminUsersService;
  const row = { id: 8, nickname: '하늘', role: 'admin' as const, profileImageUrl: null, createdAt: new Date(0), providers: ['KAKAO' as const] };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new AdminUsersService(users as never, actions as never);
  });

  it('내 역할은 바꿀 수 없다 (403, 저장, 기록 없음)', async () => {
    await expect(service.changeRole(5, 5, 'user')).rejects.toMatchObject({ code: 'FORBIDDEN', message: '내 역할은 바꿀 수 없어요' });
    expect(users.updateRole).not.toHaveBeenCalled();
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('다른 사용자는 바꾸고 user_role 기록, 없으면 404', async () => {
    users.updateRole.mockResolvedValueOnce(row);
    expect(await service.changeRole(5, 8, 'admin')).toEqual(row);
    expect(users.updateRole).toHaveBeenCalledWith(8, 'admin');
    expect(actions.record).toHaveBeenCalledWith({ adminId: 5, action: 'user_role', targetType: 'user', targetId: 8, reason: 'admin' });
    users.updateRole.mockResolvedValueOnce(null);
    await expect(service.changeRole(5, 9, 'user')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('list 는 저장소에 그대로', async () => {
    users.listForAdmin.mockResolvedValue({ items: [row], nextCursor: null });
    expect(await service.list({ q: '하', limit: 20, cursor: null })).toEqual({ items: [row], nextCursor: null });
    expect(users.listForAdmin).toHaveBeenCalledWith({ q: '하', limit: 20, cursor: null });
  });
});
