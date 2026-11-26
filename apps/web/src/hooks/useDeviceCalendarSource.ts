"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { kstToIso } from "@/lib/date";
import { calendarWindow, pickTeams, rangeChunks, readCalendarSettings, type CalendarSettings, type CalendarSource } from "@/lib/device-calendar";
import type { Event, GroupSummary, Me } from "@/lib/types";
import { qs } from "./_error";

/**
 * (#549) 휴대폰 캘린더 재료 (앱.md 4.9): 나(설정 주인 확인), 내 팀, 켠 팀마다 창(과거 30일 ~ 미래 180일) 일정.
 * 일정 목록 API 는 한 번에 62일까지라 팀마다 4번 나눠 부른다 (GET /groups/:id/events?from&to, 반복은 API 가 펼친 회차).
 * 꺼져 있으면 일정은 부르지 않고 settings 만. 하나라도 실패하면 throw (부분 데이터로 기기 일정을 지우지 않는다)
 */
export function useDeviceCalendarSource() {
  return useCallback(async (now: number, signal?: AbortSignal): Promise<{ settings: CalendarSettings; source: CalendarSource | null }> => {
    const [me, groups] = await Promise.all([api<Me>("/me", { signal }), api<GroupSummary[]>("/groups", { signal })]);
    const settings = readCalendarSettings(me.id);
    if (!settings.enabled) return { settings, source: null };
    const picked = pickTeams(groups, settings.teams);
    const { from, to } = calendarWindow(now);
    const chunks = rangeChunks(from, to);
    const rows = await Promise.all(
      picked.map(async (g) => {
        const parts = await Promise.all(
          chunks.map((c) => api<Event[]>(`/groups/${g.id}/events${qs({ from: kstToIso(c.from), to: kstToIso(c.to) })}`, { signal })),
        );
        return [g.id, parts.flat()] as const;
      }),
    );
    return { settings, source: { groups: picked, events: new Map(rows) } };
  }, []);
}
