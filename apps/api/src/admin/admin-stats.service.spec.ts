import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { AdminStatsRepository } from './admin-stats.repository.js';
import { AdminStatsClock, AdminStatsService, kstDayOf, statsWindow } from './admin-stats.service.js';

describe('AdminStatsService (#537, D-290)', () => {
  let repo: RepositoryMock<AdminStatsRepository>;
  let clock: AdminStatsClock;
  let service: AdminStatsService;
  /** 2026-11-25 08:30 KST = 11-24 23:30 UTC */
  let now = Date.parse('2026-11-24T23:30:00.000Z');

  beforeEach(() => {
    repo = mockRepository(AdminStatsRepository);
    repo.signupsByDay.mockResolvedValue([{ day: '2026-11-25', count: 2 }, { day: '2026-11-20', count: 1 }]);
    repo.activeByDay.mockResolvedValue([{ day: '2026-11-25', count: 5 }]);
    repo.assistantByDay.mockResolvedValue([{ day: '2026-11-24', messages: 12, users: 3 }]);
    repo.totals.mockResolvedValue({ users: 10, teams: 3, personalCalendars: 10, events: 40, notices: 1, openReports: 2, activeUsers: 6 });
    repo.platforms.mockResolvedValue({ ios: 4, android: 2, web: 5, unknown: 1 });
    clock = new AdminStatsClock();
    clock.now = () => now;
    service = new AdminStatsService(repo as never, clock);
  });

  it('KST 날짜 경계: 23:30 UTC 는 다음 날, 첫날 자정은 전날 15:00 UTC', () => {
    expect(kstDayOf(now)).toBe('2026-11-25');
    const w = statsWindow(7, now);
    expect(w.days).toEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
    expect(w.fromAt.toISOString()).toBe('2026-11-18T15:00:00.000Z');
    expect(statsWindow(30, now).days).toHaveLength(30);
  });

  it('날짜마다 한 줄(빈 날 0), 기간 합계, 저장소에 첫날 경계를 넘긴다', async () => {
    const s = await service.stats(7);
    expect(s).toMatchObject({ range: 7, from: '2026-11-19', to: '2026-11-25', platforms: { ios: 4, android: 2, web: 5, unknown: 1 } });
    expect(s.days).toHaveLength(7);
    expect(s.days.at(-1)).toEqual({ day: '2026-11-25', signups: 2, activeUsers: 5, assistantMessages: 0, assistantUsers: 0 });
    expect(s.days.at(-2)).toEqual({ day: '2026-11-24', signups: 0, activeUsers: 0, assistantMessages: 12, assistantUsers: 3 });
    expect(s.totals).toMatchObject({ users: 10, signupsInRange: 3, assistantMessagesInRange: 12, openReports: 2 });
    expect(repo.signupsByDay).toHaveBeenCalledWith(new Date('2026-11-18T15:00:00.000Z'));
    expect(repo.assistantByDay).toHaveBeenCalledWith('2026-11-19');
  });

  it('60초 캐시: 같은 기간은 다시 집계하지 않고, 기간이 다르거나 60초가 지나면 다시', async () => {
    await service.stats(7);
    await service.stats(7);
    expect(repo.totals).toHaveBeenCalledTimes(1);
    await service.stats(30);
    expect(repo.totals).toHaveBeenCalledTimes(2);
    now += 60_000;
    await service.stats(7);
    expect(repo.totals).toHaveBeenCalledTimes(3);
  });

  it('실패한 집계는 캐시하지 않는다', async () => {
    repo.platforms.mockRejectedValueOnce(new Error('db'));
    await expect(service.stats(7)).rejects.toThrow('db');
    await expect(service.stats(7)).resolves.toMatchObject({ range: 7 });
  });
});
