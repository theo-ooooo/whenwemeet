import { Injectable } from '@nestjs/common';
import type { AnniversaryReminderFlags } from '../anniversaries/anniversary-reminders.js';
import { addDays, DAY_MS, dayToDate } from '../events/recurrence.js';
import { type AnniversaryItem, anniversaryItemsOn, type AnniversaryLike } from './anniversary-items.js';
import { anniversaryPayload, type ReminderOffsetDays } from './push-copy.js';
import { type AnniversaryPlanRow, type PlannedNotification, PushRepository } from './push.repository.js';

/**
 * 창 (lo, hi] 안에 KST 09:00 (= 날짜 D 의 00:00 UTC) 이 있으면 그 날짜 D. 창은 10분 이하라 많아야 하루 (설계 5-5)
 */
export function anniversaryDayInWindow(lo: Date, hi: Date): string | null {
  const day = Math.floor(hi.getTime() / DAY_MS);
  return day * DAY_MS > lo.getTime() ? dayToDate(day) : null;
}

/** 그날 KST 09:00 순간 */
export const anniversaryNotifyAt = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** (#269) 켜진 알림 시점과 앞당김 일수. 당일, 하루 전, 일주일 전 순 */
const OFFSETS: readonly { flag: keyof AnniversaryReminderFlags; days: ReminderOffsetDays; key: string }[] = [
  { flag: 'remindDayOf', days: 0, key: '' },
  { flag: 'remindDayBefore', days: 1, key: ':D1' },
  { flag: 'remindWeekBefore', days: 7, key: ':D7' },
];

/**
 * 알림 시점별 그날 항목. 일주일 전은 100일 단위(DAYS) 를 뺀다 (#269, D-145). 우선순위 순
 */
export function itemsForOffset(a: AnniversaryLike, target: string, offsetDays: ReminderOffsetDays): AnniversaryItem[] {
  const items = anniversaryItemsOn(a, target);
  return offsetDays === 7 ? items.filter((item) => item.type !== 'DAYS') : items;
}

/**
 * 보내는 날 `day` 09:00 의 기념일 알림 (D-92, #269 D-144 ~ D-147). 기념일마다 켜진 시점마다 그날 = day + 앞당김 일수 의
 * 항목이 있으면 1건, 첫 항목(우선순위)으로 문구. 보내는 날 09:00 뒤에 등록, 수정한 기념일은 보내지 않는다.
 * 당일 키는 #269 전과 같고 하루 전, 일주일 전은 `:D1`, `:D7` 을 붙인다
 */
export function planAnniversaries(rows: AnniversaryPlanRow[], day: string): PlannedNotification[] {
  const at = anniversaryNotifyAt(day);
  const planned: PlannedNotification[] = [];
  for (const row of rows) {
    if (row.updatedAt.getTime() > at.getTime()) continue;
    for (const offset of OFFSETS) {
      if (!row[offset.flag]) continue;
      const target = addDays(day, offset.days);
      const [first] = itemsForOffset(row, target, offset.days);
      if (!first) continue;
      planned.push({
        kind: 'ANNIVERSARY',
        dedupeKey: `A:${row.id}:${target}${offset.key}`,
        groupId: row.groupId,
        scheduledAt: at,
        anniversaryId: row.id,
        payload: anniversaryPayload({
          groupId: row.groupId,
          groupName: row.groupName,
          groupCode: row.groupCode,
          name: row.name,
          label: first.label,
          date: target,
          offsetDays: offset.days,
        }),
      });
    }
  }
  return planned;
}

/** 기념일 예약 계산 (설계 5-5. #269 부터 당일, 하루 전, 일주일 전) */
@Injectable()
export class AnniversaryPlanner {
  constructor(private readonly push: PushRepository) {}

  async plan(lo: Date, hi: Date): Promise<PlannedNotification[]> {
    const day = anniversaryDayInWindow(lo, hi);
    if (!day) return [];
    return planAnniversaries(await this.push.listAnniversaries(), day);
  }
}
