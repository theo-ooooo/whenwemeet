import { mockRepository, type RepositoryMock } from '../testing/repository-mock.js';
import type { ExpoPushClient, ExpoSendResult } from './expo-push.client.js';
import { PushDispatcher } from './push-dispatcher.js';
import type { PushPayload } from './push-copy.js';
import { type ClaimedDelivery, type DueNotification, PushRepository } from './push.repository.js';

const NOW = new Date('2026-11-12T08:00:00.000Z');
const MIN = 60 * 1000;
/** 예약을 만든 시각 (CHANGE 묶음의 첫 변경 등) */
const CREATED = new Date(NOW.getTime() - 2 * MIN);
const PAYLOAD: PushPayload = { title: '저녁 약속', subtitle: '우리', body: '1시간 뒤 오후 6:00', url: '/g/10/calendar', expiration: 0 };

const due = (overrides: Partial<DueNotification> = {}): DueNotification => ({
  id: 1,
  kind: 'REMINDER',
  dedupeKey: 'R:5:-:0',
  groupId: 10,
  scheduledAt: NOW,
  createdAt: CREATED,
  eventId: 5,
  occurrence: null,
  eventLogId: null,
  actorId: null,
  changeAction: null,
  payload: PAYLOAD,
  ...overrides,
});

const claimed = (id: number, overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery => ({
  id,
  token: `ExponentPushToken[t${id}]`,
  platform: 'IOS',
  attempts: 1,
  notification: { id: 1, kind: 'REMINDER', scheduledAt: NOW, payload: PAYLOAD },
  ...overrides,
});

describe('PushDispatcher', () => {
  let push: RepositoryMock<PushRepository>;
  let expo: { send: ReturnType<typeof vi.fn>; getReceipts: ReturnType<typeof vi.fn> };
  let dispatcher: PushDispatcher;
  let build: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    push = mockRepository(PushRepository);
    expo = { send: vi.fn(), getReceipts: vi.fn() };
    dispatcher = new PushDispatcher(push as never, expo as unknown as ExpoPushClient, { build: (build = vi.fn()) } as never);
    push.markCancelled.mockImplementation(async (ids) => ids.length);
    push.markSkipped.mockImplementation(async (ids) => ids.length);
    push.dispatchTx.mockResolvedValue(true);
    push.listRecipients.mockResolvedValue([]);
    push.withoutNotGoing.mockImplementation(async (recipients) => recipients);
    push.eventExists.mockResolvedValue(true);
    for (const name of ['markSent', 'markFailed', 'requeue', 'saveReceipts'] as const) push[name].mockResolvedValue(undefined);
    push.deleteDevicesByTokens.mockResolvedValue(0);
  });

  describe('펼치기 (5-6 A)', () => {
    it('예약 시각이 10분 넘게 지난 PENDING 은 SKIPPED, 10분 안은 펼친다 (D-88)', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 1, scheduledAt: new Date(NOW.getTime() - 11 * MIN) }), due({ id: 2, scheduledAt: new Date(NOW.getTime() - 9 * MIN) })]);
      const stats = await dispatcher.expandDue(NOW);
      expect(push.markSkipped).toHaveBeenCalledWith([1]);
      expect(push.dispatchTx).toHaveBeenCalledTimes(1);
      expect(push.dispatchTx.mock.calls[0][0]).toBe(2);
      expect(stats).toMatchObject({ dispatched: 1, skipped: 1 });
    });

    it('일정 알림: 원본이 없으면 SKIPPED, 받는 사람은 등록자 포함 모두 (제외 없음), payload 는 다시 쓰지 않는다', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 1 }), due({ id: 2, eventId: 6 })]);
      push.eventExists.mockImplementation(async (id) => id === 5);
      push.listRecipients.mockResolvedValue([{ userId: 1, token: 'a', platform: 'IOS' }]);
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenCalledWith(10, 'REMINDER', null, 5, null);
      expect(push.dispatchTx).toHaveBeenCalledWith(1, NOW, null, [{ userId: 1, token: 'a', platform: 'IOS' }]);
      expect(push.markSkipped).toHaveBeenLastCalledWith([2]);
    });

    it('(#190) 일정 알림은 그 회차에 불참으로 답한 사람을 뺀다 (D-228). 다른 종류는 거르지 않는다', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 1, occurrence: '2026-11-12' })]);
      push.listRecipients.mockResolvedValue([
        { userId: 1, token: 'a', platform: 'IOS' },
        { userId: 2, token: 'b', platform: 'IOS' },
      ]);
      push.withoutNotGoing.mockImplementation(async (recipients) => recipients.filter((r) => r.userId !== 2));
      await dispatcher.expandDue(NOW);
      expect(push.withoutNotGoing).toHaveBeenCalledWith(expect.any(Array), 5, '2026-11-12');
      expect(push.dispatchTx).toHaveBeenCalledWith(1, NOW, null, [{ userId: 1, token: 'a', platform: 'IOS' }]);
    });

    it('팀원 변경: 변경한 사람을 빼고, 로그 스냅샷과 팀 표시 이름으로 문구를 만들어 저장', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 3, kind: 'CHANGE', payload: null, eventLogId: 77, actorId: 1, changeAction: 'UPDATED' })]);
      push.findGroupRef.mockResolvedValue({ name: '우리', publicCode: 'teamcode' });
      push.findPersonName.mockResolvedValue('민지');
      push.findChangeLog.mockResolvedValue({
        eventId: 5,
        eventCode: 'evntcode',
        title: '저녁 약속',
        startsAt: new Date('2026-11-12T09:00:00.000Z'),
        endsAt: new Date('2026-11-12T10:00:00.000Z'),
        allDay: false,
        repeat: null,
        scope: null,
        occurrence: null,
      });
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenCalledWith(10, 'CHANGE', 1, null, CREATED);
      expect(push.withoutNotGoing).not.toHaveBeenCalled();
      expect(push.dispatchTx.mock.calls[0][2]).toMatchObject({ title: '민지님이 일정을 수정했어요', body: '저녁 약속, 11월 12일 (목) 오후 6:00' });
    });

    it('(#279) 가져오기 알림은 예약 때 만든 문구 그대로, 변경한 사람을 뺀다', async () => {
      const payload = { title: '민지님이 일정 3개를 가져왔어요', subtitle: '우리', body: null, url: '/g/10/calendar', expiration: 1 };
      push.listDuePending.mockResolvedValue([due({ id: 6, kind: 'CHANGE', payload, eventLogId: null, eventId: null, actorId: 1, changeAction: null })]);
      await dispatcher.expandDue(NOW);
      expect(push.findChangeLog).not.toHaveBeenCalled();
      expect(push.listRecipients).toHaveBeenCalledWith(10, 'CHANGE', 1, null, CREATED);
      expect(push.dispatchTx).toHaveBeenCalledWith(6, NOW, null, expect.any(Array));
    });

    it('탈퇴한 사람의 변경, 나간 사람의 합류는 이름 대신 "탈퇴한 멤버"', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 4, kind: 'JOIN', payload: null, actorId: 9 })]);
      push.findGroupRef.mockResolvedValue({ name: '우리 가족', publicCode: 'teamcode' });
      push.findPersonName.mockResolvedValue(null);
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenCalledWith(10, 'JOIN', 9, null, CREATED);
      expect(push.dispatchTx.mock.calls[0][2]).toMatchObject({ title: "탈퇴한 멤버님이 '우리 가족' 에 들어왔어요" });
    });

    it('(#297) 지난 일을 알리는 CHANGE, JOIN 은 예약을 만든 시각까지 들어온 팀원만, 앞날 알림 REMINDER, ANNIVERSARY 는 합류 시각을 보지 않는다 (D-180)', async () => {
      const anniversary = { title: '기념일', subtitle: '우리', body: null, url: '/g/10/calendar', expiration: 0 };
      push.listDuePending.mockResolvedValue([
        due({ id: 1, kind: 'ANNIVERSARY', eventId: null, payload: anniversary }),
        due({ id: 2, kind: 'JOIN', payload: null, actorId: 4, createdAt: new Date('2026-11-12T07:59:00.000Z') }),
      ]);
      push.findGroupRef.mockResolvedValue({ name: '우리', publicCode: 'teamcode' });
      push.findPersonName.mockResolvedValue('민지');
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenNthCalledWith(1, 10, 'ANNIVERSARY', null, null, null);
      expect(push.listRecipients).toHaveBeenNthCalledWith(2, 10, 'JOIN', 4, null, new Date('2026-11-12T07:59:00.000Z'));
    });

    it('(#305) 생일 알림은 생일인 사람(actorId)을 빼고, 펼칠 때 아직 그 팀에 그 생일이 보일 때만 보낸다 (D-232)', async () => {
      const birthday = { title: '민지 생일', subtitle: '우리', body: '오늘은 민지 생일이에요', url: '/anniversaries?team=teamcode', expiration: 0 };
      const row = (id: number, dedupeKey: string) => due({ id, kind: 'ANNIVERSARY', eventId: null, actorId: 7, dedupeKey, payload: birthday });
      push.listDuePending.mockResolvedValue([row(1, 'B:7:10:2026-11-12'), row(2, 'B:7:10:2026-11-19:D7'), row(3, 'B:7:10:2026-11-12'), row(4, 'B:7:10:2027-02-28')]);
      push.findShownBirthday
        .mockResolvedValueOnce('11-12') // 그대로
        .mockResolvedValueOnce('11-12') // 일주일 전 예약인데 생일을 바꿨다
        .mockResolvedValueOnce(null) // 나갔거나 이 팀에 안 보이게 했다
        .mockResolvedValueOnce('02-29'); // 평년 2월 28일
      push.listRecipients.mockResolvedValue([{ userId: 2, token: 'a', platform: 'IOS' }]);
      const stats = await dispatcher.expandDue(NOW);
      expect(push.findShownBirthday).toHaveBeenCalledWith(10, 7);
      expect(push.markSkipped).toHaveBeenCalledWith([2]);
      expect(push.markSkipped).toHaveBeenCalledWith([3]);
      expect(push.listRecipients).toHaveBeenCalledTimes(2);
      expect(push.listRecipients).toHaveBeenCalledWith(10, 'ANNIVERSARY', 7, null, null);
      expect(stats.dispatched).toBe(2);
    });

    it('팀이 없거나 로그가 없으면 SKIPPED', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 5, kind: 'CHANGE', payload: null, eventLogId: 1, actorId: 1, changeAction: 'CREATED' })]);
      push.findGroupRef.mockResolvedValue({ name: '우리', publicCode: 'teamcode' });
      push.findPersonName.mockResolvedValue('민지');
      push.findChangeLog.mockResolvedValue(null);
      await dispatcher.expandDue(NOW);
      expect(push.markSkipped).toHaveBeenLastCalledWith([5]);
      expect(push.dispatchTx).not.toHaveBeenCalled();
    });

    it('두 번 펼치기를 시도해도 dispatchTx 가 false 면 세지 않는다', async () => {
      push.listDuePending.mockResolvedValue([due()]);
      push.dispatchTx.mockResolvedValue(false);
      expect(await dispatcher.expandDue(NOW)).toMatchObject({ dispatched: 0 });
    });
  });

  describe('(#277) 주간 알림 펼치기 (5-9, D-203, D-204)', () => {
    const H = 60 * MIN;
    const weeklyDue = (overrides: Partial<DueNotification> = {}) =>
      due({ kind: 'WEEKLY', dedupeKey: 'W:10:2026-11-16', eventId: null, payload: null, ...overrides });
    const SUMMARY = { ...PAYLOAD, title: '이번 주 일정 2개', variant: 'SUMMARY' as const };
    const recipient = { userId: 1, token: 'ExponentPushToken[a]', platform: 'IOS' as const };

    it('WEEKLY 만 늦음 허용 3시간: 2시간 59분은 펼치고 3시간 1분은 SKIPPED', async () => {
      build.mockResolvedValue({ variant: 'SUMMARY', payload: SUMMARY });
      push.listRecipients.mockResolvedValue([recipient]);
      push.listDuePending.mockResolvedValue([
        weeklyDue({ id: 1, scheduledAt: new Date(NOW.getTime() - 3 * H - MIN) }),
        weeklyDue({ id: 2, scheduledAt: new Date(NOW.getTime() - 3 * H + MIN) }),
      ]);
      const stats = await dispatcher.expandDue(NOW);
      expect(push.markSkipped).toHaveBeenCalledWith([1]);
      expect(push.dispatchTx).toHaveBeenCalledWith(2, NOW, SUMMARY, [recipient]);
      expect(stats).toMatchObject({ dispatched: 1, skipped: 1, deliveries: 1, cancelled: 0 });
      expect(build).toHaveBeenCalledWith(10, '2026-11-16', NOW);
    });

    it('SUMMARY 는 notifyWeekly, NUDGE 는 notifyWeeklyNudge 로 받는 사람을 고른다. joinedAt 조건 없음', async () => {
      push.listRecipients.mockResolvedValue([recipient]);
      push.listDuePending.mockResolvedValue([weeklyDue()]);
      build.mockResolvedValue({ variant: 'SUMMARY', payload: SUMMARY });
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenLastCalledWith(10, 'WEEKLY', null, null, null, 'notifyWeekly');
      build.mockResolvedValue({ variant: 'NUDGE', payload: { ...SUMMARY, variant: 'NUDGE' } });
      await dispatcher.expandDue(NOW);
      expect(push.listRecipients).toHaveBeenLastCalledWith(10, 'WEEKLY', null, null, null, 'notifyWeeklyNudge');
    });

    it('보낼 것이 없거나(판정 null) 받는 사람이 0명이면 CANCELLED', async () => {
      push.listDuePending.mockResolvedValue([weeklyDue({ id: 1 })]);
      build.mockResolvedValue(null);
      expect(await dispatcher.expandDue(NOW)).toMatchObject({ cancelled: 1, dispatched: 0 });
      build.mockResolvedValue({ variant: 'NUDGE', payload: SUMMARY });
      push.listRecipients.mockResolvedValue([]);
      expect(await dispatcher.expandDue(NOW)).toMatchObject({ cancelled: 1, dispatched: 0 });
      expect(push.dispatchTx).not.toHaveBeenCalled();
      expect(push.markCancelled).toHaveBeenCalledWith([1]);
    });

    it('키에서 월요일을 못 읽으면 CANCELLED (방어)', async () => {
      push.listDuePending.mockResolvedValue([weeklyDue({ dedupeKey: 'W:bad' })]);
      expect(await dispatcher.expandDue(NOW)).toMatchObject({ cancelled: 1 });
      expect(build).not.toHaveBeenCalled();
    });

    it('다시 보내기도 3시간 안이면 QUEUED (WEEKLY)', async () => {
      push.claimQueued.mockResolvedValue([
        claimed(1, { notification: { id: 1, kind: 'WEEKLY', scheduledAt: new Date(NOW.getTime() - H), payload: SUMMARY } }),
      ]);
      expo.send.mockResolvedValue({ type: 'retry', reason: '429' } satisfies ExpoSendResult);
      const stats = await dispatcher.sendQueued(NOW);
      expect(push.requeue).toHaveBeenCalledWith([1]);
      expect(stats.requeued).toBe(1);
    });
  });

  describe('(#189) 약속 투표 펼치기', () => {
    const r = [{ userId: 2, token: 'b', platform: 'IOS' as const }];
    const poll = (over = {}) => ({ status: 'OPEN' as const, allMembers: false, creatorId: 1, participantIds: [1, 2], ...over });
    beforeEach(() => push.listPollRecipients.mockResolvedValue(r));

    it('열림: 대상 중 연 사람 제외. 진행 중일 때만, 투표가 없으면 SKIPPED', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 1, kind: 'POLL', dedupeKey: 'PO:5', actorId: 1, eventId: null }), due({ id: 2, kind: 'POLL', dedupeKey: 'PO:6', actorId: 1, eventId: null })]);
      push.findPollTargets.mockImplementation(async (id) => (id === 5 ? poll() : null));
      const stats = await dispatcher.expandDue(NOW);
      expect(push.listPollRecipients).toHaveBeenCalledWith(10, [1, 2], 1, null);
      expect(push.dispatchTx).toHaveBeenCalledWith(1, NOW, null, r);
      expect(push.markSkipped).toHaveBeenLastCalledWith([2]);
      expect(stats).toMatchObject({ dispatched: 1, skipped: 1 });
    });

    it('정함: 정한 사람 제외, 그때까지 들어온 팀원("모두"면 null)', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 3, kind: 'POLL', dedupeKey: 'PC:5', actorId: 2, eventId: null })]);
      push.findPollTargets.mockResolvedValue(poll({ status: 'CLOSED', allMembers: true, participantIds: [] }));
      await dispatcher.expandDue(NOW);
      expect(push.listPollRecipients).toHaveBeenCalledWith(10, null, 2, CREATED);
    });

    it('마감: 연 사람 한 명. 이미 정했거나 연 사람이 탈퇴했으면 SKIPPED', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 4, kind: 'POLL', dedupeKey: 'PD:5', eventId: null })]);
      push.findPollTargets.mockResolvedValueOnce(poll());
      await dispatcher.expandDue(NOW);
      expect(push.listPollRecipients).toHaveBeenCalledWith(10, [1], null, null);
      push.findPollTargets.mockResolvedValueOnce(poll({ status: 'CLOSED' }));
      await dispatcher.expandDue(NOW);
      push.findPollTargets.mockResolvedValueOnce(poll({ creatorId: null }));
      await dispatcher.expandDue(NOW);
      expect(push.markSkipped.mock.calls.filter(([ids]) => ids.length === 1 && ids[0] === 4)).toHaveLength(2);
      expect(push.dispatchTx).toHaveBeenCalledTimes(1);
    });

    it('키 모양이 틀리면 SKIPPED', async () => {
      push.listDuePending.mockResolvedValue([due({ id: 5, kind: 'POLL', dedupeKey: 'PX:1', eventId: null })]);
      await dispatcher.expandDue(NOW);
      expect(push.findPollTargets).not.toHaveBeenCalled();
      expect(push.markSkipped).toHaveBeenLastCalledWith([5]);
    });
  });

  describe('발송 결과 (5-6 표)', () => {
    const run = async (rows: ClaimedDelivery[], result: ExpoSendResult) => {
      push.claimQueued.mockResolvedValue(rows);
      expo.send.mockResolvedValue(result);
      return dispatcher.sendQueued(NOW);
    };

    it('100개씩 나눠 보낸다', async () => {
      const rows = Array.from({ length: 150 }, (_, i) => claimed(i + 1));
      push.claimQueued.mockResolvedValue(rows);
      expo.send.mockImplementation(async (messages: unknown[]) => ({ type: 'tickets', tickets: messages.map((_, i) => ({ status: 'ok', id: `t${i}` })) }));
      const stats = await dispatcher.sendQueued(NOW);
      expect(expo.send.mock.calls.map((call) => call[0].length)).toEqual([100, 50]);
      expect(stats.sent).toBe(150);
    });

    it('티켓 ok → SENT + ticketId', async () => {
      await run([claimed(1)], { type: 'tickets', tickets: [{ status: 'ok', id: 'abc' }] });
      expect(push.markSent).toHaveBeenCalledWith([{ id: 1, ticketId: 'abc' }], NOW);
    });

    it('DeviceNotRegistered → FAILED + 기기 삭제', async () => {
      await run([claimed(1)], { type: 'tickets', tickets: [{ status: 'error', code: 'DeviceNotRegistered' }] });
      expect(push.markFailed).toHaveBeenCalledWith([1], 'DeviceNotRegistered');
      expect(push.deleteDevicesByTokens).toHaveBeenCalledWith(['ExponentPushToken[t1]']);
    });

    it('MessageRateExceeded → QUEUED 로 되돌림 (다음 틱)', async () => {
      const stats = await run([claimed(1)], { type: 'tickets', tickets: [{ status: 'error', code: 'MessageRateExceeded' }] });
      expect(push.requeue).toHaveBeenCalledWith([1]);
      expect(stats.requeued).toBe(1);
    });

    it('그 밖 티켓 오류 → FAILED 와 코드 (자격 증명 오류도)', async () => {
      const stats = await run([claimed(1), claimed(2)], {
        type: 'tickets',
        tickets: [
          { status: 'error', code: 'MessageTooBig' },
          { status: 'error', code: 'InvalidCredentials' },
        ],
      });
      expect(push.markFailed).toHaveBeenCalledWith([1], 'MessageTooBig');
      expect(push.markFailed).toHaveBeenCalledWith([2], 'InvalidCredentials');
      expect(stats.failed).toEqual({ MessageTooBig: 1, InvalidCredentials: 1 });
    });

    it('429, 5xx, 전송 전 연결 실패 → 묶음을 QUEUED 로', async () => {
      await run([claimed(1), claimed(2)], { type: 'retry', reason: 'HTTP_503' });
      expect(push.requeue).toHaveBeenCalledWith([1, 2]);
    });

    it('되돌릴 것 중 3번째 시도이거나 예약이 10분 넘게 지났으면 FAILED EXPIRED', async () => {
      const old = { id: 1, kind: 'REMINDER' as const, scheduledAt: new Date(NOW.getTime() - 11 * MIN), payload: PAYLOAD };
      await run([claimed(1, { attempts: 3 }), claimed(2, { notification: old }), claimed(3)], { type: 'retry', reason: 'CONNECTION' });
      expect(push.markFailed).toHaveBeenCalledWith([1, 2], 'EXPIRED');
      expect(push.requeue).toHaveBeenCalledWith([3]);
    });

    it('타임아웃, 응답 해석 실패 → FAILED TIMEOUT (다시 보내지 않음, D-89)', async () => {
      await run([claimed(1)], { type: 'unknown', reason: 'TIMEOUT' });
      expect(push.markFailed).toHaveBeenCalledWith([1], 'TIMEOUT');
      expect(push.requeue).not.toHaveBeenCalledWith([1]);
    });

    it('요청 자체 거절(4xx) → FAILED HTTP 코드', async () => {
      await run([claimed(1)], { type: 'rejected', code: 'HTTP_401' });
      expect(push.markFailed).toHaveBeenCalledWith([1], 'HTTP_401');
    });

    it('IOS 는 subtitle, ANDROID 는 제목 앞 팀 이름', async () => {
      await run([claimed(1), claimed(2, { platform: 'ANDROID' })], { type: 'tickets', tickets: [{ status: 'ok', id: 'a' }, { status: 'ok', id: 'b' }] });
      const [ios, android] = expo.send.mock.calls[0][0];
      expect(ios).toMatchObject({ subtitle: '우리', title: '저녁 약속', data: { kind: 'REMINDER', nid: 1, url: '/g/10/calendar' } });
      expect(android).toMatchObject({ title: '[우리] 저녁 약속' });
    });
  });

  describe('영수증 (5-7)', () => {
    it('ok, 오류 코드, 응답에 없는 id 는 missing. DeviceNotRegistered 는 기기 삭제', async () => {
      push.listReceiptCandidates.mockResolvedValue([
        { id: 1, ticketId: 'a', token: 'ta' },
        { id: 2, ticketId: 'b', token: 'tb' },
        { id: 3, ticketId: 'c', token: 'tc' },
      ]);
      expo.getReceipts.mockResolvedValue(new Map([['a', 'ok'], ['b', 'DeviceNotRegistered']]));
      expect(await dispatcher.checkReceipts(NOW)).toBe(3);
      expect(push.saveReceipts).toHaveBeenCalledWith([1], 'ok', NOW);
      expect(push.saveReceipts).toHaveBeenCalledWith([2], 'DeviceNotRegistered', NOW);
      expect(push.saveReceipts).toHaveBeenCalledWith([3], 'missing', NOW);
      expect(push.deleteDevicesByTokens).toHaveBeenCalledWith(['tb']);
    });

    it('요청이 실패하면 아무것도 기록하지 않는다 (다음 틱에 다시)', async () => {
      push.listReceiptCandidates.mockResolvedValue([{ id: 1, ticketId: 'a', token: 'ta' }]);
      expo.getReceipts.mockResolvedValue(null);
      expect(await dispatcher.checkReceipts(NOW)).toBe(0);
      expect(push.saveReceipts).not.toHaveBeenCalled();
    });
  });
});
