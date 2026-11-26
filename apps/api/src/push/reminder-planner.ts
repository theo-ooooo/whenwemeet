import { Injectable } from '@nestjs/common';
import {
  addDays,
  expand,
  kstDate,
  type SeriesRule,
} from '../events/recurrence.js';
import { reminderPayload } from './push-copy.js';
import type { PlannedNotification } from './push-notifications.repository.js';
import {
  type OnceReminderRow,
  PushPlanningRepository,
  type ReminderSeriesRow,
} from './push-planning.repository.js';
import { remindAt, type EventReminder } from './remind-at.js';

const HOUR_MS = 60 * 60 * 1000;
/** 알림 시각은 회차 시작의 -24시간 ~ +9시간 사이라 회차 시작이 [lo - 9시간, hi + 24시간] 에 있어야 한다 (설계 5-3) */
export const SERIES_LEAD_MS = 9 * HOUR_MS;
export const SERIES_LAG_MS = 24 * HOUR_MS;
/** 회차만 알림을 고른 예외를 찾는 회차 날짜 여유 (설계 5-3) */
const EXCEPTION_DATE_MARGIN_DAYS = 32;

/** 일정 알림 중복 방지 키 (D-89). 일정, 회차, 알림 시각(epoch 초) */
export function reminderDedupeKey(
  eventId: number,
  occurrence: string | null,
  at: Date,
): string {
  return `R:${eventId}:${occurrence ?? '-'}:${Math.floor(at.getTime() / 1000)}`;
}

const inWindow = (at: Date, lo: Date, hi: Date) =>
  at.getTime() > lo.getTime() && at.getTime() <= hi.getTime();

/** 한 번짜리: 창 (lo, hi] 안이고 알림 시각 >= reminderSetAt 인 것만 (D-86) */
export function planOnceReminders(
  rows: OnceReminderRow[],
  lo: Date,
  hi: Date,
  now: Date,
): PlannedNotification[] {
  const today = kstDate(now);
  return rows
    .filter(
      (row) =>
        inWindow(row.remindAt, lo, hi) &&
        row.remindAt.getTime() >= row.reminderSetAt.getTime(),
    )
    .map((row) => ({
      kind: 'REMINDER',
      dedupeKey: reminderDedupeKey(row.id, null, row.remindAt),
      groupId: row.groupId,
      scheduledAt: row.remindAt,
      eventId: row.id,
      occurrence: null,
      payload: reminderPayload(
        {
          groupId: row.groupId,
          groupName: row.groupName,
          groupCode: row.groupCode,
          eventId: row.id,
          eventCode: row.publicCode,
          occurrence: null,
          title: row.title,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          allDay: row.allDay,
          reminder: row.reminder,
        },
        today,
      ),
    }));
}

/**
 * 반복 원본 하나: 회차마다 `예외.reminder ?? 원본.reminder` 로 알림 시각을 구해 (lo, hi] 안이고
 * 기준(max(원본.reminderSetAt, 예외.reminderSetAt)) 이후인 것만 (설계 5-3, D-85, D-86).
 * 종일 여부와 안 맞는 값(회차 예외로 종일을 바꾼 경우)은 건너뛴다
 */
export function planSeriesReminders(
  series: ReminderSeriesRow,
  lo: Date,
  hi: Date,
  now: Date,
): PlannedNotification[] {
  const today = kstDate(now);
  const rule: SeriesRule = {
    startsAt: series.startsAt,
    endsAt: series.endsAt,
    allDay: series.allDay,
    repeat: series.repeat,
    repeatUntil: series.repeatUntil,
    repeatAnchor: series.repeatAnchor,
  };
  const byDate = new Map(
    series.exceptions.map((exception) => [exception.occurrence, exception]),
  );
  // expand 는 [from, to) 겹침이라 회차 시작 = hi + 24시간 도 들도록 1ms 늘린다
  const occurrences = expand(
    rule,
    series.exceptions,
    new Date(lo.getTime() - SERIES_LEAD_MS),
    new Date(hi.getTime() + SERIES_LAG_MS + 1),
  );
  const planned: PlannedNotification[] = [];
  for (const occurrence of occurrences) {
    const exception = byDate.get(occurrence.occurrence);
    const reminder: EventReminder = exception?.reminder ?? series.reminder;
    if (reminder === 'NONE') continue;
    const at = remindAt(occurrence.startsAt, occurrence.allDay, reminder);
    if (!at || !inWindow(at, lo, hi)) continue;
    const base = Math.max(
      series.reminderSetAt.getTime(),
      exception?.reminderSetAt?.getTime() ?? 0,
    );
    if (at.getTime() < base) continue;
    planned.push({
      kind: 'REMINDER',
      dedupeKey: reminderDedupeKey(series.id, occurrence.occurrence, at),
      groupId: series.groupId,
      scheduledAt: at,
      eventId: series.id,
      occurrence: occurrence.occurrence,
      payload: reminderPayload(
        {
          groupId: series.groupId,
          groupName: series.groupName,
          groupCode: series.groupCode,
          eventId: series.id,
          eventCode: series.publicCode,
          occurrence: occurrence.occurrence,
          title: occurrence.title ?? series.title,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          allDay: occurrence.allDay,
          reminder,
        },
        today,
      ),
    });
  }
  return planned;
}

/** 일정 알림 예약 계산 (설계 5-3). DB 는 PushPlanningRepository, 계산은 위 순수 함수 */
@Injectable()
export class ReminderPlanner {
  constructor(private readonly push: PushPlanningRepository) {}

  async plan(lo: Date, hi: Date, now: Date): Promise<PlannedNotification[]> {
    const from = new Date(lo.getTime() - SERIES_LEAD_MS);
    const to = new Date(hi.getTime() + SERIES_LAG_MS + 1);
    const [once, series] = await Promise.all([
      this.push.listOnceReminders(lo, hi),
      this.push.listReminderSeries(
        from,
        to,
        addDays(kstDate(lo), -EXCEPTION_DATE_MARGIN_DAYS),
        addDays(kstDate(hi), EXCEPTION_DATE_MARGIN_DAYS),
      ),
    ]);
    return [
      ...planOnceReminders(once, lo, hi, now),
      ...series.flatMap((row) => planSeriesReminders(row, lo, hi, now)),
    ];
  }
}
