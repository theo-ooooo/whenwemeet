import { EventLogsRepository } from '../event-logs/event-logs.repository.js';
import { GroupActivitiesRepository } from '../group-activities/group-activities.repository.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { membershipRow, mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { GroupsRepository } from './groups.repository.js';
import { GroupsService } from './groups.service.js';
import { generateInviteCode, INVITE_CODE_PATTERN, isUniqueViolation, normalizeInviteCode } from './invite-code.js';
import { deriveKey } from '../email-login/email-crypto.js';
import { INVITE_MARKER_KEY_INFO, inviteMarker } from './invite-marker.js';
import { MembershipService } from './membership.service.js';

const SECRET = 'unit-secret-0123456789abcdef0123456789abcdef';
const ENV: Record<string, string> = { WEB_ORIGIN: 'http://web', JWT_SECRET: SECRET };
const config = { getOrThrow: (key: string) => ENV[key] ?? '' } as never;
/** (#196) 테스트가 기대하는 표식. 서비스와 같은 키 파생 */
const markerOf = (groupId: number, userId: number) => inviteMarker(deriveKey(SECRET, INVITE_MARKER_KEY_INFO), groupId, userId);
const GROUP = { id: 10, type: 'TEAM' as const, name: '팀', inviteCode: 'ABCDEF', publicCode: 'teamcode', createdAt: new Date('2026-11-01T00:00:00.000Z') };
const INVITE_GROUP = { id: 10, name: '팀', publicCode: 'teamcode', memberCount: 1 };

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
    await expect(service.assertMember(1, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    membershipsRepo.findByUserAndGroup.mockResolvedValueOnce(membershipRow());
    expect((await service.assertMember(1, 10)).id).toBe(1001);
    expect(membershipsRepo.findByUserAndGroup).toHaveBeenLastCalledWith(1, 10);
  });

  it('inviteUrl 은 WEB_ORIGIN/join/<code>, null 이면 null', () => {
    expect(service.inviteUrl('ABCDEF')).toBe('http://web/join/ABCDEF');
    expect(service.inviteUrl(null)).toBeNull();
  });

  it('groupDetail: 팀 없음 NOT_FOUND, 내 멤버십 없음 FORBIDDEN, 정상 조립', async () => {
    groupsRepo.findById.mockResolvedValueOnce(null);
    await expect(service.groupDetail(10, 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValueOnce([membershipRow({ userId: 2 })]);
    await expect(service.groupDetail(10, 1)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    membershipsRepo.listByGroup.mockResolvedValueOnce([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '별명', color: '#F2994A' })]);
    const detail = await service.groupDetail(10, 1);
    expect(detail).toMatchObject({ id: 10, type: 'TEAM', inviteCode: 'ABCDEF', inviteUrl: 'http://web/join/ABCDEF' });
    expect(detail.inviteShareUrl).toBe(`http://web/join/ABCDEF?by=${markerOf(10, 1)}`);
    expect(detail.members.map((m) => m.displayName)).toEqual(['앨리스', '별명']);
    expect(detail.me.userId).toBe(1);
  });

  it('(#196) inviteShareUrl: 요청자마다 다르고 코드가 없으면(PERSONAL) null', async () => {
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2 })]);
    const a = (await service.groupDetail(10, 1)).inviteShareUrl;
    const b = (await service.groupDetail(10, 2)).inviteShareUrl;
    expect(a).toMatch(/^http:\/\/web\/join\/ABCDEF\?by=[A-Za-z0-9_-]{10}$/);
    expect(a).not.toBe(b);

    groupsRepo.findById.mockResolvedValue({ ...GROUP, type: 'PERSONAL', inviteCode: null });
    expect((await service.groupDetail(10, 1)).inviteShareUrl).toBeNull();
  });
});

describe('GroupsService', () => {
  let groupsRepo: RepositoryMock<GroupsRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let eventLogs: RepositoryMock<EventLogsRepository>;
  let activities: RepositoryMock<GroupActivitiesRepository>;
  let pushScheduler: { kick: ReturnType<typeof vi.fn> };
  let service: GroupsService;

  beforeEach(() => {
    groupsRepo = mockRepository(GroupsRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    eventLogs = mockRepository(EventLogsRepository);
    activities = mockRepository(GroupActivitiesRepository);
    activities.countUnseenByOthers.mockResolvedValue(0);
    const memberships = new MembershipService(membershipsRepo as never, groupsRepo as never, config);
    pushScheduler = { kick: vi.fn() };
    service = new GroupsService(groupsRepo as never, membershipsRepo as never, eventLogs as never, memberships, pushScheduler as never, activities as never);
  });

  it('list: PERSONAL 먼저, unreadNewsCount 는 팀마다 lastSeenAt 이후 내 변경 제외로 센다', async () => {
    membershipsRepo.listForUserWithGroup.mockResolvedValueOnce([
      { color: '#1', displayName: null, lastSeenAt: new Date('2026-11-01T00:00:00.000Z'), joinedAt: new Date('2026-10-01T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 31, type: 'TEAM', name: '팀', publicCode: 'teamcode', _count: { memberships: 3 } } },
      { color: '#2', displayName: '나', lastSeenAt: new Date('2026-11-02T00:00:00.000Z'), joinedAt: new Date('2026-10-01T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 21, type: 'PERSONAL', name: '내 달력', publicCode: 'mycalcod', _count: { memberships: 1 } } },
    ]);
    eventLogs.countUnseenByOthers.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    const list = await service.list(1);
    expect(list.map((g) => g.id)).toEqual([21, 31]);
    expect(list[0]).toEqual({ id: 21, type: 'PERSONAL', name: '내 달력', publicCode: 'mycalcod', memberCount: 1, me: { color: '#2', displayName: '나' }, unreadNewsCount: 0 });
    expect(list[1].unreadNewsCount).toBe(4);
    expect(eventLogs.countUnseenByOthers).toHaveBeenLastCalledWith(31, new Date('2026-11-01T00:00:00.000Z'), 1);
  });

  it('list: unreadNewsCount 는 일정 기록 + 팀 활동 기록 (#191, D-154)', async () => {
    membershipsRepo.listForUserWithGroup.mockResolvedValueOnce([
      { color: '#1', displayName: null, lastSeenAt: new Date('2026-11-01T00:00:00.000Z'), joinedAt: new Date('2026-10-01T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 31, type: 'TEAM', name: '팀', publicCode: 'teamcode', _count: { memberships: 3 } } },
    ]);
    eventLogs.countUnseenByOthers.mockResolvedValueOnce(2);
    activities.countUnseenByOthers.mockResolvedValueOnce(3);
    const [team] = await service.list(1);
    expect(team.unreadNewsCount).toBe(5);
    expect(activities.countUnseenByOthers).toHaveBeenCalledWith(31, new Date('2026-11-01T00:00:00.000Z'), 1);
  });

  it('(#297) list: lastSeenAt 이 joinedAt 보다 이르면 joinedAt 이후만 센다 (D-180)', async () => {
    membershipsRepo.listForUserWithGroup.mockResolvedValueOnce([
      { color: '#1', displayName: null, lastSeenAt: new Date('2026-11-01T00:00:00.000Z'), joinedAt: new Date('2026-11-03T00:00:00.000Z'), user: { nickname: '닉' }, group: { id: 31, type: 'TEAM', name: '팀', publicCode: 'teamcode', _count: { memberships: 3 } } },
    ]);
    eventLogs.countUnseenByOthers.mockResolvedValueOnce(0);
    await service.list(1);
    expect(eventLogs.countUnseenByOthers).toHaveBeenCalledWith(31, new Date('2026-11-03T00:00:00.000Z'), 1);
    expect(activities.countUnseenByOthers).toHaveBeenCalledWith(31, new Date('2026-11-03T00:00:00.000Z'), 1);
  });

  it('create: TEAM + 초대 코드 + 첫 멤버, 코드 충돌(P2002) 이면 재시도', async () => {
    groupsRepo.createTeam.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce({ id: 10 });
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    const detail = await service.create(1, '팀');
    expect(detail.id).toBe(10);
    expect(groupsRepo.createTeam).toHaveBeenCalledTimes(2);
    const input = groupsRepo.createTeam.mock.calls[1][0];
    expect(input).toMatchObject({ name: '팀', firstMember: { userId: 1, color: '#F26D6D' } });
    expect(input.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(groupsRepo.createTeam.mock.calls[0][0].inviteCode).not.toBe(input.inviteCode);
  });

  it('create: 다른 오류는 그대로 던진다', async () => {
    groupsRepo.createTeam.mockRejectedValueOnce(new Error('db down'));
    await expect(service.create(1, '팀')).rejects.toThrow('db down');
  });

  it('detail / rename 은 멤버십 확인 후 진행', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(null);
    await expect(service.detail(1, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.rename(1, 10, '새')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(groupsRepo.renameWithActivityTx).not.toHaveBeenCalled();

    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findById.mockResolvedValue({ ...GROUP, name: '새' });
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    expect((await service.rename(1, 10, '새')).name).toBe('새');
    // (#191) 기록할 사람 이름은 팀 표시 이름 ?? 닉네임 스냅샷. 같은 이름이면 기록 안 함은 Repository 가 판단 (e2e)
    expect(groupsRepo.renameWithActivityTx).toHaveBeenCalledWith(10, '새', { id: 1, name: '앨리스' });
    expect((await service.detail(1, 10)).id).toBe(10);
  });

  it('rotateInviteCode: PERSONAL → GROUP_NOT_INVITABLE, 팀 없음 → NOT_FOUND, 충돌 재시도', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.rotateInviteCode(1, 10)).rejects.toMatchObject({ code: 'GROUP_NOT_INVITABLE' });

    groupsRepo.findType.mockResolvedValueOnce(null);
    await expect(service.rotateInviteCode(1, 10)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(groupsRepo.setInviteCodeTx).not.toHaveBeenCalled();

    groupsRepo.findType.mockResolvedValueOnce({ type: 'TEAM' });
    groupsRepo.setInviteCodeTx.mockRejectedValueOnce({ code: 'P2002' }).mockResolvedValueOnce(undefined);
    const result = await service.rotateInviteCode(1, 10);
    expect(result.inviteCode).toMatch(INVITE_CODE_PATTERN);
    expect(result.inviteUrl).toBe(`http://web/join/${result.inviteCode}`);
    expect(result.inviteShareUrl).toBe(`http://web/join/${result.inviteCode}?by=${markerOf(10, 1)}`);
    expect(groupsRepo.setInviteCodeTx).toHaveBeenCalledTimes(2);
    expect(groupsRepo.setInviteCodeTx).toHaveBeenLastCalledWith(10, result.inviteCode);

    groupsRepo.findType.mockResolvedValueOnce({ type: 'TEAM' });
    groupsRepo.setInviteCodeTx.mockRejectedValueOnce(new Error('x'));
    await expect(service.rotateInviteCode(1, 10)).rejects.toThrow('x');
  });

  it('invitePreview: 정규화해서 조회, 없거나 빈 코드는 INVITE_NOT_FOUND', async () => {
    groupsRepo.findByInviteCode.mockResolvedValueOnce({ id: 10, name: '팀', publicCode: 'teamcode', memberCount: 2 });
    expect(await service.invitePreview(' abcdef ')).toEqual({ groupName: '팀', memberCount: 2, inviter: null, isMember: false, groupId: null, groupCode: null });
    expect(groupsRepo.findByInviteCode).toHaveBeenCalledWith('ABCDEF');
    // by 도 로그인도 없으면 멤버 목록을 읽지 않는다
    expect(membershipsRepo.listByGroup).not.toHaveBeenCalled();

    groupsRepo.findByInviteCode.mockResolvedValueOnce(null);
    await expect(service.invitePreview('ZZZZZZ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    await expect(service.invitePreview('   ')).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(groupsRepo.findByInviteCode).toHaveBeenCalledTimes(2);
  });

  it('(#196) invitePreview: by 가 현재 멤버 표식이면 팀 표시 이름, 틀림/나간 멤버/다른 팀/형식 오류는 inviter null', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue({ id: 10, name: '팀', publicCode: 'teamcode', memberCount: 2 });
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, displayName: '별명' })]);

    expect((await service.invitePreview('ABCDEF', markerOf(10, 1))).inviter).toEqual({ nickname: '앨리스' });
    // 팀 표시 이름이 있으면 그것
    expect((await service.invitePreview('ABCDEF', markerOf(10, 2))).inviter).toEqual({ nickname: '별명' });

    const misses: unknown[] = [markerOf(10, 3), markerOf(11, 1), 'AAAAAAAAAA', 'short', `${markerOf(10, 1)}x`, '', ['a', 'b'], 42];
    for (const by of misses) {
      expect(await service.invitePreview('ABCDEF', by)).toEqual({ groupName: '팀', memberCount: 2, inviter: null, isMember: false, groupId: null, groupCode: null });
    }
  });

  it('(#196) invitePreview: 로그인한 사용자가 멤버면 isMember + groupId, 아니면 false + null', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue({ id: 10, name: '팀', publicCode: 'teamcode', memberCount: 1 });
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow()]);
    expect(await service.invitePreview('ABCDEF', undefined, 1)).toMatchObject({ isMember: true, groupId: 10, groupCode: 'teamcode', inviter: null });
    expect(await service.invitePreview('ABCDEF', undefined, 2)).toMatchObject({ isMember: false, groupId: null });
    expect(await service.invitePreview('ABCDEF', markerOf(10, 1), 1)).toMatchObject({ isMember: true, groupId: 10, inviter: { nickname: '앨리스' } });
  });

  it('join: 가장 적게 쓰인 색을 고르는 규칙을 넘겨 멤버십을 만들고 상세를 돌려준다', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue(INVITE_GROUP);
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.addMemberIfAbsentTx.mockResolvedValue(true);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2, color: '#F2994A' })]);
    const detail = await service.join(2, 'abcdef');
    expect(detail.me.userId).toBe(2);
    expect(membershipsRepo.addMemberIfAbsentTx).toHaveBeenCalledWith(2, 10, expect.any(Function), undefined);
    const pickColor = membershipsRepo.addMemberIfAbsentTx.mock.calls[0][2];
    expect(pickColor(['#F26D6D'])).toBe('#F2994A');
    expect(pickColor([])).toBe('#F26D6D');
    // (#188) 새 멤버십이면 커밋 뒤 틱을 깨운다 (D-91)
    expect(pushScheduler.kick).toHaveBeenCalledTimes(1);
  });

  it('join: 이미 멤버면 합류 알림 틱을 깨우지 않는다 (#188)', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue(INVITE_GROUP);
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.addMemberIfAbsentTx.mockResolvedValue(false);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2 })]);
    await service.join(2, 'ABCDEF');
    expect(pushScheduler.kick).not.toHaveBeenCalled();
  });

  it('join: 동시 참여로 P2002 가 나도 성공, 다른 오류는 전파', async () => {
    groupsRepo.findByInviteCode.mockResolvedValue(INVITE_GROUP);
    groupsRepo.findById.mockResolvedValue(GROUP);
    membershipsRepo.listByGroup.mockResolvedValue([membershipRow(), membershipRow({ id: 1002, userId: 2 })]);
    membershipsRepo.addMemberIfAbsentTx.mockRejectedValueOnce({ code: 'P2002' });
    expect((await service.join(2, 'ABCDEF')).id).toBe(10);

    membershipsRepo.addMemberIfAbsentTx.mockRejectedValueOnce(new Error('boom'));
    await expect(service.join(2, 'ABCDEF')).rejects.toThrow('boom');
  });

  it('updateMe: color 는 대문자로, displayName null 은 되돌림, undefined 는 미변경', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.updateMe.mockResolvedValue({ ...membershipRow(), color: '#ABCDEF', displayName: null });
    const member = await service.updateMe(1, 10, { color: '#abcdef', displayName: null });
    expect(membershipsRepo.updateMe).toHaveBeenCalledWith(1001, { color: '#ABCDEF', displayName: null });
    expect(member).toMatchObject({ userId: 1, displayName: '앨리스', color: '#ABCDEF' });

    await service.updateMe(1, 10, {});
    expect(membershipsRepo.updateMe).toHaveBeenLastCalledWith(1001, {});
  });

  it('updateMe: notify 를 저장하고 응답에 내 notify 를 싣는다 (#188)', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    membershipsRepo.updateMe.mockResolvedValue({ ...membershipRow(), notify: false });
    const member = await service.updateMe(1, 10, { notify: false });
    expect(membershipsRepo.updateMe).toHaveBeenCalledWith(1001, { notify: false });
    expect(member).toMatchObject({ userId: 1, notify: false });
  });

  it('leave: 멤버 아님 → FORBIDDEN, PERSONAL → GROUP_PERSONAL_LEAVE, 팀 없음 → NOT_FOUND', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValueOnce(null);
    await expect(service.leave(1, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValueOnce({ type: 'PERSONAL' });
    await expect(service.leave(1, 10)).rejects.toMatchObject({ code: 'GROUP_PERSONAL_LEAVE' });
    groupsRepo.findType.mockResolvedValueOnce(null);
    await expect(service.leave(1, 10)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(membershipsRepo.leaveGroupTx).not.toHaveBeenCalled();
  });

  it('leave: 트랜잭션 결과를 groupDeleted 로 돌려준다', async () => {
    membershipsRepo.findByUserAndGroup.mockResolvedValue(membershipRow());
    groupsRepo.findType.mockResolvedValue({ type: 'TEAM' });
    membershipsRepo.leaveGroupTx.mockResolvedValueOnce(false);
    expect(await service.leave(1, 10)).toEqual({ groupDeleted: false });
    expect(membershipsRepo.leaveGroupTx).toHaveBeenCalledWith(1001, 10);

    membershipsRepo.leaveGroupTx.mockResolvedValueOnce(true);
    expect(await service.leave(1, 10)).toEqual({ groupDeleted: true });
  });
});
