import { mockRepository, type RepositoryMock } from '../testing/repository-mock.js';
import { PollPlanner } from './poll-planner.js';
import { parsePollDedupeKey, pollDedupeKey, PushNotificationsRepository } from './push-notifications.repository.js';
import { type DuePollDeadline, PushPlanningRepository } from './push-planning.repository.js';

const NOW = new Date('2026-11-13T03:00:00.000Z');

const due = (id: number): DuePollDeadline => ({
  id,
  groupId: 10,
  groupName: '우리',
  groupCode: 'teamcode',
  pollCode: `poll000${id}`,
  title: '저녁 약속',
  deadline: new Date(NOW.getTime() - 60_000),
  creatorId: 1,
});

describe('(#189) PollPlanner', () => {
  let push: RepositoryMock<PushPlanningRepository> & RepositoryMock<PushNotificationsRepository>;
  let planner: PollPlanner;

  beforeEach(() => {
    push = { ...mockRepository(PushPlanningRepository), ...mockRepository(PushNotificationsRepository) };
    planner = new PollPlanner(push as never, push as never);
  });

  it('마감이 지난 투표마다 마감 문구로 한 번 예약하고 예약한 수를 센다 (이미 표시된 것은 저장소가 거른다)', async () => {
    push.listDuePollDeadlines.mockResolvedValue([due(1), due(2)]);
    push.schedulePollDeadline.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await planner.plan(NOW)).toBe(1);
    expect(push.listDuePollDeadlines).toHaveBeenCalledWith(NOW, 200);
    expect(push.schedulePollDeadline.mock.calls[0][1]).toMatchObject({ title: "'저녁 약속' 투표가 끝났어요", url: '/polls/poll0001?team=teamcode' });
  });

  it('dedupeKey 는 단계마다 하나', () => {
    expect(pollDedupeKey('OPEN', 5)).toBe('PO:5');
    expect(pollDedupeKey('CLOSED', 5)).toBe('PC:5');
    expect(pollDedupeKey('DEADLINE', 5)).toBe('PD:5');
    expect(parsePollDedupeKey('PD:12')).toEqual({ stage: 'DEADLINE', pollId: 12 });
    expect(parsePollDedupeKey('PO:0')).toBeNull();
    expect(parsePollDedupeKey('W:1:2026-11-16')).toBeNull();
  });
});
