import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { EventRow, EventsRepository, SeriesRow } from '../events/events.repository.js';
import { EventSeriesService } from '../events/event-series.service.js';
import { EventsService } from '../events/events.service.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { emptyResponses } from '../testing/responses-mock.js';
import { EventResponsesRepository } from './event-responses.repository.js';
import { EventResponsesService } from './event-responses.service.js';

/** (#190) 참석 여부, 반응 서비스와 일정 응답의 집계. Repository 는 목 */

const kst = (value: string) => new Date(`${value}+09:00`);
const config = { getOrThrow: () => 'http://web' } as never;

const ONCE: EventRow = {
  id: 100,
  groupId: 10,
  publicCode: 'evntcode',
  title: '저녁 약속',
  startsAt: kst('2026-11-20T19:00:00'),
  endsAt: kst('2026-11-20T21:00:00'),
  allDay: false,
  memo: null,
  creatorId: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
  reminder: 'NONE',
  reminderSetAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: { nickname: '민지', profileImageUrl: null },
  allMembers: false,
  participantIds: [1, 2],
  color: null,
  place: null,
};
/** 매주 수요일 2026-11-11 시작 */
/** 반복 원본. listSeriesForRange 목에 exceptions 만 붙여 넣도록 repeat 을 null 아닌 타입으로 둔다 */
const SERIES: Omit<SeriesRow, 'exceptions'> = { ...ONCE, id: 200, publicCode: 'srescode', title: '주간 모임', repeat: 'WEEKLY', startsAt: kst('2026-11-11T19:00:00'), endsAt: kst('2026-11-11T21:00:00'), allMembers: true, participantIds: [] };

describe('EventResponsesService (#190)', () => {
  let events: RepositoryMock<EventsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let responses: RepositoryMock<EventResponsesRepository>;
  let eventsService: EventsService;
  let service: EventResponsesService;

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    responses = emptyResponses();
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    eventsService = new EventsService(events as never, memberships, responses as never, new EventSeriesService(events as never, memberships));
    service = new EventResponsesService(eventsService, responses as never);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([
      membershipRow(),
      membershipRow({ id: 1002, userId: 2, displayName: '지훈' }),
      membershipRow({ id: 1003, userId: 3, displayName: '서연' }),
    ]);
    events.findInGroup.mockResolvedValue(ONCE);
    events.listExceptions.mockResolvedValue([]);
    responses.saveReaction.mockResolvedValue('SAVED');
  });

  it('멤버가 아니면 FORBIDDEN, 저장하지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.setRsvp(9, 10, 100, undefined, 'GOING')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.setReaction(9, 10, 100, undefined, 'LIKE')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(responses.saveRsvp).not.toHaveBeenCalled();
  });

  it('한 번짜리: 회차 = 시작 KST 날짜, 본 시각과 새 소식 값을 넘기고 집계를 돌려준다', async () => {
    responses.listForOccurrence.mockResolvedValue({
      rsvps: [{ userId: 1, status: 'GOING', seenStartsAt: ONCE.startsAt, seenEndsAt: ONCE.endsAt, updatedAt: new Date() }],
      reactions: [],
    });
    const summary = await service.setRsvp(1, 10, 100, '2099-01-01', 'GOING');
    expect(responses.saveRsvp).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 10,
        eventId: 100,
        occurrence: '2026-11-20',
        userId: 1,
        status: 'GOING',
        startsAt: ONCE.startsAt,
        endsAt: ONCE.endsAt,
        news: expect.objectContaining({ eventId: 100, eventCode: 'evntcode', occurrence: null, title: '저녁 약속', allDay: false }),
      }),
    );
    expect(summary).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 1, mine: 'GOING' });
  });

  it('반복: occurrence 가 없으면 400, 회차가 아니면 404, 맞으면 그 회차', async () => {
    events.findInGroup.mockResolvedValue(SERIES);
    await expect(service.setRsvp(1, 10, 200, undefined, 'GOING')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.setRsvp(1, 10, 200, '2026-11-12', 'GOING')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.setRsvp(1, 10, 200, '2026-11-1', 'GOING')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await service.setRsvp(1, 10, 200, '2026-11-25', 'MAYBE');
    expect(responses.saveRsvp).toHaveBeenCalledWith(expect.objectContaining({ occurrence: '2026-11-25', news: expect.objectContaining({ occurrence: '2026-11-25' }) }));
  });

  it('취소된 회차("이 일정만" 삭제)는 404', async () => {
    events.findInGroup.mockResolvedValue(SERIES);
    events.listExceptions.mockResolvedValue([
      { occurrence: '2026-11-18', cancelled: true, title: null, startsAt: null, endsAt: null, allDay: null, memo: null, reminder: null, reminderSetAt: null, place: null },
    ]);
    await expect(service.setRsvp(1, 10, 200, '2026-11-18', 'GOING')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('트랜잭션 안 확인에서 참여자가 아니면 403 NOT_PARTICIPANT, 그사이 나갔으면 FORBIDDEN', async () => {
    responses.saveRsvp.mockResolvedValueOnce('NOT_PARTICIPANT');
    await expect(service.setRsvp(3, 10, 100, undefined, 'GOING')).rejects.toMatchObject({ code: 'NOT_PARTICIPANT', message: '이 일정의 참여자만 응답할 수 있어요' });
    responses.saveRsvp.mockResolvedValueOnce('NOT_MEMBER');
    await expect(service.setRsvp(3, 10, 100, undefined, 'GOING')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('본문 형식 오류는 일정을 찾기 전에 400', async () => {
    await expect(service.setRsvp(1, 10, 100, undefined, 'YES')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.setReaction(1, 10, 100, undefined, 'LOVE')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(events.findInGroup).not.toHaveBeenCalled();
  });

  it('반응: 팀원 누구나, 집계는 지금 팀원 기준', async () => {
    responses.listForOccurrence.mockResolvedValue({
      rsvps: [],
      reactions: [
        { userId: 3, kind: 'ACK', createdAt: new Date() },
        { userId: 2, kind: 'ACK', createdAt: new Date() },
      ],
    });
    const summary = await service.setReaction(3, 10, 100, undefined, 'ACK');
    expect(responses.saveReaction).toHaveBeenCalledWith({ groupId: 10, eventId: 100, occurrence: '2026-11-20', userId: 3, reaction: 'ACK' });
    expect(summary).toEqual({ LIKE: 0, EXCITED: 0, ACK: 2, mine: 'ACK' });
  });

  it('null 은 취소로 그대로 넘긴다', async () => {
    await service.setRsvp(1, 10, 100, undefined, null);
    expect(responses.saveRsvp).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
    await service.setReaction(1, 10, 100, undefined, null);
    expect(responses.saveReaction).toHaveBeenCalledWith(expect.objectContaining({ reaction: null }));
  });

  describe('일정 응답의 집계', () => {
    it('목록: 회차별 집계와 내 응답을 붙인다. 반복 회차는 회차마다 따로', async () => {
      events.listInRange.mockResolvedValue([ONCE]);
      events.listSeriesForRange.mockResolvedValue([{ ...SERIES, exceptions: [] }]);
      responses.listForEvents.mockResolvedValue({
        rsvps: [
          { eventId: 100, occurrence: '2026-11-20', userId: 2, status: 'NOT_GOING' },
          { eventId: 200, occurrence: '2026-11-18', userId: 1, status: 'GOING' },
          { eventId: 200, occurrence: '2026-11-25', userId: 1, status: 'MAYBE' },
        ],
        reactions: [{ eventId: 200, occurrence: '2026-11-25', userId: 3, kind: 'EXCITED' }],
      });
      const list = await eventsService.list(1, 10, kst('2026-11-16T00:00:00').toISOString(), kst('2026-11-30T00:00:00').toISOString());
      // 창에 있는 회차 날짜 범위로 한 번에 읽는다
      expect(responses.listForEvents).toHaveBeenCalledWith([200, 100], '2026-11-18', '2026-11-25');
      const by = (id: number, occurrence: string | null) => list.find((ev) => ev.id === id && (ev.occurrence ?? null) === occurrence);
      expect(by(100, null)?.rsvp).toEqual({ going: 0, notGoing: 1, maybe: 0, pending: 1, mine: null });
      expect(by(200, '2026-11-18')?.rsvp).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 2, mine: 'GOING' });
      expect(by(200, '2026-11-25')?.rsvp).toEqual({ going: 0, notGoing: 0, maybe: 1, pending: 2, mine: 'MAYBE' });
      expect(by(200, '2026-11-25')?.reactions).toEqual({ LIKE: 0, EXCITED: 1, ACK: 0, mine: null });
      expect(by(200, '2026-11-18')).not.toHaveProperty('rsvpMembers');
    });

    it('단건: 집계 + 참여자별 응답(가입순, 시각이 바뀌면 stale) + 반응한 사람', async () => {
      const updatedAt = new Date('2026-11-15T00:00:00.000Z');
      responses.listForOccurrence.mockResolvedValue({
        rsvps: [{ userId: 2, status: 'GOING', seenStartsAt: kst('2026-11-20T18:00:00'), seenEndsAt: ONCE.endsAt, updatedAt }],
        reactions: [{ userId: 3, kind: 'LIKE', createdAt: updatedAt }],
      });
      const detail = await eventsService.get(1, 10, 100);
      expect(responses.listForOccurrence).toHaveBeenCalledWith(100, '2026-11-20');
      expect(detail.rsvp).toEqual({ going: 1, notGoing: 0, maybe: 0, pending: 1, mine: null });
      expect(detail.rsvpMembers.map((row) => [row.member.userId, row.status, row.stale])).toEqual([
        [1, null, false],
        [2, 'GOING', true],
      ]);
      expect(detail.reactionMembers).toEqual([{ member: expect.objectContaining({ userId: 3 }), reaction: 'LIKE' }]);
      expect(detail.reactions).toEqual({ LIKE: 1, EXCITED: 0, ACK: 0, mine: null });
    });

    it('빈 목록은 응답을 읽지 않는다', async () => {
      events.listInRange.mockResolvedValue([]);
      events.listSeriesForRange.mockResolvedValue([]);
      expect(await eventsService.list(1, 10, '2026-11-16T00:00:00Z', '2026-11-30T00:00:00Z')).toEqual([]);
      expect(responses.listForEvents).not.toHaveBeenCalled();
    });
  });
});
