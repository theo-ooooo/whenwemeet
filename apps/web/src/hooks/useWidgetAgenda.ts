"use client";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { kstToIso } from "@/lib/date";
import type { Anniversary, Event, GroupSummary } from "@/lib/types";
import { WIDGET_MAX_GROUPS, widgetRange, type WidgetSource } from "@/lib/widget-snapshot";
import { qs } from "./_error";

/**
 * (#197) 홈 화면 위젯 재료: 내 팀 목록 + 팀마다 오늘~7일 일정, 기념일 (GET /groups, /groups/:id/events, /groups/:id/anniversaries).
 * 여러 팀을 한 번에 주는 API 가 없어 팀마다 부른다 (기획 정할 것 3: 팀 3개 이하가 대부분이라 웹 호출로 시작). 팀은 앞 10개까지.
 * 하나라도 실패하면 throw (부분 데이터로 위젯을 덮지 않는다)
 */
export function useWidgetAgenda() {
  return useCallback(async (now: number, signal?: AbortSignal): Promise<WidgetSource> => {
    const groups = await api<GroupSummary[]>("/groups", { signal });
    const range = widgetRange(now);
    const params = qs({ from: kstToIso(range.from), to: kstToIso(range.to) });
    const picked = groups.slice(0, WIDGET_MAX_GROUPS);
    const rows = await Promise.all(
      picked.map(async (g) => {
        const [events, anniversaries] = await Promise.all([
          api<Event[]>(`/groups/${g.id}/events${params}`, { signal }),
          api<Anniversary[]>(`/groups/${g.id}/anniversaries`, { signal }),
        ]);
        return { id: g.id, events, anniversaries };
      }),
    );
    return {
      groups: picked,
      events: new Map(rows.map((r) => [r.id, r.events])),
      anniversaries: new Map(rows.map((r) => [r.id, r.anniversaries])),
    };
  }, []);
}
