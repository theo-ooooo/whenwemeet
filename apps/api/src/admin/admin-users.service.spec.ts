import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import {
  adminPlatformSeenOf,
  adminPlatformsOf,
  UsersRepository,
} from '../users/users.repository.js';
import { AdminActionsRepository } from './admin-actions.repository.js';
import { AdminUsersService } from './admin-users.service.js';

describe('AdminUsersService (#515)', () => {
  let users: RepositoryMock<UsersRepository>;
  let actions: RepositoryMock<AdminActionsRepository>;
  let service: AdminUsersService;
  const row = {
    id: 8,
    nickname: '하늘',
    role: 'admin' as const,
    profileImageUrl: null,
    createdAt: new Date(0),
    providers: ['KAKAO' as const],
    platforms: ['ios' as const],
    platformLastSeen: [],
    lastAppLoginAt: null,
  };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    actions = mockRepository(AdminActionsRepository);
    actions.record.mockResolvedValue(undefined);
    service = new AdminUsersService(users as never, actions as never);
  });

  it('내 역할은 바꿀 수 없다 (403, 저장, 기록 없음)', async () => {
    await expect(service.changeRole(5, 5, 'user')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: '내 역할은 바꿀 수 없어요',
    });
    expect(users.updateRole).not.toHaveBeenCalled();
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('다른 사용자는 바꾸고 user_role 기록, 없으면 404', async () => {
    users.updateRole.mockResolvedValueOnce(row);
    expect(await service.changeRole(5, 8, 'admin')).toEqual(row);
    expect(users.updateRole).toHaveBeenCalledWith(8, 'admin');
    expect(actions.record).toHaveBeenCalledWith({
      adminId: 5,
      action: 'user_role',
      targetType: 'user',
      targetId: 8,
      reason: 'admin',
    });
    users.updateRole.mockResolvedValueOnce(null);
    await expect(service.changeRole(5, 9, 'user')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('list 는 저장소에 그대로', async () => {
    users.listForAdmin.mockResolvedValue({ items: [row], nextCursor: null });
    expect(
      await service.list({
        q: '하',
        platform: 'android',
        limit: 20,
        cursor: null,
      }),
    ).toEqual({ items: [row], nextCursor: null });
    expect(users.listForAdmin).toHaveBeenCalledWith({
      q: '하',
      platform: 'android',
      limit: 20,
      cursor: null,
    });
  });

  it('(#528, #532) adminPlatformsOf: 기록 있는 기종(ios, android, web 순), 아무 기록도 앱 로그인도 없으면 web, 앱 로그인만 있으면 모름([])', () => {
    const at = new Date('2026-11-20T00:00:00.000Z');
    expect(
      adminPlatformsOf(
        [{ platform: 'web' }, { platform: 'android' }, { platform: 'ios' }],
        null,
      ),
    ).toEqual(['ios', 'android', 'web']);
    expect(adminPlatformsOf([{ platform: 'android' }], at)).toEqual([
      'android',
    ]);
    expect(adminPlatformsOf([], null)).toEqual(['web']);
    expect(adminPlatformsOf([], at)).toEqual([]);
  });

  it('(#532) adminPlatformSeenOf: 접속 기록을 먼저, 없는 기종은 그 기종 푸시 기기 중 가장 늦은 것', () => {
    const t = (iso: string) => new Date(`2026-11-${iso}T00:00:00.000Z`);
    const clients = [
      { platform: 'web' as const, appVersion: null, lastSeenAt: t('24') },
      { platform: 'ios' as const, appVersion: '1.3.0', lastSeenAt: t('25') },
    ];
    const devices = [
      { platform: 'IOS' as const, appVersion: '1.2.0', lastSeenAt: t('26') },
      {
        platform: 'ANDROID' as const,
        appVersion: '1.1.0',
        lastSeenAt: t('20'),
      },
      {
        platform: 'ANDROID' as const,
        appVersion: '1.2.0',
        lastSeenAt: t('22'),
      },
    ];
    expect(adminPlatformSeenOf(clients, devices)).toEqual([
      { platform: 'ios', appVersion: '1.3.0', lastSeenAt: t('25') },
      { platform: 'android', appVersion: '1.2.0', lastSeenAt: t('22') },
      { platform: 'web', appVersion: null, lastSeenAt: t('24') },
    ]);
    expect(adminPlatformSeenOf([], [])).toEqual([]);
  });
});
