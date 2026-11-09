import { asPrisma, createPrismaMock, membershipRow, PrismaMock } from '../testing/prisma-mock.js';
import { GroupsService } from './groups.service.js';
import { generateInviteCode, INVITE_CODE_PATTERN, isUniqueViolation, normalizeInviteCode } from './invite-code.js';
import { MembershipService } from './membership.service.js';

const config = { getOrThrow: (key: string) => (key === 'WEB_ORIGIN' ? 'http://web' : '') } as never;
const GROUP = { id: 'g1', type: 'TEAM' as const, name: '팀', inviteCode: 'ABCDEF', createdAt: new Date('2026-11-01T00:00:00.000Z') };

describe('invite-code', () => {
  it('generateInviteCode 는 허용 알파벳 6자', () => {
    for (let i = 0; i < 50; i += 1) expect(generateInviteCode()).toMatch(INVITE_CODE_PATTERN);
  });
  it('normalizeInviteCode 는 대문자 + 공백 제거, isUniqueViolation 은 P2002 만', () => {
    expect(normalizeInviteCode(' ab c12 ')).toBe('ABC12');
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('MembershipService', () => {
  let prisma: PrismaMock;
  let service: MembershipService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new MembershipService(asPrisma(prisma), config);
  });

  it('assertMember: 없으면 FORBIDDEN, 있으면 행 반환', async () => {
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    await expect(service.assertMember('u1', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    prisma.membership.findUnique.mockResolvedValueOnce(membershipRow());
    expect((await service.assertMember('u1', 'g1')).id).toBe('m1');
    expect(prisma.membership.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId_groupId: { userId: 'u1', groupId: 'g1' } } }));
  });

  it('inviteUrl 은 WEB_ORIGIN/join/<code>, null 이면 null', () => {
    expect(service.inviteUrl('ABCDEF')).toBe('http://web/join/ABCDEF');
    expect(service.inviteUrl(null)).toBeNull();
  });

  it('groupDetail: 팀 없음 NOT_FOUND, 내 멤버십 없음 FORBIDDEN, 정상 조립', async () => {
    prisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.groupDetail('g1', 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    prisma.group.findUnique.mockResolvedValue(GROUP);
    prisma.membership.findMany.mockResolvedValueOnce([membershipRow({ userId: 'u2' })]);
    await expect(service.groupDetail('g1', 'u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    prisma.membership.findMany.mockResolvedValueOnce([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', displayName: '별명', color: '#F2994A' })]);
    const detail = await service.groupDetail('g1', 'u1');
    expect(detail).toMatchObject({ id: 'g1', type: 'TEAM', inviteCode: 'ABCDEF', inviteUrl: 'http://web/join/ABCDEF' });
    expect(detail.members.map((m) => m.displayName)).toEqual(['앨리스', '별명']);
    expect(detail.me.userId).toBe('u1');
  });
});

describe('GroupsService', () => {
  let prisma: PrismaMock;
  let service: GroupsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new GroupsService(asPrisma(prisma), new MembershipService(asPrisma(prisma), config));
  });

  it('list: PERSONAL 먼저, unreadNewsCount 는 내 변경 제외(actorId null 포함)', async () => {
    prisma.membership.findMany.mockResolvedValueOnce([
      { color: '#1', displayName: null, lastSeenAt: new Date('2026-11-01T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 't1', type: 'TEAM', name: '팀', _count: { memberships: 3 } } },
      { color: '#2', displayName: '나', lastSeenAt: new Date('2026-11-02T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 'p1', type: 'PERSONAL', name: '내 달력', _count: { memberships: 1 } } },
    ]);
    prisma.eventLog.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    const list = await service.list('u1');
    expect(list.map((g) => g.id)).toEqual(['p1', 't1']);
    expect(list[0]).toEqual({ id: 'p1', type: 'PERSONAL', name: '내 달력', memberCount: 1, me: { color: '#2', displayName: '나' }, unreadNewsCount: 0 });
    expect(list[1].unreadNewsCount).toBe(4);
    expect(prisma.eventLog.count).toHaveBeenLastCalledWith({
      where: { groupId: 't1', createdAt: { gt: new Date('2026-11-01T00:00:00.000Z') }, OR: [{ actorId: null }, { actorId: { not: 'u1' } }] },
    });
  });

  it('create: TEAM + 초대 코드 + 첫 멤버, 코드 충돌(P2002) 이면 재시도', async () => {
    prisma.group.create.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({ id: 'g1' });
    prisma.group.findUnique.mockResolvedValue(GROUP);
    prisma.membership.findMany.mockResolvedValue([membershipRow()]);
    const detail = await service.create('u1', '팀');
    expect(detail.id).toBe('g1');
    expect(prisma.group.create).toHaveBeenCalledTimes(2);
    const data = prisma.group.create.mock.calls[1][0].data;
    expect(data).toMatchObject({ type: 'TEAM', name: '팀', memberships: { create: { userId: 'u1', color: '#F26D6D' } } });
    expect(data.inviteCode).toMatch(INVITE_CODE_PATTERN);
  });

  it('create: 다른 오류는 그대로 던진다', async () => {
    prisma.group.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.create('u1', '팀')).rejects.toThrow('db down');
  });

  it('detail / rename 은 멤버십 확인 후 진행', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.detail('u1', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.rename('u1', 'g1', '새')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(prisma.group.update).not.toHaveBeenCalled();

    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, name: '새' });
    prisma.membership.findMany.mockResolvedValue([membershipRow()]);
    expect((await service.rename('u1', 'g1', '새')).name).toBe('새');
    expect(prisma.group.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { name: '새' } });
    expect((await service.detail('u1', 'g1')).id).toBe('g1');
  });

  it('rotateInviteCode: PERSONAL → GROUP_NOT_INVITABLE, 팀 없음 → NOT_FOUND, 충돌 재시도', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.group.findUnique.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toMatchObject({ code: 'GROUP_NOT_INVITABLE' });

    prisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    prisma.group.findUnique.mockResolvedValueOnce({ type: 'TEAM' });
    prisma.group.update.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({});
    const result = await service.rotateInviteCode('u1', 'g1');
    expect(result.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(result.inviteUrl).toBe(`http://web/join/${result.inviteCode}`);
    expect(prisma.group.update).toHaveBeenCalledTimes(2);

    prisma.group.findUnique.mockResolvedValueOnce({ type: 'TEAM' });
    prisma.group.update.mockRejectedValueOnce(new Error('x'));
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toThrow('x');
  });

  it('invitePreview: 정규화해서 조회, 없거나 빈 코드는 INVITE_NOT_FOUND', async () => {
    prisma.group.findUnique.mockResolvedValueOnce({ id: 'g1', name: '팀', _count: { memberships: 2 } });
    expect(await service.invitePreview(' abcdef ')).toEqual({ groupName: '팀', memberCount: 2 });
    expect(prisma.group.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { inviteCode: 'ABCDEF' } }));

    prisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.invitePreview('ZZZZZZ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await expect(service.invitePreview('   ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(prisma.group.findUnique).toHaveBeenCalledTimes(2);
  });

  it('join: 신규면 가장 적게 쓰인 색으로 멤버십 생성, 이미 멤버면 생성 없이 같은 응답', async () => {
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, _count: { memberships: 1 } });
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    prisma.membership.findMany
      .mockResolvedValueOnce([{ color: '#F26D6D' }])
      .mockResolvedValueOnce([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', color: '#F2994A' })]);
    const detail = await service.join('u2', 'abcdef');
    expect(prisma.membership.create).toHaveBeenCalledWith({ data: { userId: 'u2', groupId: 'g1', color: '#F2994A' } });
    expect(detail.me.userId).toBe('u2');

    prisma.membership.findUnique.mockResolvedValueOnce({ id: 'm2' });
    prisma.membership.findMany.mockResolvedValueOnce([membershipRow(), membershipRow({ id: 'm2', userId: 'u2' })]);
    await service.join('u2', 'ABCDEF');
    expect(prisma.membership.create).toHaveBeenCalledTimes(1);
  });

  it('join: 동시 참여로 P2002 가 나도 성공, 다른 오류는 전파', async () => {
    prisma.group.findUnique.mockResolvedValue({ ...GROUP, _count: { memberships: 1 } });
    prisma.membership.findUnique.mockResolvedValue(null);
    prisma.membership.findMany.mockResolvedValue([membershipRow(), membershipRow({ id: 'm2', userId: 'u2' })]);
    prisma.membership.create.mockRejectedValueOnce({ code: 'P2002' });
    expect((await service.join('u2', 'ABCDEF')).id).toBe('g1');

    prisma.membership.create.mockRejectedValueOnce(new Error('boom'));
    await expect(service.join('u2', 'ABCDEF')).rejects.toThrow('boom');
  });

  it('updateMe: color 는 대문자로, displayName null 은 되돌림, undefined 는 미변경', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.membership.update.mockResolvedValue({ ...membershipRow(), color: '#ABCDEF', displayName: null });
    const member = await service.updateMe('u1', 'g1', { color: '#abcdef', displayName: null });
    expect(prisma.membership.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' }, data: { color: '#ABCDEF', displayName: null } }));
    expect(member).toMatchObject({ userId: 'u1', displayName: '앨리스', color: '#ABCDEF' });

    await service.updateMe('u1', 'g1', {});
    expect(prisma.membership.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: {} }));
  });

  it('leave: PERSONAL → GROUP_PERSONAL_LEAVE, 팀 없음 → NOT_FOUND', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.group.findUnique.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.leave('u1', 'g1')).rejects.toMatchObject({ code: 'GROUP_PERSONAL_LEAVE' });
    prisma.group.findUnique.mockResolvedValueOnce(null);
    await expect(service.leave('u1', 'g1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.membership.delete).not.toHaveBeenCalled();
  });

  it('leave: 남은 멤버가 있으면 false, 0 이면 팀 삭제 + true (한 트랜잭션)', async () => {
    prisma.membership.findUnique.mockResolvedValue(membershipRow());
    prisma.group.findUnique.mockResolvedValue({ type: 'TEAM' });
    prisma.membership.count.mockResolvedValueOnce(1);
    expect(await service.leave('u1', 'g1')).toEqual({ groupDeleted: false });
    expect(prisma.membership.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(prisma.group.delete).not.toHaveBeenCalled();

    prisma.membership.count.mockResolvedValueOnce(0);
    expect(await service.leave('u1', 'g1')).toEqual({ groupDeleted: true });
    expect(prisma.group.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
