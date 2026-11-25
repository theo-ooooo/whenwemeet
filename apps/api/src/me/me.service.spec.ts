import { AuthProviders } from '../auth/providers/auth-providers.js';
import { DevProvider } from '../auth/providers/dev.provider.js';
import { EmailProvider } from '../auth/providers/email.provider.js';
import { ApiException } from '../common/errors.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { mockRepository, RepositoryMock } from '../testing/repository-mock.js';
import { UsersRepository } from '../users/users.repository.js';
import { MeService } from './me.service.js';

describe('MeService', () => {
  let users: RepositoryMock<UsersRepository>;
  let membershipsRepo: RepositoryMock<MembershipsRepository>;
  let service: MeService;
  const kakao = { provider: 'KAKAO' as const, exchangeCode: vi.fn(), unlink: vi.fn() };
  const apple = { provider: 'APPLE' as const, unlink: vi.fn() };
  const dev = new DevProvider();
  const devUnlink = vi.spyOn(dev, 'unlink');
  const email = new EmailProvider();
  const emailUnlink = vi.spyOn(email, 'unlink');
  const avatars = { purgeObjects: vi.fn() };
  const ASSISTANT = { available: true, consented: false, dailyLimit: 30, usedToday: 0 };
  const assistant = { status: vi.fn(), consent: vi.fn() };
  const notices = { hasUnread: vi.fn() };

  beforeEach(() => {
    users = mockRepository(UsersRepository);
    membershipsRepo = mockRepository(MembershipsRepository);
    kakao.unlink.mockReset();
    apple.unlink.mockReset().mockResolvedValue(undefined);
    devUnlink.mockClear();
    emailUnlink.mockClear();
    avatars.purgeObjects.mockReset().mockResolvedValue(undefined);
    assistant.status.mockReset().mockResolvedValue(ASSISTANT);
    assistant.consent.mockReset();
    notices.hasUnread.mockReset().mockResolvedValue(false);
    users.findRole.mockResolvedValue('user');
    service = new MeService(users as never, membershipsRepo as never, new AuthProviders(kakao as never, dev, apple as never, email), avatars as never, assistant as never, notices as never);
    membershipsRepo.listByUserWithGroupType.mockResolvedValue([
      { id: 501, groupId: 21, groupType: 'PERSONAL' },
      { id: 502, groupId: 31, groupType: 'TEAM' },
      { id: 503, groupId: 32, groupType: 'TEAM' },
    ]);
    users.deleteAccountTx.mockResolvedValue(undefined);
  });

  it('unlink 실패 시 DB 는 건드리지 않는다', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null }]);
    kakao.unlink.mockRejectedValue(new ApiException('KAKAO_ERROR'));
    await expect(service.deleteAccount(1)).rejects.toMatchObject({ code: 'KAKAO_ERROR' });
    expect(membershipsRepo.listByUserWithGroupType).not.toHaveBeenCalled();
    expect(avatars.purgeObjects).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('연결 계정마다 제공자별 unlink → 개인 팀은 삭제, 팀 멤버십은 나가기로 나눠 한 트랜잭션에 넘긴다', async () => {
    users.listAuthAccounts.mockResolvedValue([
      { provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null },
      { provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null },
    ]);
    kakao.unlink.mockResolvedValue(undefined);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(users.listAuthAccounts).toHaveBeenCalledWith(1);
    expect(kakao.unlink).toHaveBeenCalledWith({ provider: 'KAKAO', providerUserId: '123', providerClientId: null, refreshToken: null });
    expect(devUnlink).toHaveBeenCalledWith({ provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null });
    expect(avatars.purgeObjects).toHaveBeenCalledWith(1);
    expect(avatars.purgeObjects.mock.invocationCallOrder[0]).toBeLessThan(users.deleteAccountTx.mock.invocationCallOrder[0]);
    expect(users.deleteAccountTx).toHaveBeenCalledTimes(1);
    expect(users.deleteAccountTx).toHaveBeenCalledWith(1, {
      deleteGroupIds: [21],
      leave: [
        { membershipId: 502, groupId: 31 },
        { membershipId: 503, groupId: 32 },
      ],
    });
  });

  it('개발 사용자(DEV 계정만) 는 카카오를 부르지 않는다', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'DEV', providerUserId: '개발', providerClientId: null, refreshToken: null }]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).toHaveBeenCalled();
  });

  it('(#245) 이메일 계정은 외부 연결이 없어 unlink 가 바로 성공하고 탈퇴 트랜잭션으로 간다 (8-1)', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'EMAIL', providerUserId: 'a@b.co', providerClientId: null, refreshToken: null }]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(emailUnlink).toHaveBeenCalledTimes(1);
    expect(kakao.unlink).not.toHaveBeenCalled();
    expect(users.deleteAccountTx).toHaveBeenCalled();
  });

  it('아직 붙이지 않은 제공자 계정이면 오류 (DB 는 그대로)', async () => {
    users.listAuthAccounts.mockResolvedValue([{ provider: 'NAVER', providerUserId: 'a', providerClientId: null, refreshToken: null }]);
    await expect(service.deleteAccount(1)).rejects.toThrow('지원하지 않는 로그인 제공자: NAVER');
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('애플 계정은 폐기용 client_id 와 refresh token 을 함께 넘기고, 폐기 실패면 DB 그대로 (앱.md 3.5)', async () => {
    const account = { provider: 'APPLE' as const, providerUserId: 'sub-1', providerClientId: 'day.whenwemeet.app', refreshToken: 'rt' };
    users.listAuthAccounts.mockResolvedValue([account]);
    expect(await service.deleteAccount(1)).toEqual({ ok: true });
    expect(apple.unlink).toHaveBeenCalledWith(account);

    users.deleteAccountTx.mockClear();
    apple.unlink.mockRejectedValue(new ApiException('APPLE_ERROR'));
    await expect(service.deleteAccount(1)).rejects.toMatchObject({ code: 'APPLE_ERROR' });
    expect(users.deleteAccountTx).not.toHaveBeenCalled();
  });

  it('updateNickname 은 Repository 에 그대로 넘긴다', async () => {
    const user = { id: 1, nickname: '새닉', profileImageUrl: null, createdAt: new Date() };
    users.updateNickname.mockResolvedValue(user);
    expect(await service.updateNickname(1, '새닉')).toBe(user);
    expect(users.updateNickname).toHaveBeenCalledWith(1, '새닉');
  });
  describe('AI 비서 (#450)', () => {
    it('GET /me 는 assistant 상태를 붙인다 (available, consented, dailyLimit, usedToday)', async () => {
      users.findStartCalendar.mockResolvedValue(null);
      users.findBirthday.mockResolvedValue(null);
      assistant.status.mockResolvedValue({ available: false, consented: true, dailyLimit: 30, usedToday: 7 });
      expect((await service.getProfile({ id: 1, nickname: '앨리스', profileImageUrl: null, createdAt: new Date(0) })).assistant).toEqual({
        available: false,
        consented: true,
        dailyLimit: 30,
        usedToday: 7,
      });
      expect(assistant.status).toHaveBeenCalledWith(1);
    });

    it('동의는 AssistantService 에 그대로 넘긴다', async () => {
      const consentedAt = new Date('2026-11-16T05:00:00.000Z');
      assistant.consent.mockResolvedValue({ consentedAt });
      expect(await service.consentAssistant(3)).toEqual({ consentedAt });
      expect(assistant.consent).toHaveBeenCalledWith(3);
    });
  });

  describe('내 생일 (#305)', () => {
    const user = { id: 1, nickname: '앨리스', profileImageUrl: null, createdAt: new Date('2026-11-01T00:00:00Z') };
    const stored = { birthday: '02-29', remindDayOf: true, remindDayBefore: true, remindWeekBefore: false };

    it('GET /me 는 생일과 알림 시점을 붙인다. 없으면 date null 에 기본 당일만', async () => {
      users.findStartCalendar.mockResolvedValue(null);
      users.findBirthday.mockResolvedValueOnce(stored);
      expect((await service.getProfile(user)).birthday).toEqual({ date: '02-29', reminders: ['DAY_OF', 'DAY_BEFORE'] });
      users.findBirthday.mockResolvedValueOnce({ ...stored, birthday: null });
      expect((await service.getProfile(user)).birthday).toEqual({ date: null, reminders: ['DAY_OF', 'DAY_BEFORE'] });
      users.findBirthday.mockResolvedValueOnce(null);
      expect((await service.getProfile(user)).birthday).toEqual({ date: null, reminders: ['DAY_OF'] });
    });

    it('PATCH /me/birthday: 알림을 생략하면 생일만, 보내면 칸 셋을 함께 저장한다', async () => {
      users.updateBirthday.mockImplementation(async (_id, { birthday, reminders }) => ({ ...stored, birthday, ...reminders }));
      expect(await service.updateBirthday(1, { date: '03-05' })).toEqual({ date: '03-05', reminders: ['DAY_OF', 'DAY_BEFORE'] });
      expect(users.updateBirthday).toHaveBeenLastCalledWith(1, { birthday: '03-05' });
      expect(await service.updateBirthday(1, { date: '03-05', reminders: ['WEEK_BEFORE'] })).toEqual({ date: '03-05', reminders: ['WEEK_BEFORE'] });
      expect(users.updateBirthday).toHaveBeenLastCalledWith(1, {
        birthday: '03-05',
        reminders: { remindDayOf: false, remindDayBefore: false, remindWeekBefore: true },
      });
      expect((await service.updateBirthday(1, { date: null })).date).toBeNull();
      expect(users.updateBirthday).toHaveBeenLastCalledWith(1, { birthday: null });
    });
  });

  describe('처음 여는 달력 (#300)', () => {
    const user = { id: 1, nickname: '앨리스', profileImageUrl: null, createdAt: new Date('2026-11-01T00:00:00Z') };

    beforeEach(() => {
      users.updateStartCalendar.mockImplementation(async (_id, value) => value);
    });

    it('GET /me 는 저장값을 붙인다. 행이 없거나 GROUP 인데 팀이 없으면 LAST, GROUP 이 아니면 groupId 는 null', async () => {
      users.findStartCalendar.mockResolvedValueOnce({ mode: 'GROUP', groupId: 31 });
      expect(await service.getProfile(user)).toEqual({ ...user, startCalendar: { mode: 'GROUP', groupId: 31 }, birthday: { date: null, reminders: ['DAY_OF'] }, assistant: ASSISTANT, role: 'user', isAdmin: false, hasUnreadNotice: false });
      users.findStartCalendar.mockResolvedValueOnce({ mode: 'GROUP', groupId: null });
      expect((await service.getProfile(user)).startCalendar).toEqual({ mode: 'LAST', groupId: null });
      users.findStartCalendar.mockResolvedValueOnce({ mode: 'PERSONAL', groupId: 31 });
      expect((await service.getProfile(user)).startCalendar).toEqual({ mode: 'PERSONAL', groupId: null });
      users.findStartCalendar.mockResolvedValueOnce(null);
      expect((await service.getProfile(user)).startCalendar).toEqual({ mode: 'LAST', groupId: null });
      expect(users.findStartCalendar).toHaveBeenCalledWith(1);
    });

    it('LAST, PERSONAL 은 groupId 없음 또는 null 로 저장한다', async () => {
      expect(await service.updateStartCalendar(1, { mode: 'PERSONAL' })).toEqual({ mode: 'PERSONAL', groupId: null });
      expect(await service.updateStartCalendar(1, { mode: 'LAST', groupId: null })).toEqual({ mode: 'LAST', groupId: null });
      expect(users.updateStartCalendar).toHaveBeenNthCalledWith(1, 1, { mode: 'PERSONAL', groupId: null });
      expect(users.updateStartCalendar).toHaveBeenNthCalledWith(2, 1, { mode: 'LAST', groupId: null });
      expect(membershipsRepo.listByUserWithGroupType).not.toHaveBeenCalled();
    });

    it('LAST, PERSONAL 에 groupId 가 있으면 400', async () => {
      await expect(service.updateStartCalendar(1, { mode: 'LAST', groupId: 31 })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'groupId', message: '팀을 고를 때만 팀 ID 를 보내 주세요' }],
      });
      await expect(service.updateStartCalendar(1, { mode: 'PERSONAL', groupId: 31 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(users.updateStartCalendar).not.toHaveBeenCalled();
    });

    it('GROUP 인데 groupId 가 없으면 400', async () => {
      await expect(service.updateStartCalendar(1, { mode: 'GROUP' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'groupId', message: '고정할 팀을 골라 주세요' }],
      });
      await expect(service.updateStartCalendar(1, { mode: 'GROUP', groupId: null })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(users.updateStartCalendar).not.toHaveBeenCalled();
    });

    it('GROUP 은 내 팀이면 저장, 내 팀이 아니면 403, 개인 팀이면 400', async () => {
      expect(await service.updateStartCalendar(1, { mode: 'GROUP', groupId: 32 })).toEqual({ mode: 'GROUP', groupId: 32 });
      expect(users.updateStartCalendar).toHaveBeenCalledWith(1, { mode: 'GROUP', groupId: 32 });
      users.updateStartCalendar.mockClear();

      await expect(service.updateStartCalendar(1, { mode: 'GROUP', groupId: 99 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(service.updateStartCalendar(1, { mode: 'GROUP', groupId: 21 })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'groupId', message: '내 달력은 "내 달력" 으로 골라 주세요' }],
      });
      expect(users.updateStartCalendar).not.toHaveBeenCalled();
    });
  });

  it('(#515) GET /me: 역할은 DB 값, 관리자 여부, 안 본 공지 (D-285)', async () => {
    const user = { id: 7, nickname: '관리', profileImageUrl: null, createdAt: new Date(0) };
    users.findRole.mockResolvedValueOnce('admin');
    notices.hasUnread.mockResolvedValueOnce(true);
    expect(await service.getProfile(user)).toMatchObject({ role: 'admin', isAdmin: true, hasUnreadNotice: true });
    expect(users.findRole).toHaveBeenCalledWith(7);
    expect(notices.hasUnread).toHaveBeenCalledWith(7);
    // 사용자 행이 사라진 경우(가드 뒤 탈퇴 경합)는 user 로
    users.findRole.mockResolvedValueOnce(null);
    expect(await service.getProfile(user)).toMatchObject({ role: 'user', isAdmin: false, hasUnreadNotice: false });
  });
});
