import { ApiException } from '../common/errors.js';
import { MembershipService } from '../groups/membership.service.js';
import { asPrisma, createPrismaMock, membershipRow, PrismaMock } from '../testing/prisma-mock.js';
import { assertEventRange, EventsService, parseRange } from './events.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 'e1',
  groupId: 'g1',
  title: '회의',
  startsAt: new Date('2026-12-01T10:00:00.000Z'),
  endsAt: new Date('2026-12-01T12:00:00.000Z'),
  allDay: false,
  memo: null,
  creatorId: 'u1',
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: { nickname: '앨리스', profileImageUrl: null },
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
  let prisma: PrismaMock;
  let service: EventsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new EventsService(asPrisma(prisma), new MembershipService(asPrisma(prisma), config));
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.membership.findMany.mockResolvedValue([membershipRow()]);
  });

  it('멤버가 아니면 모든 메서드가 FORBIDDEN', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    const input = { title: 't', startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T11:00:00Z', allDay: false };
    await expect(service.list('u9', 'g1', '2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.get('u9', 'g1', 'e1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create('u9', 'g1', input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update('u9', 'g1', 'e1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove('u9', 'g1', 'e1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it('list: 겹침 조건 + 정렬, creator 를 Member 로', async () => {
    prisma.event.findMany.mockResolvedValue([ROW]);
    const list = await service.list('u1', 'g1', '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z');
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: 'g1', startsAt: { lt: new Date('2026-12-02T00:00:00.000Z') }, endsAt: { gt: new Date('2026-12-01T00:00:00.000Z') } },
      orderBy: { startsAt: 'asc' },
    }));
    expect(list[0]).toMatchObject({ id: 'e1', creator: { userId: 'u1', displayName: '앨리스', color: '#F26D6D' } });
    expect(list[0]).not.toHaveProperty('creatorId');
  });

  it('get: 다른 팀 ID 는 NOT_FOUND', async () => {
    prisma.event.findFirst.mockResolvedValueOnce(null);
    await expect(service.get('u1', 'g1', 'e-other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e-other', groupId: 'g1' } }));
    prisma.event.findFirst.mockResolvedValueOnce(ROW);
    expect((await service.get('u1', 'g1', 'e1')).id).toBe('e1');
  });

  it('create: 범위 검증 후 트랜잭션에서 일정 + CREATED 로그', async () => {
    await expect(
      service.create('u1', 'g1', { title: 't', startsAt: '2026-12-01T12:00:00Z', endsAt: '2026-12-01T10:00:00Z', allDay: false }),
    ).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(prisma.event.create).not.toHaveBeenCalled();

    prisma.event.create.mockResolvedValue(ROW);
    const created = await service.create('u1', 'g1', { title: '회의', startsAt: '2026-12-01T10:00:00.000Z', endsAt: '2026-12-01T12:00:00.000Z', allDay: false });
    expect(created.id).toBe('e1');
    expect(prisma.event.create.mock.calls[0][0].data).toEqual({
      groupId: 'g1', title: '회의', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: null, creatorId: 'u1',
    });
    expect(prisma.eventLog.create).toHaveBeenCalledWith({
      data: { groupId: 'g1', eventId: 'e1', actorId: 'u1', action: 'CREATED', title: '회의', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false },
    });
  });

  it('update: 부분 변경은 현재 값과 합쳐 검증, UPDATED 로그', async () => {
    prisma.event.findFirst.mockResolvedValue(ROW);
    await expect(service.update('u1', 'g1', 'e1', { endsAt: '2026-12-01T09:00:00Z' })).rejects.toMatchObject({ code: 'EVENT_RANGE_INVALID' });
    expect(prisma.event.update).not.toHaveBeenCalled();

    prisma.event.update.mockResolvedValue({ ...ROW, title: '변경', memo: '메모' });
    const updated = await service.update('u1', 'g1', 'e1', { title: '변경', memo: '메모' });
    expect(updated.title).toBe('변경');
    expect(prisma.event.update.mock.calls[0][0].data).toEqual({ title: '변경', startsAt: ROW.startsAt, endsAt: ROW.endsAt, allDay: false, memo: '메모' });
    expect(prisma.eventLog.create.mock.calls[0][0].data).toMatchObject({ action: 'UPDATED', title: '변경', actorId: 'u1' });

    prisma.event.findFirst.mockResolvedValueOnce(null);
    await expect(service.update('u1', 'g1', 'nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remove: 삭제 전 DELETED 스냅샷', async () => {
    prisma.event.findFirst.mockResolvedValueOnce(ROW);
    expect(await service.remove('u1', 'g1', 'e1')).toEqual({ ok: true });
    const logOrder = prisma.eventLog.create.mock.invocationCallOrder[0];
    const deleteOrder = prisma.event.delete.mock.invocationCallOrder[0];
    expect(logOrder).toBeLessThan(deleteOrder);
    expect(prisma.eventLog.create.mock.calls[0][0].data).toMatchObject({ action: 'DELETED', eventId: 'e1', title: '회의' });

    prisma.event.findFirst.mockResolvedValueOnce(null);
    await expect(service.remove('u1', 'g1', 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
