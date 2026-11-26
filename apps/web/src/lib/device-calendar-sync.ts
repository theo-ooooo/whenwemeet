// (#549) 휴대폰 캘린더 맞추기 시점 (docs/설계/앱.md 4.9). React 를 import 하지 않는다 (단위 테스트 대상, useDeviceCalendarSync 가 잇는다).
// 보내는 때: 첫 화면, 일정/팀 변경 성공 뒤, 앱이 다시 앞으로 올 때(마지막 뒤 10분, 날이 바뀌면 바로), 설정을 바꿀 때.
// 여러 번 와도 3초 모아 한 번. 만든 스냅샷이 지난번 보낸 것과 같고 그때 실패하지 않았으면 보내지 않는다.
import {
  buildCalendarSnapshot,
  fitCalendarSnapshot,
  snapshotKey,
  type CalendarSettings,
  type CalendarSnapshot,
  type CalendarSource,
  type CalendarStatus,
} from "./device-calendar";
import { dateKeyOf } from "./date";

/** 연속 변경을 모으는 시간 */
export const CALENDAR_DEBOUNCE_MS = 3_000;
/** 설정을 바꾼 뒤 (사람이 기다리고 있다) */
export const CALENDAR_SETTINGS_DELAY_MS = 300;
/** 화면이 다시 앞으로 올 때 이보다 최근에 맞췄으면 건너뛴다 (팀마다 요청 4개라 매번 하지 않는다) */
export const CALENDAR_REFRESH_MS = 10 * 60 * 1000;

/** 다시 맞출 때인가: 한 적 없음, 10분 지남, KST 날이 바뀜(창이 하루 밀림) */
export function calendarRefreshDue(lastRunAt: number | null, now: number): boolean {
  if (lastRunAt === null) return true;
  return now - lastRunAt >= CALENDAR_REFRESH_MS || dateKeyOf(lastRunAt) !== dateKeyOf(now);
}

/** 화면(AppShell)이 다시 마운트돼도 이어지는 기억 */
export type SyncMemory = {
  /** 지난번 셸이 받은 스냅샷 내용 키 */
  lastKey: string | null;
  lastFailed: boolean;
  lastRunAt: number | null;
  /** 변경 뒤 보내기 전에 화면이 사라졌다 */
  pendingDirty: boolean;
};

export const newSyncMemory = (): SyncMemory => ({ lastKey: null, lastFailed: false, lastRunAt: null, pendingDirty: false });

export type SyncerDeps = {
  load: (now: number, signal: AbortSignal) => Promise<{ settings: CalendarSettings; source: CalendarSource | null }>;
  send: (snapshot: CalendarSnapshot) => Promise<CalendarStatus | null>;
  /** 셸이 꺼져 있다고 답하면 설정의 enabled 를 내린다 (다음부터 요청하지 않게) */
  saveSettings: (s: CalendarSettings) => void;
  origin: string;
  memory: SyncMemory;
  now?: () => number;
};

export type Syncer = {
  /** 변경 뒤: 3초 모아서 */
  dirty(): void;
  /** 설정을 바꿈: 같은 내용이어도 보낸다 (켰다 끈 뒤 기기 캘린더가 비어 있다) */
  settingsChanged(): void;
  /** 화면이 다시 보임 */
  visible(): void;
  /** 첫 화면 */
  start(): void;
  dispose(): void;
};

export function createCalendarSyncer(deps: SyncerDeps): Syncer {
  const now = deps.now ?? Date.now;
  const mem = deps.memory;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctrl: AbortController | null = null;
  let force = false;

  async function run() {
    timer = null;
    const forced = force;
    force = false;
    ctrl?.abort();
    const c = new AbortController();
    ctrl = c;
    try {
      const t = now();
      const { settings, source } = await deps.load(t, c.signal);
      if (c.signal.aborted) return;
      mem.lastRunAt = t;
      mem.pendingDirty = false;
      if (!source) return;
      const snapshot = fitCalendarSnapshot(buildCalendarSnapshot(source, t, deps.origin));
      const key = snapshotKey(snapshot);
      if (!forced && key === mem.lastKey && !mem.lastFailed) return;
      const status = await deps.send(snapshot);
      if (!status) return;
      mem.lastKey = key;
      mem.lastFailed = status.failed;
      if (!status.enabled) deps.saveSettings({ ...settings, enabled: false });
    } catch {
      // 네트워크, 권한 오류: 기기 캘린더는 이전 그대로 (다음 기회에 다시)
    }
  }

  function schedule(delay: number) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  }

  return {
    dirty() {
      mem.pendingDirty = true;
      schedule(CALENDAR_DEBOUNCE_MS);
    },
    settingsChanged() {
      force = true;
      schedule(CALENDAR_SETTINGS_DELAY_MS);
    },
    visible() {
      if (calendarRefreshDue(mem.lastRunAt, now())) schedule(CALENDAR_DEBOUNCE_MS);
    },
    start() {
      // 화면 데이터 요청과 겹치지 않게 3초 뒤
      if (mem.pendingDirty || calendarRefreshDue(mem.lastRunAt, now())) schedule(CALENDAR_DEBOUNCE_MS);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      ctrl?.abort();
    },
  };
}
