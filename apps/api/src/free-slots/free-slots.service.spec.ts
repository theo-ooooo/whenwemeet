import { ApiException } from '../common/errors.js';
import { EventsRepository } from '../events/events.repository.js';
import { GroupsRepository } from '../groups/groups.repository.js';
import { MembershipService } from '../groups/membership.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { FreeSlotsQueryDto } from './dto/free-slots-query.dto.js';
import { FreeSlotsService } from './free-slots.service.js';

describe('FreeSlotsService', () => {
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let events: RepositoryMock<EventsRepository>;
  let service: FreeSlotsService;
  const now = new Date('2026-11-09T00:00:00.000Z');

  const query = (overrides: Partial<FreeSlotsQueryDto> = {}): FreeSlotsQueryDto =>
    Object.assign(new FreeSlotsQueryDto(), { from: '2026-11-10T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' }, overrides);

  beforeEach(() => {
    membershipsRepo = mockRepository(MembershipsRepository);
    events = mockRepository(EventsRepository);
    const memberships = new MembershipService(membershipsRepo as never, mockRepository(GroupsRepository) as never, { getOrThrow: () => 'http://web' } as never);
    service = new FreeSlotsService(membershipsRepo as never, events as never, memberships);
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.listUserIds.mockResolvedValue(['u1', 'u2']); // 1. 팀 멤버
    membershipsRepo.listDistinctGroupIds.mockResolvedValue(['g1', 'p1', 'p2']); // 2. 멤버들의 모든 팀
    events.listBusyRanges.mockResolvedValue([
      { startsAt: new Date('2026-11-10T01:00:00.000Z'), endsAt: new Date('2026-11-10T03:00:00.000Z') },
    ]);
  });

  it('멤버가 아니면 FORBIDDEN 이고 DB 를 더 보지 않는다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.find('u9', 'g1', query(), now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(membershipsRepo.listUserIds).not.toHaveBeenCalled();
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('3단계 쿼리: 멤버 → 모든 팀 → 바쁜 구간, 종일 기본 제외', async () => {
    const result = await service.find('u1', 'g1', query(), now);
    expect(result.memberCount).toBe(2);
    expect(result.slots.map((s) => [s.startsAt.toISOString(), s.endsAt.toISOString()])).toEqual([
      ['2026-11-10T03:00:00.000Z', '2026-11-10T14:00:00.000Z'],
    ]);
    expect(membershipsRepo.listUserIds).toHaveBeenCalledWith('g1');
    expect(membershipsRepo.listDistinctGroupIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(events.listBusyRanges).toHaveBeenCalledWith(
      ['g1', 'p1', 'p2'],
      new Date('2026-11-10T00:00:00.000Z'),
      new Date('2026-11-11T00:00:00.000Z'),
      false,
    );
  });

  it('includeAllDay=true 면 그대로 Repository 에 전달', async () => {
    await service.find('u1', 'g1', query({ includeAllDay: true }), now);
    expect(events.listBusyRanges.mock.calls[0][3]).toBe(true);
  });

  it('from 이 과거면 현재 시각으로 잘라 계산한다 (정각이면 그대로)', async () => {
    const later = new Date('2026-11-10T05:00:00.000Z');
    const result = await service.find('u1', 'g1', query(), later);
    expect(result.slots[0].startsAt).toEqual(later);
    expect(events.listBusyRanges.mock.calls[0][1]).toEqual(later);
  });

  it('from 이 과거면 현재 시각을 다음 30분 경계로 올린다 (05:37 → 06:00, 이슈 #16)', async () => {
    const later = new Date('2026-11-10T05:37:00.000Z');
    const rounded = new Date('2026-11-10T06:00:00.000Z');
    const result = await service.find('u1', 'g1', query(), later);
    expect(result.slots[0].startsAt).toEqual(rounded);
    expect(events.listBusyRanges.mock.calls[0][1]).toEqual(rounded);
  });

  it('올림한 시각이 to 이상이면 빈 결과', async () => {
    const result = await service.find('u1', 'g1', query(), new Date('2026-11-10T23:45:00.000Z'));
    expect(result).toEqual({ slots: [], memberCount: 2 });
    expect(membershipsRepo.listDistinctGroupIds).not.toHaveBeenCalled();
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('범위 전체가 과거면 빈 결과, 조회는 안 한다', async () => {
    const result = await service.find('u1', 'g1', query(), new Date('2026-12-01T00:00:00.000Z'));
    expect(result).toEqual({ slots: [], memberCount: 2 });
    expect(events.listBusyRanges).not.toHaveBeenCalled();
  });

  it('31일 초과 / to <= from → EVENT_RANGE_INVALID, dayStart >= dayEnd → VALIDATION_FAILED', async () => {
    await expect(service.find('u1', 'g1', query({ to: '2026-12-12T00:00:00.000Z' }), now)).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    await expect(service.find('u1', 'g1', query({ to: '2026-11-10T00:00:00.000Z' }), now)).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    await expect(service.find('u1', 'g1', query({ dayStart: '12:00', dayEnd: '12:00' }), now)).rejects.toBeInstanceOf(ApiException);
    await expect(service.find('u1', 'g1', query({ dayStart: '12:00', dayEnd: '12:00' }), now)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(membershipsRepo.listUserIds).not.toHaveBeenCalled();
  });
});
