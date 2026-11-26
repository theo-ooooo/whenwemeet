// (#549) 휴대폰 캘린더 켜기, 끄기, 상태, 맞추기 (앱.md 4.9, D-294).
// 기기 캘린더와 파일 저장은 넘겨받는다(native.ts 가 expo-calendar, expo-file-system 으로 만든다). RN 을 import 하지 않는다 (jest 대상).
// 우리 캘린더("언제볼까") 하나에만 쓴다. 다른 캘린더의 일정은 읽지도 고치지도 않는다.
import type { CalendarPermission, CalendarStatusReply } from "../bridge/reply";
import { type DeviceEventDetails, type DeviceOs, type EventMapping, planSync, runPool, toDeviceEvent } from "./plan";
import { CALENDAR_SPAN_DAYS, type CalendarSnapshot } from "./snapshot";

/** 기기에 만드는 캘린더 이름. 사용자 캘린더 목록에 이 이름으로 보인다 */
export const CALENDAR_TITLE = "언제볼까";
/** 브랜드 코랄 (디자인토큰 --pri) */
export const CALENDAR_COLOR = "#E0533D";
/** 기기 일정 쓰기 동시 실행 수 */
export const SYNC_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 기기 캘린더 접근 (native.ts 가 expo-calendar/legacy 로 구현) */
export type CalendarApi = {
  os: DeviceOs;
  getPermission(): Promise<{ status: string; canAskAgain: boolean }>;
  requestPermission(): Promise<{ status: string; canAskAgain: boolean }>;
  /** 기기 캘린더 중 우리가 만든 것으로 보이는 것 (이름이 CALENDAR_TITLE 이고 고칠 수 있음) */
  listOurCalendars(): Promise<{ id: string }[]>;
  createCalendar(): Promise<string>;
  deleteCalendar(id: string): Promise<void>;
  /** 그 캘린더 안 일정 id (범위 안) */
  listEventIds(calendarId: string, from: Date, to: Date): Promise<string[]>;
  createEvent(calendarId: string, details: DeviceEventDetails): Promise<string>;
  updateEvent(id: string, details: DeviceEventDetails): Promise<void>;
  deleteEvent(id: string): Promise<void>;
};

/** 셸에 남기는 상태 (앱 문서 폴더 JSON 하나). 일정 내용은 두지 않고 UID ↔ 기기 id 와 해시만 */
export type CalendarState = {
  v: 1;
  enabled: boolean;
  calendarId: string | null;
  events: EventMapping;
  /** 마지막으로 끝까지 맞춘 시각 (ISO) */
  lastSyncedAt: string | null;
  /** 마지막 맞추기가 실패했거나 일부를 못 썼는지 */
  failed: boolean;
};

export const EMPTY_STATE: CalendarState = { v: 1, enabled: false, calendarId: null, events: {}, lastSyncedAt: null, failed: false };

/** 파일 하나 읽기/쓰기/지우기. 없으면 read 는 null */
export type StateFile = { read(): string | null; write(text: string): void; remove(): void };

/** 저장된 상태. 없거나 깨졌으면 빈 상태 */
export function loadState(file: StateFile): CalendarState {
  let raw: string | null;
  try {
    raw = file.read();
  } catch {
    return EMPTY_STATE;
  }
  if (!raw) return EMPTY_STATE;
  try {
    const o = JSON.parse(raw) as Partial<CalendarState>;
    if (!o || o.v !== 1 || typeof o.enabled !== "boolean") return EMPTY_STATE;
    const events: EventMapping = {};
    if (o.events && typeof o.events === "object") {
      for (const [uid, m] of Object.entries(o.events)) {
        if (m && typeof m.id === "string" && typeof m.h === "string") events[uid] = { id: m.id, h: m.h };
      }
    }
    return {
      v: 1,
      enabled: o.enabled,
      calendarId: typeof o.calendarId === "string" ? o.calendarId : null,
      events,
      lastSyncedAt: typeof o.lastSyncedAt === "string" ? o.lastSyncedAt : null,
      failed: o.failed === true,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function saveState(file: StateFile, s: CalendarState): void {
  file.write(JSON.stringify(s));
}

/** OS 권한 → 브리지 값. 묻지 않았거나 다시 물을 수 있으면 undetermined (푸시 toPushPermission 과 같은 규칙) */
export function toCalendarPermission(p: { status: string; canAskAgain: boolean }): CalendarPermission {
  if (p.status === "granted") return "granted";
  if (p.status === "denied" && !p.canAskAgain) return "denied";
  return "undetermined";
}

export class DeviceCalendarSync {
  /** 한 번에 하나씩 (켜기, 끄기, 맞추기가 겹치지 않게) */
  private queue: Promise<unknown> = Promise.resolve();
  /** 맞추기를 기다리는 가장 새 스냅샷 (그 사이 온 것은 버린다) */
  private pending: CalendarSnapshot | null = null;
  private pendingRun: Promise<CalendarState> | null = null;

  constructor(
    private readonly api: CalendarApi,
    private readonly file: StateFile,
    private readonly now: () => number = Date.now,
  ) {}

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private state(): CalendarState {
    return loadState(this.file);
  }

  private save(s: CalendarState): void {
    try {
      saveState(this.file, s);
    } catch (e) {
      console.warn("[calendar] 상태 저장 실패", e);
    }
  }

  /** 웹에 돌려줄 상태 */
  async status(id: string): Promise<CalendarStatusReply> {
    const p = await this.api.getPermission();
    const s = this.state();
    return {
      v: 1,
      type: "calendarStatus",
      id,
      permission: toCalendarPermission(p),
      canAskAgain: p.canAskAgain,
      // 권한을 기기 설정에서 끈 경우는 켜진 것으로 보이지 않게
      enabled: s.enabled && p.status === "granted",
      lastSyncedAt: s.lastSyncedAt,
      count: Object.keys(s.events).length,
      failed: s.failed,
    };
  }

  /** 우리 캘린더를 찾거나 만든다. 저장된 id 가 없어졌으면 같은 이름의 남은 캘린더(재설치 등)를 지우고 새로 만든다 */
  private async ensureCalendar(s: CalendarState): Promise<CalendarState> {
    const ours = await this.api.listOurCalendars();
    if (s.calendarId && ours.some((c) => c.id === s.calendarId)) return s;
    // 매핑을 모르는 남은 캘린더는 일정이 겹치므로 지우고 새로 시작한다 (이름이 언제볼까인 캘린더만)
    for (const c of ours) await this.api.deleteCalendar(c.id).catch((e: unknown) => console.warn("[calendar] 남은 캘린더 지우기 실패", e));
    const calendarId = await this.api.createCalendar();
    return { ...s, calendarId, events: {}, lastSyncedAt: null, failed: false };
  }

  /** 켜기: 권한을 묻고(전체 접근), 허용이면 캘린더를 준비한다. 일정은 웹이 이어서 보내는 calendarSync 로 */
  enable(id: string): Promise<CalendarStatusReply> {
    return this.serial(async () => {
      const before = await this.api.getPermission();
      const p = before.status === "granted" || !before.canAskAgain ? before : await this.api.requestPermission();
      if (p.status === "granted") {
        try {
          const s = await this.ensureCalendar(this.state());
          this.save({ ...s, enabled: true });
        } catch (e) {
          console.warn("[calendar] 캘린더 만들기 실패", e);
          this.save({ ...this.state(), failed: true });
        }
      }
      return this.status(id);
    });
  }

  /** 끄기: 우리 캘린더(와 같은 이름의 남은 것)를 통째로 지우고 매핑을 비운다. 권한이 없으면 지울 수 없어 상태만 비운다 */
  disable(id?: string): Promise<CalendarStatusReply | null> {
    this.pending = null;
    return this.serial(async () => {
      const s = this.state();
      const p = await this.api.getPermission();
      if (p.status === "granted") {
        const ids = new Set<string>();
        if (s.calendarId) ids.add(s.calendarId);
        try {
          for (const c of await this.api.listOurCalendars()) ids.add(c.id);
        } catch (e) {
          console.warn("[calendar] 캘린더 목록 실패", e);
        }
        for (const cid of ids) await this.api.deleteCalendar(cid).catch((e: unknown) => console.warn("[calendar] 지우기 실패", e));
      }
      try {
        this.file.remove();
      } catch {
        // 이미 없음
      }
      return id ? this.status(id) : null;
    });
  }

  /** (로그아웃, 탈퇴) 켠 적이 있을 때만 끄기와 같이 지운다 */
  async clear(): Promise<void> {
    const s = this.state();
    if (!s.enabled && !s.calendarId) return;
    await this.disable();
  }

  /**
   * 맞추기. 켜져 있지 않으면 아무것도 하지 않는다 (웹이 끈 뒤 늦게 보낸 스냅샷).
   * 돌고 있는 사이 여러 번 오면 가장 새 것 하나만 이어서 돈다
   */
  sync(snapshot: CalendarSnapshot): Promise<CalendarState> {
    this.pending = snapshot;
    if (this.pendingRun) return this.pendingRun;
    const run = this.serial(async () => {
      this.pendingRun = null;
      const snap = this.pending;
      this.pending = null;
      return snap ? this.syncNow(snap) : this.state();
    });
    this.pendingRun = run;
    return run;
  }

  private async syncNow(snapshot: CalendarSnapshot): Promise<CalendarState> {
    let s = this.state();
    if (!s.enabled) return s;
    const p = await this.api.getPermission();
    if (p.status !== "granted") {
      s = { ...s, failed: true };
      this.save(s);
      return s;
    }
    try {
      s = await this.ensureCalendar(s);
    } catch (e) {
      console.warn("[calendar] 캘린더 준비 실패", e);
      s = { ...s, failed: true };
      this.save(s);
      return s;
    }
    const calendarId = s.calendarId as string;

    // 우리 캘린더에 지금 있는 일정 id. 스냅샷 범위(생성 시각 ±400일)를 덮는다 (iOS 조회 상한 4년 안)
    const now = this.now();
    const span = (CALENDAR_SPAN_DAYS + 20) * DAY_MS;
    let present: Set<string>;
    try {
      present = new Set(await this.api.listEventIds(calendarId, new Date(now - span), new Date(now + span)));
    } catch (e) {
      console.warn("[calendar] 일정 목록 실패", e);
      s = { ...s, failed: true };
      this.save(s);
      return s;
    }

    const plan = planSync(snapshot.events, s.events, present);
    const next: EventMapping = { ...plan.keep };
    let failures = 0;
    const os = this.api.os;

    await runPool(plan.remove, SYNC_CONCURRENCY, async ({ uid, id }) => {
      try {
        await this.api.deleteEvent(id);
      } catch {
        failures += 1;
        // 다음에 다시 지운다
        next[uid] = s.events[uid];
      }
    });
    await runPool(plan.update, SYNC_CONCURRENCY, async ({ ev, h, id }) => {
      try {
        await this.api.updateEvent(id, toDeviceEvent(ev, os));
        next[ev.uid] = { id, h };
      } catch {
        failures += 1;
        // 옛 해시를 남겨 다음에 다시 고친다
        next[ev.uid] = s.events[ev.uid];
      }
    });
    await runPool(plan.create, SYNC_CONCURRENCY, async ({ ev, h }) => {
      try {
        const id = await this.api.createEvent(calendarId, toDeviceEvent(ev, os));
        next[ev.uid] = { id, h };
      } catch {
        failures += 1;
      }
    });

    s = {
      ...s,
      events: next,
      lastSyncedAt: failures === 0 ? new Date(this.now()).toISOString() : s.lastSyncedAt,
      failed: failures > 0,
    };
    if (failures > 0) console.warn("[calendar] 일부 일정을 쓰지 못함", failures);
    this.save(s);
    return s;
  }
}
