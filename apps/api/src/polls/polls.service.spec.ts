import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiException } from '../common/errors.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import {
  membershipRow,
  mockRepository,
  type RepositoryMock,
} from '../testing/repository-mock.js';
import { PollInputDto, PollVotesDto } from './dto/poll.dto.js';
import { OPEN_POLL_LIMIT, type PollRow } from './poll-rules.js';
import { PollsRepository } from './polls.repository.js';
import { PollsService } from './polls.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const NOW = new Date('2026-11-13T03:00:00.000Z');
const kst = (local: string) => new Date(`${local}+09:00`);

const row = (over: Partial<PollRow> = {}): PollRow => ({
  id: 5,
  groupId: 10,
  groupCode: 'team1234',
  publicCode: 'poll2345',
  title: '저녁 약속',
  status: 'OPEN',
  deadline: null,
  allMembers: true,
  creatorId: 1,
  creator: { nickname: '민지', profileImageUrl: null },
  eventId: null,
  eventCode: null,
  decidedOptionId: null,
  createdAt: new Date('2026-11-12T00:00:00.000Z'),
  closedAt: null,
  participantIds: [],
  options: [
    {
      id: 11,
      startsAt: kst('2026-11-14T19:00'),
      endsAt: kst('2026-11-14T21:00'),
      allDay: false,
      voterIds: [],
    },
    {
      id: 12,
      startsAt: kst('2026-11-15T12:00'),
      endsAt: kst('2026-11-15T14:00'),
      allDay: false,
      voterIds: [2],
    },
  ],
  ...over,
});

const input = (over: Record<string, unknown> = {}) =>
  ({
    title: '저녁 약속',
    options: [
      {
        startsAt: '2026-11-14T19:00:00+09:00',
        endsAt: '2026-11-14T21:00:00+09:00',
        allDay: false,
      },
      {
        startsAt: '2026-11-15T12:00:00+09:00',
        endsAt: '2026-11-15T14:00:00+09:00',
        allDay: false,
      },
    ],
    ...over,
  }) as never;

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as ApiException).code;
  }
  return 'OK';
};

describe('PollsService', () => {
  let polls: RepositoryMock<PollsRepository>;
  let groups: RepositoryMock<GroupsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let freeSlots: { anyBusy: ReturnType<typeof vi.fn> };
  let service: PollsService;

  beforeEach(() => {
    polls = mockRepository(PollsRepository);
    groups = mockRepository(GroupsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    freeSlots = { anyBusy: vi.fn().mockResolvedValue(false) };
    const memberships = new MembershipService(
      membershipsRepo as never,
      groups as never,
      config,
    );
    service = new PollsService(
      polls as never,
      memberships,
      groups as never,
      freeSlots as never,
    );
    membershipsRepo.findByUserAndGroup.mockImplementation(
      async (userId: number, groupId: number) =>
        userId <= 3
          ? membershipRow({
              userId,
              groupId,
              displayName: ['민지', '지훈', '서연'][userId - 1],
            })
          : null,
    );
    membershipsRepo.listByGroup.mockResolvedValue(
      [1, 2, 3].map((userId) =>
        membershipRow({
          userId,
          groupId: 10,
          joinedAt: new Date(userId * 1000),
        }),
      ),
    );
    groups.findById.mockResolvedValue({
      id: 10,
      type: 'TEAM',
      name: '우리',
      inviteCode: 'ABC123',
      publicCode: 'team1234',
      createdAt: NOW,
    });
  });

  describe('create', () => {
    it('후보를 검사해 저장하고 열림 알림 문구를 코드로 만든다. 참여자를 생략하면 지금 멤버 전원 id (#444, D-263)', async () => {
      polls.createWithinLimitTx.mockResolvedValue(row());
      await service.create(
        1,
        10,
        input({ deadline: '2026-11-14T12:00:00+09:00' }),
        NOW,
      );
      const [saved, limit, push] = polls.createWithinLimitTx.mock.calls[0];
      expect(limit).toBe(OPEN_POLL_LIMIT);
      expect(saved).toMatchObject({
        groupId: 10,
        title: '저녁 약속',
        participants: { allMembers: false, ids: [1, 2, 3] },
        actor: { id: 1, name: '민지' },
      });
      expect(saved.deadline).toEqual(kst('2026-11-14T12:00'));
      expect(push('abcd2345')).toMatchObject({
        title: "민지님이 '저녁 약속' 시간을 묻고 있어요",
        body: '후보 2개, 마감 11월 14일 (토) 오후 12:00',
        url: '/polls/abcd2345?team=team1234',
      });
    });

    it('골라 담은 대상은 그대로', async () => {
      polls.createWithinLimitTx.mockResolvedValue(row());
      await service.create(1, 10, input({ participants: [2, 1] }), NOW);
      expect(polls.createWithinLimitTx.mock.calls[0][0].participants).toEqual({
        allMembers: false,
        ids: [1, 2],
      });
    });

    it('개인 팀, 지난 마감, 상한 초과는 400, 비멤버는 403', async () => {
      groups.findById.mockResolvedValueOnce({
        id: 10,
        type: 'PERSONAL',
        name: '나',
        inviteCode: null,
        publicCode: 'mine1234',
        createdAt: NOW,
      });
      expect(await codeOf(service.create(1, 10, input(), NOW))).toBe(
        'VALIDATION_FAILED',
      );
      expect(
        await codeOf(
          service.create(
            1,
            10,
            input({ deadline: '2026-11-13T11:00:00+09:00' }),
            NOW,
          ),
        ),
      ).toBe('VALIDATION_FAILED');
      polls.createWithinLimitTx.mockResolvedValue(null);
      expect(await codeOf(service.create(1, 10, input(), NOW))).toBe(
        'VALIDATION_FAILED',
      );
      expect(await codeOf(service.create(9, 10, input(), NOW))).toBe(
        'FORBIDDEN',
      );
    });
  });

  describe('vote', () => {
    it('대상만, 닫힌 투표는 409, 마감 지나면 409 "투표가 끝났어요"', async () => {
      polls.findInGroup.mockResolvedValue(
        row({ allMembers: false, participantIds: [1, 2] }),
      );
      expect(
        await codeOf(service.vote(3, 10, 5, { optionIds: [11] }, NOW)),
      ).toBe('NOT_PARTICIPANT');
      polls.findInGroup.mockResolvedValue(row({ status: 'CLOSED' }));
      expect(
        await codeOf(service.vote(1, 10, 5, { optionIds: [11] }, NOW)),
      ).toBe('POLL_CLOSED');
      polls.findInGroup.mockResolvedValue(row({ deadline: NOW }));
      await expect(
        service.vote(1, 10, 5, { optionIds: [11] }, NOW),
      ).rejects.toMatchObject({
        code: 'POLL_CLOSED',
        message: '투표가 끝났어요',
      });
      polls.findInGroup.mockResolvedValue(null);
      expect(
        await codeOf(service.vote(1, 10, 5, { optionIds: [11] }, NOW)),
      ).toBe('NOT_FOUND');
    });

    it('내 표를 전체 교체한다', async () => {
      polls.findInGroup.mockResolvedValue(row());
      await service.vote(2, 10, 5, { optionIds: [11] }, NOW);
      expect(polls.replaceVotesTx).toHaveBeenCalledWith(2, [12], [11]);
    });
  });

  describe('confirm', () => {
    const event = {
      id: 40,
      groupId: 10,
      publicCode: 'evnt2345',
      title: '저녁 약속',
      startsAt: kst('2026-11-14T19:00'),
      endsAt: kst('2026-11-14T21:00'),
      allDay: false,
      memo: null,
      creatorId: 2,
      createdAt: NOW,
      updatedAt: NOW,
      repeat: null,
      repeatUntil: null,
      repeatAnchor: null,
      reminder: 'NONE',
      reminderSetAt: NOW,
      creator: { nickname: '지훈', profileImageUrl: null },
      allMembers: false,
      participantIds: [1, 2],
      color: null,
    } as const;

    it('일정 값(제목, 후보 시각, 대상, 알림 없음)과 정함 알림 문구, 바쁜 사람이 있으면 BUSY_NOW', async () => {
      polls.findInGroup.mockResolvedValue(
        row({ allMembers: false, participantIds: [1, 2] }),
      );
      polls.confirmTx.mockResolvedValue({
        ...event,
        participantIds: [1, 2],
      } as never);
      freeSlots.anyBusy.mockResolvedValue(true);
      const result = await service.confirm(2, 10, 5, { optionId: 11 }, NOW);
      expect(freeSlots.anyBusy).toHaveBeenCalledWith(
        [1, 2],
        kst('2026-11-14T19:00'),
        kst('2026-11-14T21:00'),
      );
      const arg = polls.confirmTx.mock.calls[0][0];
      expect(arg.event).toMatchObject({
        title: '저녁 약속',
        allDay: false,
        reminder: 'NONE',
        creatorId: 2,
        participants: { allMembers: false, ids: [1, 2] },
      });
      expect(arg.push('evnt2345')).toMatchObject({
        title: "지훈님이 '저녁 약속' 시간을 정했어요",
        body: '11월 14일 (토) 오후 7:00',
        url: '/events/evnt2345?team=team1234',
      });
      expect(result.warning).toBe('BUSY_NOW');
      expect(result.event.publicCode).toBe('evnt2345');
    });

    it('(#444) 대상이 "모두" 인 옛 투표를 정하면 일정 참여자는 지금 멤버 id 목록 (D-263)', async () => {
      polls.findInGroup.mockResolvedValue(
        row({ allMembers: true, participantIds: [] }),
      );
      polls.confirmTx.mockResolvedValue({
        ...event,
        participantIds: [1, 2, 3],
      } as never);
      await service.confirm(2, 10, 5, { optionId: 11 }, NOW);
      expect(polls.confirmTx.mock.calls[0][0].event.participants).toEqual({
        allMembers: false,
        ids: [1, 2, 3],
      });
    });

    it('종일 후보는 바쁨을 보지 않는다', async () => {
      polls.findInGroup.mockResolvedValue(
        row({
          options: [
            {
              id: 11,
              startsAt: kst('2026-11-20T00:00'),
              endsAt: kst('2026-11-21T00:00'),
              allDay: true,
              voterIds: [],
            },
          ],
        }),
      );
      polls.confirmTx.mockResolvedValue({ ...event, allDay: true } as never);
      expect(
        (await service.confirm(1, 10, 5, { optionId: 11 }, NOW)).warning,
      ).toBeNull();
      expect(freeSlots.anyBusy).not.toHaveBeenCalled();
    });

    it('닫힌 투표, 동시에 먼저 정해짐은 409. 지난 후보 400, 남의 후보 400', async () => {
      polls.findInGroup.mockResolvedValue(row({ status: 'CLOSED' }));
      expect(
        await codeOf(service.confirm(1, 10, 5, { optionId: 11 }, NOW)),
      ).toBe('POLL_CLOSED');
      polls.findInGroup.mockResolvedValue(row());
      polls.confirmTx.mockResolvedValue(null);
      expect(
        await codeOf(service.confirm(1, 10, 5, { optionId: 11 }, NOW)),
      ).toBe('POLL_CLOSED');
      expect(
        await codeOf(service.confirm(1, 10, 5, { optionId: 99 }, NOW)),
      ).toBe('VALIDATION_FAILED');
      expect(
        await codeOf(
          service.confirm(1, 10, 5, { optionId: 11 }, kst('2026-11-14T19:00')),
        ),
      ).toBe('POLL_OPTION_PAST');
    });

    it('마감이 지나도 정할 수 있다', async () => {
      polls.findInGroup.mockResolvedValue(
        row({ deadline: new Date(NOW.getTime() - 1000) }),
      );
      polls.confirmTx.mockResolvedValue(event as never);
      expect(
        await codeOf(service.confirm(1, 10, 5, { optionId: 11 }, NOW)),
      ).toBe('OK');
    });
  });

  it('remove: 진행 중만, 닫혔으면 409', async () => {
    polls.findInGroup.mockResolvedValue(row());
    polls.deleteOpenTx.mockResolvedValue(true);
    expect(await service.remove(3, 10, 5)).toEqual({ ok: true });
    polls.deleteOpenTx.mockResolvedValue(false);
    expect(await codeOf(service.remove(3, 10, 5))).toBe('POLL_CLOSED');
    polls.findInGroup.mockResolvedValue(row({ status: 'CLOSED' }));
    expect(await codeOf(service.remove(3, 10, 5))).toBe('POLL_CLOSED');
  });

  it('getByCode: 틀린 코드, 비멤버는 404', async () => {
    polls.findByCode.mockResolvedValue(row());
    expect((await service.getByCode(2, 'POLL2345', NOW)).myVotes).toEqual([12]);
    expect(await codeOf(service.getByCode(9, 'poll2345', NOW))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(service.getByCode(2, 'x', NOW))).toBe('NOT_FOUND');
  });

  it('list: 진행 중은 정렬, 닫힌 것은 최근 30일', async () => {
    polls.listOpen.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, deadline: kst('2026-11-13T20:00') }),
    ]);
    expect((await service.list(1, 10, 'open', NOW)).map((i) => i.id)).toEqual([
      2, 1,
    ]);
    polls.listClosedSince.mockResolvedValue([]);
    await service.list(1, 10, 'closed', NOW);
    expect(polls.listClosedSince).toHaveBeenCalledWith(
      10,
      new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000),
    );
  });
});

describe('Poll DTO', () => {
  const errorsOf = async (cls: new () => object, body: unknown) =>
    (
      await validate(plainToInstance(cls, body) as object, {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).map((e) => e.property);

  it('제목 1~50자, 후보 배열 5개까지, 시간대 필수, 표는 양의 정수 배열', async () => {
    expect(
      await errorsOf(PollInputDto, {
        title: '저녁',
        options: [
          {
            startsAt: '2026-11-14T19:00:00+09:00',
            endsAt: '2026-11-14T21:00:00+09:00',
            allDay: false,
          },
        ],
      }),
    ).toEqual([]);
    expect(await errorsOf(PollInputDto, { title: ' ', options: [] })).toEqual([
      'title',
    ]);
    expect(
      await errorsOf(PollInputDto, {
        title: '저녁',
        options: [
          {
            startsAt: '2026-11-14T19:00:00',
            endsAt: '2026-11-14T21:00:00+09:00',
            allDay: false,
          },
        ],
      }),
    ).toEqual(['options']);
    expect(
      await errorsOf(PollInputDto, {
        title: '저녁',
        options: [],
        participants: 'NONE',
      }),
    ).toEqual(['participants']);
    expect(await errorsOf(PollVotesDto, { optionIds: [1, 2] })).toEqual([]);
    expect(await errorsOf(PollVotesDto, { optionIds: [0] })).toEqual([
      'optionIds',
    ]);
    expect(await errorsOf(PollVotesDto, { optionIds: 'x' })).toEqual([
      'optionIds',
    ]);
  });
});
