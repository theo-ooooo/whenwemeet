import { MembershipService } from '../groups/membership.service.js';
import { asPrisma, createPrismaMock, membershipRow, PrismaMock } from '../testing/prisma-mock.js';
import { AnniversariesService, dateStringToDb, dbToDateString } from './anniversaries.service.js';

const config = { getOrThrow: () => 'http://web' } as never;
const ROW = {
  id: 'a1',
  groupId: 'g1',
  name: '기념일',
  date: new Date('2024-03-15T00:00:00.000Z'),
  creatorId: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  creator: null,
};

describe('date 변환', () => {
  it('YYYY-MM-DD ↔ UTC 자정 Date', () => {
    expect(dateStringToDb('2024-03-15').toISOString()).toBe('2024-03-15T00:00:00.000Z');
    expect(dbToDateString(new Date('2024-03-15T00:00:00.000Z'))).toBe('2024-03-15');
  });
});

describe('AnniversariesService', () => {
  let prisma: PrismaMock;
  let service: AnniversariesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AnniversariesService(asPrisma(prisma), new MembershipService(asPrisma(prisma), config));
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.membership.findMany.mockResolvedValue([membershipRow()]);
  });

  it('멤버가 아니면 FORBIDDEN', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.list('u9', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.create('u9', 'g1', { name: 'x', date: '2024-01-01' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update('u9', 'g1', 'a1', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.remove('u9', 'g1', 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('list: date 오름차순, 탈퇴자는 "탈퇴한 멤버"', async () => {
    prisma.anniversary.findMany.mockResolvedValue([ROW]);
    const list = await service.list('u1', 'g1');
    expect(prisma.anniversary.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId: 'g1' }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }));
    expect(list[0]).toMatchObject({ id: 'a1', date: '2024-03-15', creator: { userId: null, displayName: '탈퇴한 멤버' } });
  });

  it('create: 문자열 날짜를 UTC 자정으로 저장', async () => {
    prisma.anniversary.create.mockResolvedValue({ ...ROW, creatorId: 'u1', creator: { nickname: '앨리스', profileImageUrl: null } });
    const created = await service.create('u1', 'g1', { name: '기념일', date: '2024-03-15' });
    expect(prisma.anniversary.create.mock.calls[0][0].data).toEqual({ groupId: 'g1', name: '기념일', date: new Date('2024-03-15T00:00:00.000Z'), creatorId: 'u1' });
    expect(created.creator.displayName).toBe('앨리스');
  });

  it('update / remove: 다른 팀 ID 는 NOT_FOUND, 부분 변경만 전달', async () => {
    prisma.anniversary.findFirst.mockResolvedValueOnce(null);
    await expect(service.update('u1', 'g1', 'nope', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    prisma.anniversary.findFirst.mockResolvedValue({ id: 'a1' });
    prisma.anniversary.update.mockResolvedValue({ ...ROW, date: new Date('2024-03-16T00:00:00.000Z') });
    const updated = await service.update('u1', 'g1', 'a1', { date: '2024-03-16' });
    expect(prisma.anniversary.update.mock.calls[0][0].data).toEqual({ date: new Date('2024-03-16T00:00:00.000Z') });
    expect(updated.date).toBe('2024-03-16');

    await service.update('u1', 'g1', 'a1', { name: '새' });
    expect(prisma.anniversary.update.mock.calls[1][0].data).toEqual({ name: '새' });

    expect(await service.remove('u1', 'g1', 'a1')).toEqual({ ok: true });
    expect(prisma.anniversary.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });

    prisma.anniversary.findFirst.mockResolvedValueOnce(null);
    await expect(service.remove('u1', 'g1', 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
