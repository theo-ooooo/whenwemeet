"use client";
// (#484) 달력 화면의 데이터: 이번 주, 기념일, 비는 시간, "지금", 다시 받기, 월 격자 레인. CalendarScreen 에서 옮김.
// 보는 달(주) 일정과 다가오는 일정은 날짜 상세 단계(useCalendarSteps)도 보므로 화면이 먼저 받아 넘긴다
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useGroupContext } from "@/components/AppShell";
import { useAnniversaryItems, useEvents, useFreeSlots } from "@/hooks";
import { occurrencesByDay } from "@/lib/anniversary";
import { groupByDay, isMultiDay, nearestAnniversary, upcomingEvents } from "@/lib/day-detail";
import { nextOccurrences } from "@/lib/day-view";
import { addDays, kstToIso, type DateKey } from "@/lib/date";
import { upcomingSlots } from "@/lib/free-time";
import { holidayOf } from "@/lib/holidays";
import { fitWeek, packWeek, phoneWeek, type PackedWeek } from "@/lib/month-lanes";
import type { Event } from "@/lib/types";
import { countEventsInRange, weekQueryOf } from "@/lib/week-summary";

// (#355) 폰 칸 이름 칩: 칸당 4줄 (screens/calendar/PhoneMonthChips.tsx)
const PHONE_LANES = 4;

const nowMs = () => Date.now();

/** 월 격자 한 주: 여러 날 일정 막대 레인 + 칸 높이별(칩 2줄 tall, 3줄 taller) 자리 */
export type MonthWeek = { packed: PackedWeek<Event>; fit2: ReturnType<typeof fitWeek<Event>>; fit3: ReturnType<typeof fitWeek<Event>> };

type Args = {
  groupId: number;
  group: ReturnType<typeof useGroupContext>["group"];
  wide: boolean;
  week: boolean;
  today: DateKey;
  /** 주 보기 7일 (일~토) */
  days: DateKey[];
  /** 월 격자 날짜 (5주 또는 6주) */
  grid: DateKey[];
  events: Event[] | null;
  upcomingData: Event[] | null;
  loadEvents: () => Promise<void>;
  loadUpcoming: () => Promise<void>;
  eventsChanged: () => void;
  restoredVersion: number;
  /** 떠 있는 날짜 상세의 날짜 (없으면 null) */
  surfaceDate: DateKey | null;
};

export function useCalendarData({
  groupId,
  group,
  wide,
  week,
  today,
  days,
  grid,
  events,
  upcomingData,
  loadEvents,
  loadUpcoming,
  eventsChanged,
  restoredVersion,
  surfaceDate,
}: Args) {
  // 넓은 화면 요약 카드 "이번 주 일정" (일요일 시작 KST 한 주, 달력 줄과 같다 #437, 보는 달과 상관없이)
  const weekQ = useEvents(groupId, weekQueryOf(today), { enabled: wide });
  const loadWeek = weekQ.refetch;
  // 기념일은 못 받아도 빈 목록으로 본다 (D-day 줄만 안내로 바뀜)
  const anniversariesQ = useAnniversaryItems(groupId);
  const { data: anniversaryData, error: anniversaryError } = anniversariesQ;
  const anniversaries = useMemo(() => anniversaryData ?? (anniversaryError ? [] : null), [anniversaryData, anniversaryError]);

  const memberCount = group?.members.length ?? 0;
  const members = useMemo(() => group?.members ?? [], [group]);

  // 오늘 모두 비는 시간 (첫 구간). 넓은 화면 요약 카드 (#378 B: 폰 일 상세는 하루 막대가 대신한다)
  const todayFreeQ = useFreeSlots(
    groupId,
    {
      from: kstToIso(today),
      to: kstToIso(addDays(today, 1)),
      dayStart: "09:00",
      dayEnd: "23:00",
      minMinutes: 60,
      includeAllDay: false,
    },
    { enabled: wide },
  );
  const todayFree = todayFreeQ.data ? (upcomingSlots(todayFreeQ.data.slots, 60)[0] ?? null) : undefined;

  // (#378 B) 날짜 상세(폰 일 상세, 넓은 화면 패널)의 비는 시간은 하루 막대(DayBar)가 그날 일정으로 그린다 (따로 받지 않는다)
  // 지금 (ms): 지난 일정 흐리게, 하루 막대와 목록의 "지금". 날짜 상세가 떠 있는 동안 1분마다
  const [now, setNow] = useState(nowMs);
  useEffect(() => {
    if (!surfaceDate) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [surfaceDate]);
  // (#192) 주 보기 "빈 시간" 겹쳐 보기 (Q2, 기본 꺼짐). 그 주 7일, 하루 전체, 30분 이상 (api.md 2.5 31일 한도 안)
  const [showFree, setShowFree] = useState(false);
  const weekFreeOn = week && showFree;
  const weekFreeQ = useFreeSlots(
    groupId,
    { from: kstToIso(days[0]), to: kstToIso(addDays(days[0], 7)), dayStart: "00:00", dayEnd: "24:00", minMinutes: 30, includeAllDay: false },
    { enabled: weekFreeOn },
  );
  const loadWeekFree = weekFreeQ.refetch;
  // 일정을 추가, 수정, 삭제한 뒤: 일정에서 나오는 값을 모두 다시 받는다 (월 그리드, 다가오는 일정, 이번 주, 비는 시간 QA3-M4)
  const loadTodayFree = todayFreeQ.refetch;
  const reload = useCallback(() => {
    void loadEvents();
    void loadUpcoming();
    if (wide) void loadWeek();
    if (wide) void loadTodayFree();
    // refetch 는 enabled 를 보지 않으므로 켜져 있을 때만
    if (weekFreeOn) void loadWeekFree();
    // 사이드바 "다가오는 일정" 도 다시 받게
    eventsChanged();
  }, [loadEvents, loadUpcoming, loadWeek, wide, loadTodayFree, weekFreeOn, loadWeekFree, eventsChanged]);

  // (#375) 지운 일정을 되돌리면(이 화면 또는 일정 화면의 토스트) 다시 받는다. 처음 한 번은 훅이 이미 받는다
  const lastRestored = useRef(restoredVersion);
  useEffect(() => {
    if (lastRestored.current === restoredVersion) return;
    lastRestored.current = restoredVersion;
    reload();
  }, [restoredVersion, reload]);

  // (#190) 참석 여부만 바뀌면 빈 시간은 그대로라(D-137) 일정 목록만 다시 받는다
  const reloadEvents = useCallback(() => {
    void loadEvents();
    void loadUpcoming();
    if (wide) void loadWeek();
    eventsChanged();
  }, [loadEvents, loadUpcoming, loadWeek, wide, eventsChanged]);

  const byDay = useMemo(() => groupByDay(events ?? []), [events]);
  // 주마다 여러 날 일정 막대 레인 (#202). 넓은 화면은 칸 높이별(칩 2줄 tall, 3줄 taller) 로 자리를 맞춰 둔다
  const weeks = useMemo(() => {
    const out: MonthWeek[] = [];
    for (let i = 0; i < grid.length; i += 7) {
      const packed = packWeek(grid.slice(i, i + 7), byDay, isMultiDay);
      out.push({ packed, fit2: fitWeek(packed, 2), fit3: fitWeek(packed, 3) });
    }
    return out;
  }, [grid, byDay]);
  const upcomingList = useMemo(() => (upcomingData ? upcomingEvents(upcomingData, nowMs(), 10) : null), [upcomingData]);

  // 기념일 항목 (#107): 보이는 그리드 날짜별
  const gridFrom = grid[0];
  const gridTo = grid[grid.length - 1];
  const annByDay = useMemo(() => occurrencesByDay(anniversaries, gridFrom, gridTo), [anniversaries, gridFrom, gridTo]);
  // (#355) 폰 칸 이름 칩: 주마다 칸당 4줄. 기념일, 공휴일 글자가 있는 칸은 0번 줄을 그 글자가 쓴다
  const phoneWeeks = useMemo(
    () =>
      weeks.map((w) =>
        phoneWeek(
          w.packed,
          PHONE_LANES,
          w.packed.days.map((d) => (annByDay.get(d)?.length ?? 0) > 0 || Boolean(holidayOf(d))),
        ),
      ),
    [weeks, annByDay],
  );
  // phone "기념일" 구역 카드: 기념일마다 다음 항목 하나 (#212)
  const annCards = useMemo(() => (anniversaries ? nextOccurrences(anniversaries, today, 10) : null), [anniversaries, today]);

  // 요약 카드 "오늘 기념일" / "다음 기념일" (이름 + N일 + D-n)
  const nearest = useMemo(() => nearestAnniversary(anniversaries, today), [anniversaries, today]);

  // 요약 카드 라벨: 혼자인 팀은 "비는 시간" (디자인규칙.md 2-2, #212)
  const freeLabel = memberCount <= 1 ? "비는 시간" : memberCount === 2 ? "오늘 둘 다 비는 시간" : "오늘 모두 비는 시간";
  const weekRange = weekQueryOf(today);
  // (#192) 주 보기에서는 보이는 주(일~토)를 센다 (격자와 같은 수). 이번 주가 아니면 라벨 "이 주 일정"
  const weekCount = week
    ? events
      ? countEventsInRange(events, kstToIso(days[0]), kstToIso(addDays(days[0], 7)))
      : null
    : weekQ.data
      ? countEventsInRange(weekQ.data, weekRange.from, weekRange.to)
      : null;
  const weekCardLabel = week && !days.includes(today) ? "이 주 일정" : "이번 주 일정";

  return {
    weekQ,
    loadWeek,
    anniversaries,
    memberCount,
    members,
    todayFreeQ,
    todayFree,
    now,
    showFree,
    setShowFree,
    weekFreeQ,
    reload,
    reloadEvents,
    byDay,
    weeks,
    upcomingList,
    annByDay,
    phoneWeeks,
    annCards,
    nearest,
    freeLabel,
    weekCount,
    weekCardLabel,
  };
}
