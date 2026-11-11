import { Injectable } from '@nestjs/common';
import { DAY_MS, dayToDate } from '../events/recurrence.js';
import { anniversaryItemsOn } from './anniversary-items.js';
import { anniversaryPayload } from './push-copy.js';
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

/**
 * 그날 항목이 있는 기념일마다 1건, 첫 항목(우선순위)으로 문구 (D-92).
 * 그날 09:00 뒤에 등록, 수정한 기념일은 보내지 않는다
 */
export function planAnniversaries(rows: AnniversaryPlanRow[], day: string): PlannedNotification[] {
  const at = anniversaryNotifyAt(day);
  const planned: PlannedNotification[] = [];
  for (const row of rows) {
    if (row.updatedAt.getTime() > at.getTime()) continue;
    const [first] = anniversaryItemsOn(row, day);
    if (!first) continue;
    planned.push({
      kind: 'ANNIVERSARY',
      dedupeKey: `A:${row.id}:${day}`,
      groupId: row.groupId,
      scheduledAt: at,
      anniversaryId: row.id,
      payload: anniversaryPayload({ groupId: row.groupId, groupName: row.groupName, name: row.name, label: first.label, date: day }),
    });
  }
  return planned;
}

/** 기념일 당일 예약 계산 (설계 5-5) */
@Injectable()
export class AnniversaryPlanner {
  constructor(private readonly push: PushRepository) {}

  async plan(lo: Date, hi: Date): Promise<PlannedNotification[]> {
    const day = anniversaryDayInWindow(lo, hi);
    if (!day) return [];
    return planAnniversaries(await this.push.listAnniversaries(), day);
  }
}
