import { ApiException } from '../common/errors.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { EventsRepository } from './events.repository.js';
import { assertEventRange, isUnchanged, parseRange } from './event-input.js';
import { EventSeriesService } from './event-series.service.js';
import { EventsService } from './events.service.js';
import { participantsFailed } from './participants.js';
import { emptyResponses } from '../testing/responses-mock.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 100,
  groupId: 10,
  publicCode: 'evntcode',
  title: '회의',
  startsAt: new Date('2026-12-01T10:00:00.000Z'),
  endsAt: new Date('2026-12-01T12:00:00.000Z'),
  allDay: false,
  memo: null,
  creatorId: 1,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  repeat: null,
  repeatUntil: null,
  repeatAnchor: null,
  reminder: 'NONE' as const,
  reminderSetAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: { nickname: '앨리스', profileImageUrl: null },
  allMembers: true,
  participantIds: [] as number[],
  color: null,
  place: null,
};

describe('assertEventRange / parseRange', () => {
  it('endsAt <= startsAt, 30일 초과 → EVENT_RANGE_INVALID', () => {
    expect(() => assertEventRange(new Date(10), new Date(10))).toThrow(ApiException);
    expect(() => assertEventRange(new Date(10), new Date(5))).toThrow(/뒤여야/);
    expect(() => assertEventRange(new Date(0), new Date(30 * 86_400_000 + 1))).toThrow(/30일/);
    expect(() => assertEventRange(new Date(0), new Date(30 * 86_400_000))).not.toThrow();
  });

  it('parseRange: 형식 오류는 VALIDATION_FAILED, 범위 오류는 EVENT_RANGE_INVALID', () => {
    expect(() => parseRange('x', '2026-01-02T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => parseRange('2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'EVENT_RANGE_INVALID' }));
    expect(() => parseRange('2026-01-01T00:00:00Z', '2026-03-05T00:00:00Z', 62)).toThrow(expect.objectContaining({ code: 'EVENT_RANGE_INVALID' }));
    const { from, to } = parseRange('2026-01-01T00:00:00Z', '2026-03-04T00:00:00Z', 62);
    expect(to.getTime() - from.getTime()).toBe(62 * 86_400_000);
  });
});

describe('EventsService', () => {
  let events: RepositoryMock<EventsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: EventsService;

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new EventsService(events as never, memberships, emptyResponses() as never, new EventSeriesService(events as never, memberships));
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    events.listSeriesForRange.mockResolvedValue([]);
    events.listExceptions.mockResolvedValue([]);
  });

  it('멤버가 아니면 모든 메서드가 FORBIDDEN', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    const input = { title: 't', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:00:00Z', allDay: false };
    await expect(service.list(9, 10, '2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get(9, 10, 100)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create(9, 10, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(9, 10, 100, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove(9, 10, 100)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.restore(9, 10, 5)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(events.restoreDeletionTx).not.toHaveBeenCalled();
    expect(events.listInRange).not.toHaveBeenCalled();
    expect(events.findInGroup).not.toHaveBeenCalled();
  });

  it('list: 구간을 Date 로 넘기고 creator 를 Member 로', async () => {
    events.listInRange.mockResolvedValue([ROW]);
    const list = await service.list(1, 10, '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z');
    expect(events.listInRange).toHaveBeenCalledWith(10, new Date('2026-12-01T00:00:00.000Z'), new Date('2026-12-02T00:00:00.000Z'));
    expect(list[0]).toMatchObject({ id: 100, creator: { userId: 1, displayName: '앨리스', color: '#F26D6D' } });
    expect(list[0]).not.toHaveProperty('creatorId');
  });

  it('get: 다른 팀 ID 는 NOT_FOUND', async () => {
    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.get(1, 10, 199)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.findInGroup).toHaveBeenCalledWith(10, 199);
    events.findInGroup.mockResolvedValueOnce(ROW);
    expect((await service.get(1, 10, 100)).id).toBe(100);
  });

  it('create: 범위 검증 후 일정 + CREATED 로그 트랜잭션', async () => {
    await expect(
      service.create(1, 10, { title: 't', startsAt: '2026-12-01T12:00:00Z', endsAt: '2026-12-01T10:00:00Z', allDay: false }),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.createWithLogTx).not.toHaveBeenCalled();

    events.createWithLogTx.mockResolvedValue(ROW);
    const created = await service.create(1, 10, { title: '회의', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false });
    expect(created.id).toBe(100);
    expect(events.createWithLogTx).toHaveBeenCalledWith(
      { groupId: 10, title: '회의', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, creatorId: 1, reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date), participants: { allMembers: false, ids: [1] }, color: null, place: null },
      1,
    );
  });

  it('update: 부분 변경은 현재 값과 합쳐 검증, UPDATED 로그 트랜잭션', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await expect(service.update(1, 10, 100, { endsAt: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();

    events.updateWithLogTx.mockResolvedValue({ ...ROW, title: '변경', memo: '메모' });
    const updated = await service.update(1, 10, 100, { title: '변경', memo: '메모' });
    expect(updated.title).toBe('변경');
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      { title: '변경', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: '메모', reminder: 'NONE', remindAt: null, place: null },
      1,
    );

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.update(1, 10, 999, {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update: (#343) 색만 바꾸면 updateColor 만 (로그 트랜잭션 없음), 소문자는 대문자로', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    events.updateColor.mockResolvedValue({ ...ROW, color: '#F279B5' });
    const updated = await service.update(1, 10, 100, { color: '#f279b5' });
    expect(updated.color).toBe('#F279B5');
    expect(events.updateColor).toHaveBeenCalledWith(100, '#F279B5');
    expect(events.updateWithLogTx).not.toHaveBeenCalled();

    // 같은 색이면 아무것도 저장하지 않는다
    events.updateColor.mockClear();
    events.findInGroup.mockResolvedValue({ ...ROW, color: '#F279B5' });
    await service.update(1, 10, 100, { color: '#F279B5' });
    expect(events.updateColor).not.toHaveBeenCalled();

    // 다른 값과 같이 바꾸면 보통 수정에 색을 싣는다
    events.updateWithLogTx.mockResolvedValue({ ...ROW, title: '변경', color: null });
    await service.update(1, 10, 100, { title: '변경', color: null });
    expect(events.updateWithLogTx).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }), expect.objectContaining({ title: '변경', color: null }), 1);
    expect(events.updateColor).not.toHaveBeenCalled();
  });

  it('update: 빈 메모(\'\')를 보내면 메모를 지운다 (null 로 저장)', async () => {
    events.findInGroup.mockResolvedValue({ ...ROW, memo: '원래 메모' });
    events.updateWithLogTx.mockResolvedValue({ ...ROW, memo: null });
    await service.update(1, 10, 100, { memo: '' });
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      { title: ROW.title, startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, reminder: 'NONE', remindAt: null, place: null },
      1,
    );
  });

  it('update: 메모가 이미 없을 때 빈 메모를 보내면 저장하지 않는다 (#62)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await service.update(1, 10, 100, { memo: '' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('update: 바뀐 필드가 없으면 저장도 UPDATED 로그도 없이 현재 값을 돌려준다 (#62)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    for (const dto of [{}, { title: '회의', allDay: false, memo: null }, { startsAt: '2026-12-01T19:00:00+09:00', endsAt: '2026-12-01T12:00:00.000Z' }]) {
      const result = await service.update(1, 10, 100, dto as never);
      expect(result.updatedAt).toEqual(ROW.updatedAt);
      expect(result.title).toBe('회의');
    }
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('isUnchanged: 필드 하나라도 다르면 false (알림 포함, #188)', () => {
    const base = { title: 't', startsAt: new Date(0), endsAt: new Date(1000), allDay: false, memo: null, reminder: 'NONE' as const, place: null };
    expect(isUnchanged(base, { ...base, startsAt: new Date(0) })).toBe(true);
    expect(isUnchanged(base, { ...base, title: 'u' })).toBe(false);
    expect(isUnchanged(base, { ...base, startsAt: new Date(1) })).toBe(false);
    expect(isUnchanged(base, { ...base, endsAt: new Date(999) })).toBe(false);
    expect(isUnchanged(base, { ...base, allDay: true })).toBe(false);
    expect(isUnchanged(base, { ...base, memo: '' })).toBe(false);
    expect(isUnchanged(base, { ...base, reminder: 'HOUR_1' })).toBe(false);
  });

  it('update: startsAt 만 바꾸면 나머지는 현재 값을 그대로 넘긴다', async () => {
    const current = { ...ROW, memo: '원래 메모', allDay: true };
    events.findInGroup.mockResolvedValue(current);
    events.updateWithLogTx.mockResolvedValue({ ...current, startsAt: new Date('2026-12-01T11:00:00.000Z') });
    const updated = await service.update(1, 10, 100, { startsAt: '2026-12-01T11:00:00.000Z' });
    expect(updated.startsAt).toEqual(new Date('2026-12-01T11:00:00.000Z'));
    expect(events.updateWithLogTx).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100 }),
      { title: '회의', startsAt: new Date('2026-12-01T11:00:00.000Z'), endsAt: ROW.endsAt, allDay: true, memo: '원래 메모', reminder: 'NONE', remindAt: null, reminderSetAt: expect.any(Date), place: null },
      1,
    );
  });

  it('remove: 현재 행을 스냅샷으로 넘겨 DELETED 로그 + 삭제', async () => {
    events.findInGroup.mockResolvedValueOnce(ROW);
    events.deleteWithLogTx.mockResolvedValue(7);
    expect(await service.remove(1, 10, 100)).toEqual({ ok: true, deletionId: 7 });
    expect(events.deleteWithLogTx).toHaveBeenCalledWith(ROW, 1);

    events.findInGroup.mockResolvedValueOnce(null);
    await expect(service.remove(1, 10, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(events.deleteWithLogTx).toHaveBeenCalledTimes(1);
  });

  it('(#375) restore: 팀원 누구나. 없거나 기간이 지나면 404, 그 사이 바뀌었으면 409 (D-251)', async () => {
    const now = new Date('2026-11-13T00:00:00Z');
    events.restoreDeletionTx.mockResolvedValueOnce({ eventId: 100, occurrence: null });
    expect(await service.restore(2, 10, 5, now)).toEqual({ ok: true, eventId: 100, occurrence: null });
    expect(events.restoreDeletionTx).toHaveBeenCalledWith(10, 5, now);

    events.restoreDeletionTx.mockResolvedValueOnce('NOT_FOUND');
    await expect(service.restore(2, 10, 5, now)).rejects.toMatchObject({ code: 'NOT_FOUND', message: '되돌릴 수 있는 기간이 지났어요' });
    events.restoreDeletionTx.mockResolvedValueOnce('CONFLICT');
    await expect(service.restore(2, 10, 5, now)).rejects.toMatchObject({ code: 'EVENT_RESTORE_CONFLICT' });
  });
});

/** (#248) 참여자 입력, 저장, 변경 판정, 응답 (설계 3장) */
describe('EventsService 참여자', () => {
  let events: RepositoryMock<EventsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: EventsService;
  const input = { title: '회의', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false };
  const PICKED = { ...ROW, allMembers: false, participantIds: [2] };

  beforeEach(() => {
    events = mockRepository(EventsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, config);
    service = new EventsService(events as never, memberships, emptyResponses() as never, new EventSeriesService(events as never, memberships));
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listByGroup.mockResolvedValue([
      membershipRow(),
      membershipRow({ id: 1002, userId: 2, color: '#F2994A', displayName: '밥', joinedAt: new Date('2026-11-02T00:00:00.000Z') }),
    ]);
    events.createWithLogTx.mockResolvedValue(ROW);
    events.updateWithLogTx.mockResolvedValue(ROW);
  });

  const createdParticipants = () => events.createWithLogTx.mock.calls[0][0].participants;

  it('생성: 생략하면 [요청자], ALL 은 지금 멤버 id 목록(#444, D-263), 배열은 오름차순 중복 없이', async () => {
    await service.create(1, 10, input);
    expect(createdParticipants()).toEqual({ allMembers: false, ids: [1] });
    events.createWithLogTx.mockClear();
    await service.create(1, 10, { ...input, participants: 'ALL' });
    expect(createdParticipants()).toEqual({ allMembers: false, ids: [1, 2] });
    events.createWithLogTx.mockClear();
    await service.create(1, 10, { ...input, participants: [2, 1, 2] });
    expect(createdParticipants()).toEqual({ allMembers: false, ids: [1, 2] });
  });

  it('생성: [] 와 형식 오류는 VALIDATION_FAILED (participants), 저장하지 않는다', async () => {
    await expect(service.create(1, 10, { ...input, participants: [] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'participants', message: '참여자를 한 명 이상 골라 주세요' }],
    });
    await expect(service.create(1, 10, { ...input, participants: null as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(events.createWithLogTx).not.toHaveBeenCalled();
  });

  it('생성: 멤버 아닌 id 는 저장 트랜잭션의 VALIDATION_FAILED 를 그대로 낸다', async () => {
    events.createWithLogTx.mockRejectedValue(participantsFailed('이 팀 멤버만 참여자로 고를 수 있어요'));
    await expect(service.create(1, 10, { ...input, participants: [99] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'participants', message: '이 팀 멤버만 참여자로 고를 수 있어요' }],
    });
  });

  it('응답: 모두면 지금 멤버 전원(가입순), 골라 담기면 참여자, 참여자 없음은 빈 목록', async () => {
    events.findInGroup.mockResolvedValueOnce(ROW);
    expect((await service.get(1, 10, 100)).participants).toEqual({
      all: true,
      members: [
        { userId: 1, displayName: '앨리스', color: '#F26D6D', profileImageUrl: null },
        { userId: 2, displayName: '밥', color: '#F2994A', profileImageUrl: null },
      ],
    });
    events.findInGroup.mockResolvedValueOnce(PICKED);
    expect((await service.get(1, 10, 100)).participants).toEqual({ all: false, members: [{ userId: 2, displayName: '밥', color: '#F2994A', profileImageUrl: null }] });
    events.findInGroup.mockResolvedValueOnce({ ...ROW, allMembers: false, participantIds: [] });
    expect((await service.get(1, 10, 100)).participants).toEqual({ all: false, members: [] });
  });

  it('수정: 참여자만 바꿔도 UPDATED 저장 (행을 다시 쓰도록 participants 를 넘긴다)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await service.update(1, 10, 100, { participants: [2] });
    expect(events.updateWithLogTx).toHaveBeenCalledWith(ROW, expect.objectContaining({ participants: { allMembers: false, ids: [2] }, title: ROW.title }), 1);
  });

  it('수정: 같은 참여자(순서 달라도, ALL 이 지금 멤버 전원과 같아도)면 저장도 로그도 없다', async () => {
    events.findInGroup.mockResolvedValue({ ...ROW, allMembers: false, participantIds: [1, 2] });
    await service.update(1, 10, 100, { participants: [2, 1] });
    await service.update(1, 10, 100, { participants: 'ALL' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('(#444) 수정: "모두" 로 남은 일정에 ALL 을 보내면 지금 멤버 id 목록으로 저장한다 (D-263)', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await service.update(1, 10, 100, { participants: 'ALL' });
    expect(events.updateWithLogTx.mock.calls[0][1].participants).toEqual({ allMembers: false, ids: [1, 2] });
  });

  it('수정: 생략하면 참여자는 그대로 (참여자 없음 일정도 다른 필드는 고칠 수 있다)', async () => {
    events.findInGroup.mockResolvedValue({ ...ROW, allMembers: false, participantIds: [] });
    await service.update(1, 10, 100, { title: '새 제목' });
    const data = events.updateWithLogTx.mock.calls[0][1];
    expect(data).not.toHaveProperty('participants');
    expect(data.title).toBe('새 제목');
  });

  it('수정: [] 는 VALIDATION_FAILED', async () => {
    events.findInGroup.mockResolvedValue(ROW);
    await expect(service.update(1, 10, 100, { participants: [] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(events.updateWithLogTx).not.toHaveBeenCalled();
  });

  it('한 번짜리 → 반복 켜기: 같은 행이라 참여자는 넘기지 않는다(유지)', async () => {
    events.findInGroup.mockResolvedValue(PICKED);
    await service.update(1, 10, 100, { repeat: 'WEEKLY' });
    expect(events.updateWithLogTx.mock.calls[0][1]).not.toHaveProperty('participants');
  });
});
