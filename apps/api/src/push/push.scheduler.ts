import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { reportError } from '../monitoring/sentry.js';
import { kstDate, KST_OFFSET_MS, DAY_MS } from '../events/recurrence.js';
import { AnniversaryPlanner } from './anniversary-planner.js';
import { PollPlanner } from './poll-planner.js';
import { CATCH_UP_MS, type ExpandStats, PushDispatcher, type SendStats } from './push-dispatcher.js';
import { PushRepository } from './push.repository.js';
import { ReminderPlanner } from './reminder-planner.js';
import { WeeklyPlanner } from './weekly-planner.js';

/** 틱 간격 (D-87) */
export const TICK_MS = 30_000;
/** 임대 길이 */
export const LEASE_MS = 60_000;
/** 종료 때 진행 중 틱을 기다리는 상한 */
const SHUTDOWN_WAIT_MS = 10_000;
/** 발송 기록 보존 (D-99) */
export const RETENTION_MS = 30 * DAY_MS;
/** 하루 청소를 시작하는 KST 시각 */
const DAILY_HOUR_KST = 4;

/** 이번 틱의 창 (lo, hi]. 아래 끝은 cursor 와 now - 10분 중 늦은 쪽 (설계 5-1, D-88) */
export function planningWindow(cursor: Date | null, now: Date): { lo: Date; hi: Date } {
  const floor = now.getTime() - CATCH_UP_MS;
  return { lo: new Date(Math.max(cursor?.getTime() ?? floor, floor)), hi: now };
}

/** KST 04:00 이후이고 오늘 아직 안 했으면 청소할 날짜, 아니면 null */
export function dailyDue(now: Date, doneOn: string | null): string | null {
  const today = kstDate(now);
  const hourKst = Math.floor((((now.getTime() + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS / (60 * 60 * 1000));
  return hourKst >= DAILY_HOUR_KST && doneOn !== today ? today : null;
}

export interface TickResult {
  /** 임대를 못 얻었거나 앞 틱이 아직 돌면 false */
  ran: boolean;
  planned?: number;
  /** (#277) 이번 틱에 만든 주간 알림 예약 수 */
  weekly?: number;
  /** (#189) 이번 틱에 예약한 투표 마감 알림 수 */
  polls?: number;
  expand?: ExpandStats;
  send?: SendStats;
  receipts?: number;
  cleaned?: number | null;
}

/**
 * 푸시 예약 틱 (설계 5-1, D-87). `PUSH_ENABLED=1` 일 때만 30초 인터벌을 돈다.
 * 임대 행 하나로 여러 프로세스 중 하나만 돌고, 중복은 DB 유일 키가 막는다 (D-89).
 * 테스트는 인터벌 없이 `tick(now)` 에 시각을 넘겨 시계를 제어한다
 */
@Injectable()
export class PushScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Push');
  /** 이 프로세스의 임대 id (기동 때 랜덤) */
  readonly holder: string = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<TickResult> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly push: PushRepository,
    private readonly reminders: ReminderPlanner,
    private readonly anniversaries: AnniversaryPlanner,
    private readonly weeklyPlanner: WeeklyPlanner,
    private readonly dispatcher: PushDispatcher,
    private readonly pollPlanner: PollPlanner,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('PUSH_ENABLED') === '1';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.push.ensureLease();
    this.timer = setInterval(() => void this.runSafely(), TICK_MS);
    this.timer.unref();
    this.logger.log(`push.scheduler 시작 holder=${this.holder.slice(0, 8)}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // 진행 중 틱을 기다린다(최대 10초). 임대는 그대로 두고 만료되게
    if (this.running) await Promise.race([this.running.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }

  /** 합류처럼 바로 보내야 할 때 틱을 한 번 깨운다 (D-91). 꺼져 있으면 아무것도 하지 않는다 */
  kick(): void {
    if (this.enabled) void this.runSafely();
  }

  /** 앞 틱이 아직 돌면 건너뛴다 */
  tick(now: Date = new Date()): Promise<TickResult> {
    if (this.running) return Promise.resolve({ ran: false });
    this.running = this.runTick(now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runSafely(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`push.tick 실패 ${(error as Error)?.message ?? error}`);
      reportError(error, 'push.tick');
    }
  }

  private async runTick(now: Date): Promise<TickResult> {
    const lease = await this.push.acquireLease(this.holder, now, new Date(now.getTime() + LEASE_MS));
    if (!lease) {
      this.logger.debug('push.tick 임대 없음');
      return { ran: false };
    }

    const { lo, hi } = planningWindow(lease.cursor, now);
    let planned = 0;
    if (lo.getTime() < hi.getTime()) {
      const rows = [...(await this.reminders.plan(lo, hi, now)), ...(await this.anniversaries.plan(lo, hi))];
      planned = await this.push.createNotifications(rows);
      await this.push.setCursor(this.holder, hi);
    }
    // (#277) 창이 아니라 "이번 주 처리 여부" 로 판단한다 (월요일 09:00 ~ 12:00 KST, D-203)
    const weekly = await this.weeklyPlanner.plan(now);
    // (#189) 마감이 지난 투표 (창이 아니라 표시 열로 한 번만, D-241)
    const polls = await this.pollPlanner.plan(now);

    const expand = await this.dispatcher.expandDue(now);
    const send = await this.dispatcher.sendQueued(now);
    const receipts = await this.dispatcher.checkReceipts(now);

    let cleaned: number | null = null;
    const day = dailyDue(now, lease.dailyDoneOn);
    if (day) {
      cleaned = await this.push.deleteNotificationsCreatedBefore(new Date(now.getTime() - RETENTION_MS));
      await this.push.setDailyDone(this.holder, day);
    }

    const result: TickResult = { ran: true, planned, weekly, polls, expand, send, receipts, cleaned };
    const busy = planned + weekly + polls + expand.dispatched + expand.cancelled + expand.skipped + send.sent + Object.keys(send.failed).length + send.requeued + receipts > 0;
    const line = `push.tick ${JSON.stringify({ planned, weekly, polls, ...expand, sent: send.sent, failed: send.failed, requeued: send.requeued, receipts, cleaned })}`;
    if (busy) this.logger.log(line);
    else this.logger.debug(line);
    return result;
  }
}
