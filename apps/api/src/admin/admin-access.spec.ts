import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { AdminAccess, AdminGuard } from './admin-access.js';

function contextOf(user: { id: number } | undefined) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never;
}

describe('AdminAccess, AdminGuard (#515)', () => {
  let users: RepositoryMock<UsersRepository>;
  let guard: AdminGuard;

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    guard = new AdminGuard(new AdminAccess(users as never));
  });

  it('DB 역할이 admin 이면 통과', async () => {
    users.findRole.mockResolvedValue('admin');
    expect(await guard.canActivate(contextOf({ id: 3 }))).toBe(true);
    expect(users.findRole).toHaveBeenCalledWith(3);
  });

  it('user 거나 사용자가 없으면 403 FORBIDDEN', async () => {
    users.findRole.mockResolvedValueOnce('user');
    await expect(guard.canActivate(contextOf({ id: 3 }))).rejects.toMatchObject(
      { code: 'FORBIDDEN', message: '관리자만 할 수 있어요' },
    );
    users.findRole.mockResolvedValueOnce(null);
    await expect(guard.canActivate(contextOf({ id: 4 }))).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
  });

  it('isAdmin: 익명(null)은 조회 없이 false', async () => {
    const access = new AdminAccess(users as never);
    expect(await access.isAdmin(null)).toBe(false);
    expect(users.findRole).not.toHaveBeenCalled();
  });
});
