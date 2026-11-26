import { ApiException } from '../common/errors.js';
import { EventBusyRepository } from '../events/event-busy.repository.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import {
  membershipRow,
  mockRepository,
  RepositoryMock,
} from '../testing/repository-mock.js';
import { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { FreeSlotsService } from './free-slots.service.js';

describe('FreeSlotsService', () => {
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let events: RepositoryMock<EventBusyRepository>;
  let service: FreeSlotsService;
  const now = new Date('2026-11-09T00:00:00.000Z');

  const query = (
    overrides: Partial<FreeSlotsQueryDto> = {},
  ): FreeSlotsQueryDto =>
    Object.assign(
      new FreeSlotsQueryDto(),
      { from: '2026-11-10T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' },
      overrides,
    );

  beforeEach(() => {
    membershipsRepo = mockRepository(MembershipsRepository);
    events = mockRepository(EventBusyRepository);
    const memberships = new MembershipService(
      membershipsRepo as never,
      mockRepository(GroupsRepository) as never,
      { getOrThrow: () => 'http://web' } as never,
    );
    service = new FreeSlotsService(
      membershipsRepo as never,
      events as never,
      memberships,
    );
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listUserIds.mockResolvedValue([1, 2]); // 1. 팀 멤버
    membershipsRepo.listDistinctGroupIds.mockResolvedValue([10, 21, 22]); // 2. 멤버들의 모든 팀
    events.listBusyRanges.mockResolvedValue([
      {
        startsAt: new Date('2026-11-10T01:00:00.000Z'),
        endsAt: new Date('2026-11-10T03:00:00.000Z'),
        allMembers: true,
        participantIds: [],
      },
    ]);
    events.listBusySeries.mockResolvedValue([]);
  });

  it('멤버가 아니면 FORBIDDEN 이고 DB 를 더 보지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.find(9, 10, query(), now)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(membershipsRepo.listUserIds).not.toHaveBeenCalled();
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('3단계 쿼리: 멤버 → 모든 팀 → 바쁜 구간, 종일 기본 제외', async () => {
    const result = await service.find(1, 10, query(), now);
    expect(result.memberCount).toBe(2);
    expect(
      result.slots.map((s) => [
        s.startsAt.toISOString(),
        s.endsAt.toISOString(),
      ]),
    ).toEqual([['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z']]);
    expect(membershipsRepo.listUserIds).toHaveBeenCalledWith(10);
    expect(membershipsRepo.listDistinctGroupIds).toHaveBeenCalledWith([1, 2]);
    expect(events.listBusyRanges).toHaveBeenCalledWith(
      [10, 21, 22],
      new Date('2026-11-10T00:00:00.000Z'),
      new Date('2026-11-11T00:00:00.000Z'),
      false,
    );
  });

  it('(#248) 한 번짜리도 참여자로 거른다: 참여자 없음, 다른 사람만 참여한 일정은 바쁨이 아니다', async () => {
    const range = {
      startsAt: new Date('2026-11-10T01:00:00.000Z'),
      endsAt: new Date('2026-11-10T03:00:00.000Z'),
    };
    events.listBusyRanges.mockResolvedValue([
      { ...range, allMembers: false, participantIds: [] },
      { ...range, allMembers: false, participantIds: [3] },
    ]);
    const result = await service.find(1, 10, query(), now);
    expect(
      result.slots.map((s) => [
        s.startsAt.toISOString(),
        s.endsAt.toISOString(),
      ]),
    ).toEqual([['2026-11-10T00:00:00.000Z', '2026-11-10T14:00:00.000Z']]);
    events.listBusyRanges.mockResolvedValue([
      { ...range, allMembers: false, participantIds: [2] },
    ]);
    expect(
      (await service.find(1, 10, query(), now)).slots[0].startsAt.toISOString(),
    ).toBe('2026-11-10T03:00:00.000Z');
  });

  it('includeAllDay=true 면 그대로 Repository 에 전달', async () => {
    await service.find(1, 10, query({ includeAllDay: true }), now);
    expect(events.listBusyRanges.mock.calls[0][3]).toBe(true);
  });

  it('from 이 과거면 현재 시각으로 잘라 계산한다 (정각이면 그대로)', async () => {
    const later = new Date('2026-11-10T05:00:00.000Z');
    const result = await service.find(1, 10, query(), later);
    expect(result.slots[0].startsAt).toEqual(later);
    expect(events.listBusyRanges.mock.calls[0][1]).toEqual(later);
  });

  it('from 이 과거면 현재 시각을 다음 30분 경계로 올린다 (05:37 → 06:00, 이슈 #16)', async () => {
    const later = new Date('2026-11-10T05:37:00.000Z');
    const rounded = new Date('2026-11-10T06:00:00.000Z');
    const result = await service.find(1, 10, query(), later);
    expect(result.slots[0].startsAt).toEqual(rounded);
    expect(events.listBusyRanges.mock.calls[0][1]).toEqual(rounded);
  });

  it('올림한 시각이 to 이상이면 빈 결과', async () => {
    const result = await service.find(
      1,
      10,
      query(),
      new Date('2026-11-10T23:45:00.000Z'),
    );
    expect(result).toEqual({ slots: [], memberCount: 2 });
    expect(membershipsRepo.listDistinctGroupIds).not.toHaveBeenCalled();
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('범위 전체가 과거면 빈 결과, 조회는 안 한다', async () => {
    const result = await service.find(
      1,
      10,
      query(),
      new Date('2026-12-01T00:00:00.000Z'),
    );
    expect(result).toEqual({ slots: [], memberCount: 2 });
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('dayEnd=24:00 이면 그날 KST 자정까지 빈 시간을 낸다 (#58)', async () => {
    const result = await service.find(1, 10, query({ dayEnd: '24:00' }), now);
    // 11/10 KST 09:00~24:00 = 00:00Z~15:00Z 에서 바쁨 01:00Z~03:00Z 를 빼고 120분 미만(00:00Z~01:00Z) 은 버림
    expect(
      result.slots.map((s) => [
        s.startsAt.toISOString(),
        s.endsAt.toISOString(),
      ]),
    ).toEqual([['2026-11-10T03:00:00.000Z', '2026-11-10T15:00:00.000Z']]);
  });

  it('dayStart 에는 24:00 을 받지 않는다 (dayStart < dayEnd 유지, #58)', async () => {
    await expect(
      service.find(1, 10, query({ dayStart: '24:00', dayEnd: '24:00' }), now),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('31일 초과 / to <= from → EVENT_RANGE_INVALID, dayStart >= dayEnd → VALIDATION_FAILED', async () => {
    await expect(
      service.find(1, 10, query({ to: '2026-12-12T00:00:00.000Z' }), now),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    await expect(
      service.find(1, 10, query({ to: '2026-11-10T00:00:00.000Z' }), now),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    await expect(
      service.find(1, 10, query({ dayStart: '12:00', dayEnd: '12:00' }), now),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      service.find(1, 10, query({ dayStart: '12:00', dayEnd: '12:00' }), now),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [
        { field: 'dayStart', message: 'dayStart 는 dayEnd 보다 앞이어야 해요' },
      ],
    });
    expect(membershipsRepo.listUserIds).not.toHaveBeenCalled();
  });
  describe('반복 일정 회차도 바쁨 (#187, 설계 4-2)', () => {
    // 11/10(화) 은 2026-11-03(화) 부터 매주인 회차가 있는 날
    const weekly = (overrides: object = {}) => ({
      startsAt: new Date('2026-11-03T05:00:00.000Z'), // KST 14:00
      endsAt: new Date('2026-11-03T07:00:00.000Z'), // KST 16:00
      allDay: false,
      repeat: 'WEEKLY' as const,
      repeatUntil: null,
      exceptions: [],
      allMembers: true,
      participantIds: [] as number[],
      ...overrides,
    });
    const pairs = (slots: { startsAt: Date; endsAt: Date }[]) =>
      slots.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()]);

    it('펼친 회차를 한 번짜리 busy 와 합쳐 병합한다 (같은 팀 목록으로 조회)', async () => {
      events.listBusySeries.mockResolvedValue([weekly()]);
      const result = await service.find(1, 10, query(), now);
      expect(events.listBusySeries).toHaveBeenCalledWith(
        [10, 21, 22],
        new Date('2026-11-10T00:00:00.000Z'),
        new Date('2026-11-11T00:00:00.000Z'),
      );
      // 창 00:00Z~14:00Z 에서 01~03Z(한 번짜리), 05~07Z(반복) 를 빼고 120분 이상만 (00~01Z 는 버림)
      expect(pairs(result.slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T05:00:00.000Z'],
        ['2026-11-10T07:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
    });

    it('예외로 옮긴 회차는 옮긴 시각이, 취소된 회차는 바쁨에서 빠진다', async () => {
      events.listBusySeries.mockResolvedValue([
        weekly({
          exceptions: [
            {
              occurrence: '2026-11-10',
              cancelled: false,
              startsAt: new Date('2026-11-10T10:00:00.000Z'),
              endsAt: new Date('2026-11-10T11:00:00.000Z'),
              allDay: null,
            },
          ],
        }),
      ]);
      expect(pairs((await service.find(1, 10, query(), now)).slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T10:00:00.000Z'],
        ['2026-11-10T11:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
      events.listBusySeries.mockResolvedValue([
        weekly({
          exceptions: [
            {
              occurrence: '2026-11-10',
              cancelled: true,
              startsAt: null,
              endsAt: null,
              allDay: null,
            },
          ],
        }),
      ]);
      expect(pairs((await service.find(1, 10, query(), now)).slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
    });

    it('종일 회차는 includeAllDay 일 때만 (예외가 종일 여부를 바꾸면 바꾼 값 기준)', async () => {
      const allDay = weekly({
        startsAt: new Date('2026-11-02T15:00:00.000Z'),
        endsAt: new Date('2026-11-03T15:00:00.000Z'),
        allDay: true,
      });
      events.listBusySeries.mockResolvedValue([allDay]);
      expect((await service.find(1, 10, query(), now)).slots).toHaveLength(1);
      expect(
        (await service.find(1, 10, query({ includeAllDay: true }), now)).slots,
      ).toEqual([]);
      events.listBusySeries.mockResolvedValue([
        weekly({
          exceptions: [
            {
              occurrence: '2026-11-10',
              cancelled: false,
              startsAt: null,
              endsAt: null,
              allDay: true,
            },
          ],
        }),
      ]);
      expect(pairs((await service.find(1, 10, query(), now)).slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
    });

    it('(#248) 참여자에 요청 팀 멤버가 없는 반복 원본은 펼치기 전에 빠진다, 모두/멤버 참여는 바쁨', async () => {
      events.listBusySeries.mockResolvedValue([
        weekly({ allMembers: false, participantIds: [3] }),
      ]);
      expect(pairs((await service.find(1, 10, query(), now)).slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
      events.listBusySeries.mockResolvedValue([
        weekly({ allMembers: false, participantIds: [2, 3] }),
      ]);
      expect((await service.find(1, 10, query(), now)).slots).toHaveLength(2);
    });

    it('repeatUntil 이 지난 원본은 바쁨이 아니다', async () => {
      events.listBusySeries.mockResolvedValue([
        weekly({ repeatUntil: '2026-11-09' }),
      ]);
      expect(pairs((await service.find(1, 10, query(), now)).slots)).toEqual([
        ['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z'],
      ]);
    });
  });

  it('(#450) computeFor: 고른 멤버만 바쁨으로 본다 (팀 멤버 전원이 아니라), 멤버십 검사 없음', async () => {
    events.listBusyRanges.mockResolvedValue([
      {
        startsAt: new Date('2026-11-10T01:00:00.000Z'),
        endsAt: new Date('2026-11-10T03:00:00.000Z'),
        allMembers: false,
        participantIds: [2],
      },
    ]);
    const options = {
      dayStartMin: 9 * 60,
      dayEndMin: 23 * 60,
      minMinutes: 120,
      includeAllDay: false,
    };
    const from = new Date('2026-11-10T00:00:00.000Z');
    const to = new Date('2026-11-11T00:00:00.000Z');
    const onlyMe = await service.computeFor([1], from, to, options, now);
    expect(
      onlyMe.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()]),
    ).toEqual([['2026-11-10T00:00:00.000Z', '2026-11-10T14:00:00.000Z']]);
    expect(membershipsRepo.listDistinctGroupIds).toHaveBeenLastCalledWith([1]);
    const withSky = await service.computeFor([1, 2], from, to, options, now);
    expect(withSky.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-11-10T03:00:00.000Z',
    ]);
    expect(membershipsRepo.findByUserAndGroup).not.toHaveBeenCalled();
    expect(await service.computeFor([1], from, from, options, now)).toEqual([]);
  });
});
