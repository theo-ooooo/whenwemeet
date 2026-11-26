// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kstToIso } from "../date";
import type { CalendarSettings, CalendarSnapshot, CalendarSource, CalendarStatus } from "../device-calendar";
import {
  CALENDAR_DEBOUNCE_MS,
  CALENDAR_REFRESH_MS,
  CALENDAR_SETTINGS_DELAY_MS,
  calendarRefreshDue,
  createCalendarSyncer,
  newSyncMemory,
  type SyncMemory,
} from "../device-calendar-sync";
import type { Event, GroupSummary } from "../types";

const NOW = Date.parse(kstToIso("2026-11-26", "12:00"));
const g = {
  id: 1,
  type: "TEAM",
  name: "우리",
  publicCode: "team1xxx",
  memberCount: 2,
  me: { color: "#5B6CF4", displayName: "나" },
  unreadNewsCount: 0,
} as GroupSummary;
const member = { userId: 1, displayName: "민지", color: "#5B6CF4", profileImageUrl: null };
const event = (id: number, title = `일정${id}`) =>
  ({
    id,
    groupId: 1,
    publicCode: `c${id}`,
    title,
    startsAt: kstToIso("2026-11-27", "10:00"),
    endsAt: kstToIso("2026-11-27", "11:00"),
    allDay: false,
    creator: member,
    repeat: null,
    occurrence: null,
    participants: { all: true, members: [member] },
  }) as unknown as Event;

const okStatus = (over: Partial<CalendarStatus> = {}): CalendarStatus => ({
  id: "x",
  permission: "granted",
  canAskAgain: true,
  enabled: true,
  lastSyncedAt: new Date(NOW).toISOString(),
  count: 1,
  failed: false,
  ...over,
});

function setup(opts: { enabled?: boolean; events?: Event[] } = {}) {
  const settings: CalendarSettings = { userId: 1, enabled: opts.enabled ?? true, teams: null };
  let events = opts.events ?? [event(1)];
  const load = vi.fn(async () => ({
    settings,
    source: settings.enabled ? ({ groups: [g], events: new Map([[1, events]]) } as CalendarSource) : null,
  }));
  const send = vi.fn<(s: CalendarSnapshot) => Promise<CalendarStatus | null>>(async () => okStatus());
  const saveSettings = vi.fn();
  const memory: SyncMemory = newSyncMemory();
  let now = NOW;
  const syncer = createCalendarSyncer({ load, send, saveSettings, origin: "https://whenwemeet.day", memory, now: () => now });
  return {
    syncer,
    load,
    send,
    saveSettings,
    memory,
    setEvents: (e: Event[]) => {
      events = e;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("(#549) calendarRefreshDue", () => {
  it("처음, 10분 뒤, KST 날이 바뀌면", () => {
    expect(calendarRefreshDue(null, NOW)).toBe(true);
    expect(calendarRefreshDue(NOW, NOW + CALENDAR_REFRESH_MS - 1)).toBe(false);
    expect(calendarRefreshDue(NOW, NOW + CALENDAR_REFRESH_MS)).toBe(true);
    const lateNight = Date.parse(kstToIso("2026-11-26", "23:58"));
    expect(calendarRefreshDue(lateNight, lateNight + 3 * 60_000)).toBe(true);
  });
});

describe("(#549) createCalendarSyncer", () => {
  it("첫 화면: 3초 뒤 한 번 보낸다", async () => {
    const t = setup();
    t.syncer.start();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS - 1);
    expect(t.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0][0].events.map((e) => e.uid)).toEqual(["e1@whenwemeet.day"]);
  });

  it("연속 변경은 3초 모아 한 번", async () => {
    const t = setup();
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(1000);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(1000);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).toHaveBeenCalledTimes(1);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("내용이 같으면 다시 보내지 않고, 바뀌면 보낸다", async () => {
    const t = setup();
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).toHaveBeenCalledTimes(2);
    expect(t.send).toHaveBeenCalledTimes(1);
    t.setEvents([event(1, "바뀐 제목")]);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("지난번 셸이 실패했다고 답했으면 같은 내용도 다시 보낸다", async () => {
    const t = setup();
    t.send.mockResolvedValueOnce(okStatus({ failed: true }));
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("응답이 없었으면(시간 초과) 다음에 같은 내용도 다시 보낸다", async () => {
    const t = setup();
    t.send.mockResolvedValueOnce(null);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("설정을 바꾸면 같은 내용이어도 곧바로 보낸다", async () => {
    const t = setup();
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    t.syncer.settingsChanged();
    await vi.advanceTimersByTimeAsync(CALENDAR_SETTINGS_DELAY_MS);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("꺼져 있으면 일정을 만들지도 보내지도 않는다", async () => {
    const t = setup({ enabled: false });
    t.syncer.start();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).toHaveBeenCalledTimes(1);
    expect(t.send).not.toHaveBeenCalled();
  });

  it("셸이 꺼져 있다고 답하면 이 기기 설정을 끈다", async () => {
    const t = setup();
    t.send.mockResolvedValueOnce(okStatus({ enabled: false }));
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.saveSettings).toHaveBeenCalledWith({ userId: 1, enabled: false, teams: null });
  });

  it("앞으로 올 때: 10분 안이면 건너뛰고 지나면 다시", async () => {
    const t = setup();
    t.syncer.start();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    t.advance(60_000);
    t.syncer.visible();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).toHaveBeenCalledTimes(1);
    t.advance(CALENDAR_REFRESH_MS);
    t.syncer.visible();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).toHaveBeenCalledTimes(2);
  });

  it("불러오기 실패는 조용히 넘어가고 다음 변경에서 다시", async () => {
    const t = setup();
    t.load.mockRejectedValueOnce(new Error("network"));
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.memory.pendingDirty).toBe(true);
    t.syncer.dirty();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("dispose 하면 예약한 맞추기를 하지 않는다. 다음 마운트는 남은 변경을 바로 이어 간다", async () => {
    const t = setup();
    t.syncer.dirty();
    t.syncer.dispose();
    await vi.advanceTimersByTimeAsync(CALENDAR_DEBOUNCE_MS);
    expect(t.load).not.toHaveBeenCalled();
    expect(t.memory.pendingDirty).toBe(true);
  });
});
