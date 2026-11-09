import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { GroupsRepository } from './groups.repository.js';
import { GroupsService } from './groups.service.js';
import { generateInviteCode, INVITE_CODE_PATTERN, isUniqueViolation, normalizeInviteCode } from './invite-code.js';
import { MembershipService } from './membership.service.js';

const config = { getOrThrow: (key: string) => (key === 'WEB_ORIGIN' ? 'http://web' : '') } as never;
const GROUP = { id: 'g1', type: 'TEAM' as const, name: '팀', inviteCode: 'ABCDEF', createdAt: new Date('2026-11-01T00:00:00.000Z') };
const INVITE_GROUP = { id: 'g1', name: '팀', memberCount: 1 };

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
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let groupsRepo: RepositoryMock<GroupsRepository>;
  let service: MembershipService;

  beforeEach(() => {
    membershipsRepo = mockRepository(MembershipsRepository);
    groupsRepo = mockRepository(GroupsRepository);
    service = new MembershipService(membershipsRepo as never, groupsRepo as never, config);
  });

  it('assertMember: 없으면 FORBIDDEN, 있으면 행 반환', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValueOnce(null);
    await expect(service.assertMember('u1', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    membershipsRepo.findByUserAndGroup.mockResolvedValueOnce(membershipRow());
    expect((await service.assertMember('u1', 'g1')).id).toBe('m1');
    expect(membershipsRepo.findByUserAndGroup).toHaveBeenLastCalledWith('u1', 'g1');
  });

  it('inviteUrl 은 WEB_ORIGIN/join/<code>, null 이면 null', () => {
    expect(service.inviteUrl('ABCDEF')).toBe('http://web/join/ABCDEF');
    expect(service.inviteUrl(null)).toBeNull();
  });

  it('groupDetail: 팀 없음 NOT_FOUND, 내 멤버십 없음 FORBIDDEN, 정상 조립', async () => {
    groupsRepo.findById.mockResolvedValueOnce(null);
    await expect(service.groupDetail('g1', 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValueOnce([membershipRow({ userId: 'u2' })]);
    await expect(service.groupDetail('g1', 'u1')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    membershipsRepo.listByGroup.mockResolvedValueOnce([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', displayName: '별명', color: '#F2994A' })]);
    const detail = await service.groupDetail('g1', 'u1');
    expect(detail).toMatchObject({ id: 'g1', type: 'TEAM', inviteCode: 'ABCDEF', inviteUrl: 'http://web/join/ABCDEF' });
    expect(detail.members.map((m) => m.displayName)).toEqual(['앨리스', '별명']);
    expect(detail.me.userId).toBe('u1');
  });
});

describe('GroupsService', () => {
  let groupsRepo: RepositoryMock<GroupsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let eventLogs: RepositoryMock<EventLogsRepository>;
  let service: GroupsService;

  beforeEach(() => {
    groupsRepo = mockRepository(GroupsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    eventLogs = mockRepository(EventLogsRepository);
    const memberships = new MembershipService(membershipsRepo as never, groupsRepo as never, config);
    service = new GroupsService(groupsRepo as never, membershipsRepo as never, eventLogs as never, memberships);
  });

  it('list: PERSONAL 먼저, unreadNewsCount 는 팀마다 lastSeenAt 이후 내 변경 제외로 센다', async () => {
    membershipsRepo.listForUserWithGroup.mockResolvedValueOnce([
      { color: '#1', displayName: null, lastSeenAt: new Date('2026-11-01T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 't1', type: 'TEAM', name: '팀', _count: { memberships: 3 } } },
      { color: '#2', displayName: '나', lastSeenAt: new Date('2026-11-02T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 'p1', type: 'PERSONAL', name: '내 달력', _count: { memberships: 1 } } },
    ]);
    eventLogs.countUnseenByOthers.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    const list = await service.list('u1');
    expect(list.map((g) => g.id)).toEqual(['p1', 't1']);
    expect(list[0]).toEqual({ id: 'p1', type: 'PERSONAL', name: '내 달력', memberCount: 1, me: { color: '#2', displayName: '나' }, unreadNewsCount: 0 });
    expect(list[1].unreadNewsCount).toBe(4);
    expect(eventLogs.countUnseenByOthers).toHaveBeenLastCalledWith('t1', new Date('2026-11-01T00:00:00.000Z'), 'u1');
  });

  it('create: TEAM + 초대 코드 + 첫 멤버, 코드 충돌(P2002) 이면 재시도', async () => {
    groupsRepo.createTeam.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({ id: 'g1' });
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    const detail = await service.create('u1', '팀');
    expect(detail.id).toBe('g1');
    expect(groupsRepo.createTeam).toHaveBeenCalledTimes(2);
    const input = groupsRepo.createTeam.mock.calls[1][0];
    expect(input).toMatchObject({ name: '팀', firstMember: { userId: 'u1', color: '#F26D6D' } });
    expect(input.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(groupsRepo.createTeam.mock.calls[0][0].inviteCode).not.toBe(input.inviteCode);
  });

  it('create: 다른 오류는 그대로 던진다', async () => {
    groupsRepo.createTeam.mockRejectedValueOnce(new Error('db down'));
    await expect(service.create('u1', '팀')).rejects.toThrow('db down');
  });

  it('detail / rename 은 멤버십 확인 후 진행', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.detail('u1', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.rename('u1', 'g1', '새')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(groupsRepo.rename).not.toHaveBeenCalled();

    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findById.mockResolvedValue({ ...GROUP, name: '새' });
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    expect((await service.rename('u1', 'g1', '새')).name).toBe('새');
    expect(groupsRepo.rename).toHaveBeenCalledWith('g1', '새');
    expect((await service.detail('u1', 'g1')).id).toBe('g1');
  });

  it('rotateInviteCode: PERSONAL → GROUP_NOT_INVITABLE, 팀 없음 → NOT_FOUND, 충돌 재시도', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toMatchObject({ code: 'GROUP_NOT_INVITABLE' });

    groupsRepo.findType.mockResolvedValueOnce(null);
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(groupsRepo.setInviteCode).not.toHaveBeenCalled();

    groupsRepo.findType.mockResolvedValueOnce({ type: 'TEAM' });
    groupsRepo.setInviteCode.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce(undefined);
    const result = await service.rotateInviteCode('u1', 'g1');
    expect(result.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(result.inviteUrl).toBe(`http://web/join/${result.inviteCode}`);
    expect(groupsRepo.setInviteCode).toHaveBeenCalledTimes(2);
    expect(groupsRepo.setInviteCode).toHaveBeenLastCalledWith('g1', result.inviteCode);

    groupsRepo.findType.mockResolvedValueOnce({ type: 'TEAM' });
    groupsRepo.setInviteCode.mockRejectedValueOnce(new Error('x'));
    await expect(service.rotateInviteCode('u1', 'g1')).rejects.toThrow('x');
  });

  it('invitePreview: 정규화해서 조회, 없거나 빈 코드는 INVITE_NOT_FOUND', async () => {
    groupsRepo.findByInviteCode.mockResolvedValueOnce({ id: 'g1', name: '팀', memberCount: 2 });
    expect(await service.invitePreview(' abcdef ')).toEqual({ groupName: '팀', memberCount: 2 });
    expect(groupsRepo.findByInviteCode).toHaveBeenCalledWith('ABCDEF');

    groupsRepo.findByInviteCode.mockResolvedValueOnce(null);
    await expect(service.invitePreview('ZZZZZZ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await expect(service.invitePreview('   ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(groupsRepo.findByInviteCode).toHaveBeenCalledTimes(2);
  });

  it('join: 가장 적게 쓰인 색을 고르는 규칙을 넘겨 멤버십을 만들고 상세를 돌려준다', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue(INVITE_GROUP);
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.addMemberIfAbsentTx.mockResolvedValue(undefined);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 'm2', userId: 'u2', color: '#F2994A' })]);
    const detail = await service.join('u2', 'abcdef');
    expect(detail.me.userId).toBe('u2');
    expect(membershipsRepo.addMemberIfAbsentTx).toHaveBeenCalledWith('u2', 'g1', expect.any(Function));
    const pickColor = membershipsRepo.addMemberIfAbsentTx.mock.calls[0][2];
    expect(pickColor(['#F26D6D'])).toBe('#F2994A');
    expect(pickColor([])).toBe('#F26D6D');
  });

  it('join: 동시 참여로 P2002 가 나도 성공, 다른 오류는 전파', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue(INVITE_GROUP);
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 'm2', userId: 'u2' })]);
    membershipsRepo.addMemberIfAbsentTx.mockRejectedValueOnce({ code: 'P2002' });
    expect((await service.join('u2', 'ABCDEF')).id).toBe('g1');

    membershipsRepo.addMemberIfAbsentTx.mockRejectedValueOnce(new Error('boom'));
    await expect(service.join('u2', 'ABCDEF')).rejects.toThrow('boom');
  });

  it('updateMe: color 는 대문자로, displayName null 은 되돌림, undefined 는 미변경', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.updateMe.mockResolvedValue({ ...membershipRow(), color: '#ABCDEF', displayName: null });
    const member = await service.updateMe('u1', 'g1', { color: '#abcdef', displayName: null });
    expect(membershipsRepo.updateMe).toHaveBeenCalledWith('m1', { color: '#ABCDEF', displayName: null });
    expect(member).toMatchObject({ userId: 'u1', displayName: '앨리스', color: '#ABCDEF' });

    await service.updateMe('u1', 'g1', {});
    expect(membershipsRepo.updateMe).toHaveBeenLastCalledWith('m1', {});
  });

  it('leave: 멤버 아님 → FORBIDDEN, PERSONAL → GROUP_PERSONAL_LEAVE, 팀 없음 → NOT_FOUND', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValueOnce(null);
    await expect(service.leave('u1', 'g1')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.leave('u1', 'g1')).rejects.toMatchObject({ code: 'GROUP_PERSONAL_LEAVE' });
    groupsRepo.findType.mockResolvedValueOnce(null);
    await expect(service.leave('u1', 'g1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(membershipsRepo.leaveGroupTx).not.toHaveBeenCalled();
  });

  it('leave: 트랜잭션 결과를 groupDeleted 로 돌려준다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValue({ type: 'TEAM' });
    membershipsRepo.leaveGroupTx.mockResolvedValueOnce(false);
    expect(await service.leave('u1', 'g1')).toEqual({ groupDeleted: false });
    expect(membershipsRepo.leaveGroupTx).toHaveBeenCalledWith('m1', 'g1');

    membershipsRepo.leaveGroupTx.mockResolvedValueOnce(true);
    expect(await service.leave('u1', 'g1')).toEqual({ groupDeleted: true });
  });
});
