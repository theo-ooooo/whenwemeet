import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { ReportsRepository } from './reports.repository.js';
import { ReportsService } from './reports.service.js';

const at = new Date('2026-11-25T00:00:00.000Z');
const receipt = (
  over: Partial<{
    id: number;
    targetType: 'group' | 'event' | 'user';
    targetId: number;
  }> = {},
) => ({
  id: 1,
  targetType: 'event' as const,
  targetId: 9,
  reason: 'spam' as const,
  status: 'open' as const,
  createdAt: at,
  ...over,
});

describe('ReportsService (#536, D-289)', () => {
  let repo: RepositoryMock<ReportsRepository>;
  let service: ReportsService;

  beforeEach(() => {
    repo = mockRepository(ReportsRepository);
    repo.createUnlessOpen.mockResolvedValue({
      report: receipt(),
      duplicate: false,
    });
    service = new ReportsService(repo as never);
  });

  it('일정: 내 팀의 보이는 일정만. 내가 만든 일정은 403, 볼 수 없으면 404 (만들지 않음)', async () => {
    repo.findVisibleEventCreator.mockResolvedValueOnce({ creatorId: 2 });
    expect(
      await service.create(1, {
        targetType: 'event',
        targetId: 9,
        reason: 'spam',
        detail: '  광고  ',
      }),
    ).toMatchObject({ id: 1, duplicate: false });
    expect(repo.createUnlessOpen).toHaveBeenCalledWith({
      reporterId: 1,
      targetType: 'event',
      targetId: 9,
      reason: 'spam',
      detail: '광고',
    });
    repo.findVisibleEventCreator.mockResolvedValueOnce({ creatorId: 1 });
    await expect(
      service.create(1, { targetType: 'event', targetId: 9, reason: 'spam' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    repo.findVisibleEventCreator.mockResolvedValueOnce(undefined);
    await expect(
      service.create(1, { targetType: 'event', targetId: 9, reason: 'spam' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.createUnlessOpen).toHaveBeenCalledTimes(1);
  });

  it('탈퇴한 사람이 만든 일정(creatorId null)은 신고할 수 있다', async () => {
    repo.findVisibleEventCreator.mockResolvedValueOnce({ creatorId: null });
    await service.create(1, {
      targetType: 'event',
      targetId: 9,
      reason: 'abuse',
    });
    expect(repo.createUnlessOpen).toHaveBeenCalledTimes(1);
  });

  it('팀: 멤버인 팀만, 개인 달력은 403, 멤버가 아니면 404', async () => {
    repo.findMemberGroupType.mockResolvedValueOnce('TEAM');
    await service.create(1, {
      targetType: 'group',
      targetId: 5,
      reason: 'illegal',
      detail: '   ',
    });
    expect(repo.createUnlessOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({
        targetType: 'group',
        targetId: 5,
        detail: null,
      }),
    );
    repo.findMemberGroupType.mockResolvedValueOnce('PERSONAL');
    await expect(
      service.create(1, { targetType: 'group', targetId: 5, reason: 'spam' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    repo.findMemberGroupType.mockResolvedValueOnce(null);
    await expect(
      service.create(1, { targetType: 'group', targetId: 6, reason: 'spam' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('사용자: 나 자신은 403 (조회 없이), 같은 팀이 아니면 404', async () => {
    await expect(
      service.create(1, { targetType: 'user', targetId: 1, reason: 'abuse' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: '나를 신고할 수는 없어요',
    });
    expect(repo.sharesGroup).not.toHaveBeenCalled();
    repo.sharesGroup.mockResolvedValueOnce(false);
    await expect(
      service.create(1, { targetType: 'user', targetId: 2, reason: 'abuse' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    repo.sharesGroup.mockResolvedValueOnce(true);
    repo.createUnlessOpen.mockResolvedValueOnce({
      report: receipt({ targetType: 'user', targetId: 2 }),
      duplicate: true,
    });
    expect(
      await service.create(1, {
        targetType: 'user',
        targetId: 2,
        reason: 'abuse',
      }),
    ).toMatchObject({ duplicate: true, targetType: 'user' });
  });
});
