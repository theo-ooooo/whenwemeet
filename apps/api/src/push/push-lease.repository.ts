import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { dateToDb, dbToDate } from './push-db.js';

/** 임대 행 이름 (마이그레이션이 넣는다) */
export const PUSH_LEASE = 'push';
/** (#277) 주간 알림을 예약한 월요일을 적는 행 (D-203). 임대는 PUSH_LEASE 가 잡는다 */
export const WEEKLY_MARKER = 'weekly';

/** 임대를 얻었을 때 읽는 진행 위치 */
export interface LeaseState {
  cursor: Date | null;
  /** 'YYYY-MM-DD' (KST) */
  dailyDoneOn: string | null;
}

/** 푸시 예약 틱의 임대와 진행 위치 저장소 (#188, #485). (#277) 주간 알림 표시 행도 여기서 */
@Injectable()
export class PushLeaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- 임대 (설계 5-1, D-87) ----------

  /** 임대 행이 없으면 만든다 (마이그레이션이 넣지만 테스트 DB 정리 등에 대비) */
  async ensureLease(name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.createMany({ data: [{ name, leaseUntil: new Date(0) }], skipDuplicates: true });
  }

  /** 만료됐거나 내 것인 임대만 가져온다. 다른 프로세스가 가졌으면 null */
  async acquireLease(holder: string, now: Date, until: Date, name = PUSH_LEASE): Promise<LeaseState | null> {
    const { count } = await this.prisma.schedulerLease.updateMany({
      where: { name, OR: [{ leaseUntil: { lt: now } }, { holder }] },
      data: { holder, leaseUntil: until },
    });
    if (count !== 1) return null;
    const row = await this.prisma.schedulerLease.findUnique({ where: { name }, select: { cursor: true, dailyDoneOn: true } });
    if (!row) return null;
    return { cursor: row.cursor, dailyDoneOn: row.dailyDoneOn === null ? null : dbToDate(row.dailyDoneOn) };
  }

  async setCursor(holder: string, cursor: Date, name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.updateMany({ where: { name, holder }, data: { cursor } });
  }

  async setDailyDone(holder: string, date: string, name = PUSH_LEASE): Promise<void> {
    await this.prisma.schedulerLease.updateMany({ where: { name, holder }, data: { dailyDoneOn: dateToDb(date) } });
  }

  /** (#277) 주간 알림을 예약한 월요일 'YYYY-MM-DD'. 행이 없으면 null (D-203) */
  async getWeeklyDoneOn(): Promise<string | null> {
    const row = await this.prisma.schedulerLease.findUnique({ where: { name: WEEKLY_MARKER }, select: { dailyDoneOn: true } });
    return row?.dailyDoneOn ? dbToDate(row.dailyDoneOn) : null;
  }

  /** (#277) 'push' 임대를 가진 틱 안에서만 부른다. 행이 없으면 만든다 */
  async setWeeklyDoneOn(date: string): Promise<void> {
    await this.prisma.schedulerLease.upsert({
      where: { name: WEEKLY_MARKER },
      create: { name: WEEKLY_MARKER, leaseUntil: new Date(0), dailyDoneOn: dateToDb(date) },
      update: { dailyDoneOn: dateToDb(date) },
      select: { name: true },
    });
  }
}
