import type { OnceReminderRow, ReminderExceptionRow, ReminderSeriesRow } from './push.repository.js';
import { planOnceReminders, planSeriesReminders, reminderDedupeKey } from './reminder-planner.js';
import { dailyDue, planningWindow } from './push.scheduler.js';

const kst = (value: string) => new Date(`${value}+09:00`);
const MIN = 60 * 1000;

const once = (overrides: Partial<OnceReminderRow> = {}): OnceReminderRow => ({
  id: 5,
  groupId: 10,
  groupName: '우리',
  title: '저녁 약속',
  startsAt: kst('2026-11-12T18:00:00'),
  endsAt: kst('2026-11-12T20:00:00'),
  allDay: false,
  reminder: 'HOUR_1',
  remindAt: kst('2026-11-12T17:00:00'),
  reminderSetAt: kst('2026-11-10T12:00:00'),
  ...overrides,
});

describe('한 번짜리 일정 알림 (설계 5-3)', () => {
  const at = kst('2026-11-12T17:00:00');

  it('창 (lo, hi] 경계: lo 는 빼고 hi 는 넣는다', () => {
    expect(planOnceReminders([once()], new Date(at.getTime() - MIN), at, at)).toHaveLength(1);
    expect(planOnceReminders([once()], at, new Date(at.getTime() + MIN), at)).toHaveLength(0);
  });

  it('예약 행: 키 R:{id}:-:{epoch초}, 예약 시각 = 알림 시각, 문구', () => {
    const [row] = planOnceReminders([once()], new Date(at.getTime() - MIN), at, at);
    expect(row).toMatchObject({
      kind: 'REMINDER',
      dedupeKey: `R:5:-:${at.getTime() / 1000}`,
      scheduledAt: at,
      eventId: 5,
      occurrence: null,
      payload: { title: '저녁 약속', body: '1시간 뒤 오후 6:00', subtitle: '우리' },
    });
  });

  it('지난 시각으로 저장: 30분 뒤 일정에 1시간 전 → 알림 시각이 저장보다 앞이라 없음 (D-86)', () => {
    const saved = kst('2026-11-12T17:30:00');
    const row = once({ reminderSetAt: saved });
    expect(planOnceReminders([row], new Date(saved.getTime() - 10 * MIN), saved, saved)).toEqual([]);
  });

  it('18:00 일정을 17:30 에 19:00 으로 옮기면 새 알림 18:00 은 기준 뒤라 보낸다, 새 키', () => {
    const moved = once({ startsAt: kst('2026-11-12T19:00:00'), remindAt: kst('2026-11-12T18:00:00'), reminderSetAt: kst('2026-11-12T17:30:00') });
    const hi = kst('2026-11-12T18:00:00');
    const [row] = planOnceReminders([moved], new Date(hi.getTime() - MIN), hi, hi);
    expect(row.dedupeKey).not.toBe(reminderDedupeKey(5, null, kst('2026-11-12T17:00:00')));
    expect(row.payload.body).toBe('1시간 뒤 오후 7:00');
  });

  it('같은 창을 두 번 계산해도 같은 키 (D-89)', () => {
    const lo = new Date(at.getTime() - MIN);
    expect(planOnceReminders([once()], lo, at, at)[0].dedupeKey).toBe(planOnceReminders([once()], lo, at, at)[0].dedupeKey);
  });
});

/** 2026-11-11(수) 19:00~21:00 KST 매주, 1시간 전 */
const series = (overrides: Partial<ReminderSeriesRow> = {}): ReminderSeriesRow => ({
  id: 200,
  groupId: 10,
  groupName: '우리',
  title: '저녁',
  startsAt: kst('2026-11-11T19:00:00'),
  endsAt: kst('2026-11-11T21:00:00'),
  allDay: false,
  reminder: 'HOUR_1',
  reminderSetAt: kst('2026-11-01T00:00:00'),
  repeat: 'WEEKLY',
  repeatUntil: null,
  repeatAnchor: null,
  exceptions: [],
  ...overrides,
});

const exception = (overrides: Partial<ReminderExceptionRow>): ReminderExceptionRow => ({
  occurrence: '2026-11-18',
  cancelled: false,
  title: null,
  startsAt: null,
  endsAt: null,
  allDay: null,
  reminder: null,
  reminderSetAt: null,
  ...overrides,
});

/** 창 (at - 10분, at] 에서 계산 */
const planAt = (row: ReminderSeriesRow, at: Date) => planSeriesReminders(row, new Date(at.getTime() - 10 * MIN), at, at);

describe('반복 일정 알림 (설계 5-3)', () => {
  it('매주 회차마다 1건, 키에 회차 날짜', () => {
    const first = planAt(series(), kst('2026-11-11T18:00:00'));
    const second = planAt(series(), kst('2026-11-18T18:00:00'));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({ occurrence: '2026-11-11', dedupeKey: `R:200:2026-11-11:${kst('2026-11-11T18:00:00').getTime() / 1000}` });
    expect(second[0].payload.url).toBe('/g/10/calendar?date=2026-11-18&day=1&event=200&occurrence=2026-11-18');
    expect(planAt(series(), kst('2026-11-15T18:00:00'))).toEqual([]);
  });

  it('"이 일정만" 으로 옮긴 회차는 옮긴 시각, 원래 시각에는 없다', () => {
    const row = series({ exceptions: [exception({ startsAt: kst('2026-11-19T12:00:00'), endsAt: kst('2026-11-19T13:00:00'), title: '점심으로' })] });
    expect(planAt(row, kst('2026-11-18T18:00:00'))).toEqual([]);
    const [moved] = planAt(row, kst('2026-11-19T11:00:00'));
    expect(moved).toMatchObject({ occurrence: '2026-11-18', payload: { title: '점심으로', body: '1시간 뒤 오후 12:00' } });
  });

  it('취소 회차는 없다', () => {
    expect(planAt(series({ exceptions: [exception({ cancelled: true })] }), kst('2026-11-18T18:00:00'))).toEqual([]);
  });

  it('원본은 NONE 이지만 회차만 알림을 고른 경우', () => {
    const row = series({ reminder: 'NONE', exceptions: [exception({ reminder: 'MIN_10' })] });
    expect(planAt(row, kst('2026-11-11T18:00:00'))).toEqual([]);
    expect(planAt(row, kst('2026-11-18T18:50:00'))).toHaveLength(1);
  });

  it('회차 예외로 알림을 없앤 회차는 건너뛴다', () => {
    expect(planAt(series({ exceptions: [exception({ reminder: 'NONE' })] }), kst('2026-11-18T18:00:00'))).toEqual([]);
  });

  it('회차 예외로 종일 전환 시 맞지 않는 원본 값은 건너뛴다', () => {
    const row = series({ exceptions: [exception({ allDay: true, startsAt: kst('2026-11-18T00:00:00'), endsAt: kst('2026-11-19T00:00:00') })] });
    for (const at of [kst('2026-11-17T23:00:00'), kst('2026-11-18T18:00:00'), kst('2026-11-18T09:00:00')]) expect(planAt(row, at)).toEqual([]);
  });

  it('repeatUntil 뒤 회차는 없다', () => {
    expect(planAt(series({ repeatUntil: '2026-11-17' }), kst('2026-11-18T18:00:00'))).toEqual([]);
    expect(planAt(series({ repeatUntil: '2026-11-18' }), kst('2026-11-18T18:00:00'))).toHaveLength(1);
  });

  it('MONTHLY 31일 → 짧은 달은 말일', () => {
    const monthly = series({ repeat: 'MONTHLY', startsAt: kst('2026-10-31T09:00:00'), endsAt: kst('2026-10-31T10:00:00'), reminder: 'AT_START' });
    expect(planAt(monthly, kst('2026-11-30T09:00:00'))).toMatchObject([{ occurrence: '2026-11-30' }]);
    expect(planAt(monthly, kst('2026-12-31T09:00:00'))).toMatchObject([{ occurrence: '2026-12-31' }]);
  });

  it('1일 전 알림(시작 24시간 전)과 종일 당일 09시(시작 9시간 뒤)도 창 여유 안에서 찾는다', () => {
    expect(planAt(series({ reminder: 'DAY_1' }), kst('2026-11-17T19:00:00'))).toMatchObject([{ occurrence: '2026-11-18' }]);
    const allDay = series({ allDay: true, startsAt: kst('2026-11-11T00:00:00'), endsAt: kst('2026-11-12T00:00:00'), reminder: 'DAY_OF_0900' });
    expect(planAt(allDay, kst('2026-11-18T09:00:00'))).toMatchObject([{ occurrence: '2026-11-18', payload: { body: '오늘 종일' } }]);
    const before = series({ allDay: true, startsAt: kst('2026-11-11T00:00:00'), endsAt: kst('2026-11-12T00:00:00'), reminder: 'DAY_BEFORE_0900' });
    expect(planAt(before, kst('2026-11-17T09:00:00'))).toMatchObject([{ occurrence: '2026-11-18', payload: { body: '내일 종일' } }]);
  });

  it('기준 = max(원본, 예외 reminderSetAt). 회차를 지난 시각으로 옮긴 저장은 보내지 않는다', () => {
    const row = series({
      exceptions: [exception({ startsAt: kst('2026-11-18T18:30:00'), endsAt: kst('2026-11-18T20:00:00'), reminderSetAt: kst('2026-11-18T17:45:00') })],
    });
    expect(planAt(row, kst('2026-11-18T17:50:00'))).toEqual([]);
  });

  it('같은 창 두 번 → 같은 키', () => {
    const at = kst('2026-11-18T18:00:00');
    expect(planAt(series(), at)[0].dedupeKey).toBe(planAt(series(), at)[0].dedupeKey);
  });
});

describe('창과 따라잡기 (설계 5-1, D-88)', () => {
  const now = kst('2026-11-12T17:00:00');

  it('cursor 가 없거나 30분 전이면 아래 끝은 now - 10분', () => {
    expect(planningWindow(null, now)).toEqual({ lo: new Date(now.getTime() - 10 * MIN), hi: now });
    expect(planningWindow(new Date(now.getTime() - 30 * MIN), now).lo).toEqual(new Date(now.getTime() - 10 * MIN));
  });

  it('cursor 가 10분 안이면 cursor 부터', () => {
    expect(planningWindow(new Date(now.getTime() - 30_000), now).lo).toEqual(new Date(now.getTime() - 30_000));
  });

  it('청소는 KST 04:00 이후 하루 한 번', () => {
    expect(dailyDue(kst('2026-11-12T03:59:00'), null)).toBeNull();
    expect(dailyDue(kst('2026-11-12T04:00:00'), null)).toBe('2026-11-12');
    expect(dailyDue(kst('2026-11-12T23:00:00'), '2026-11-12')).toBeNull();
    expect(dailyDue(kst('2026-11-13T05:00:00'), '2026-11-12')).toBe('2026-11-13');
  });
});
