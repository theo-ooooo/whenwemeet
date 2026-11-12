"use client";
// 4 달력. 크기와 색은 최종-A-시안.html (D-57), 배치는 docs/설계/폴더블.md (D-58).
// phone(<600): 구역으로 쌓는다 (디자인규칙.md 2-1, 2-3, 5, #212). "11월" 제목줄(오늘 알약, ‹ ›) → 달력 카드 →
//   "다가오는 일정" 가로 카드 → "기념일" 가로 카드. 날짜를 누르면 일 상세(DayView: 주간 줄 + 그날 요약 + 그날 일정)가 달력 자리를 대신한다
// fold(600~1023), pc(≥1024): 사이드바(AppShell) 옆 본문. 제목줄 44("2026년 11월" 28/700, 오늘, ‹ ›, "일정 추가") →
//   요약 카드 3열(오늘 비는 시간, 오늘/다음 기념일, 이번 주 일정) → 남은 높이를 채우는 달력 (디자인규칙.md 2-2, 5, #212, D-69).
//   D-58 의 개요 칸(다가오는 일정, D-day, 이번 주 빈 시간)은 사이드바 묶음과 요약 카드로 옮겼다
// 날짜 칸을 누르면 어느 폭이든 그날 상세가 먼저 뜬다: phone 일 상세 화면, fold/pc 오른쪽 일 상세 패널(DayDock, #331).
//   패널은 본문 폭 760 이상이면 달력 옆 400 칸(달력이 그만큼 좁아진다), 그보다 좁으면 달력 위를 덮는 시트. 열린 채 다른 날을 누르면 내용만 바뀐다.
// phone 의 일정 상세, 빠른 추가는 일 상세 위 바텀 시트(DaySheet)로 뜨고, 닫으면 일 상세로 돌아간다.
// 그 안에서 "이 날 일정 추가" → 빠른 추가, 일정 → 일정 상세로 같은 자리에서 바뀐다. 바로 추가는 + 버튼만 맡는다.
// 주소: /calendar?date / ?month 는 replaceState(#81), 날짜 상세 단계는 pushState 로 ?day=1, &add=1, 일정 상세는 경로 /events/<코드> (5-5, #311 D-198).
// /events/<코드> 로 바로 들어오면(새로 고침, 알림, 공유) 그 페이지가 서버에서 일정을 찾아 initialEvent 로 넘기고 같은 이 화면을 그린다
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { DayDock } from "@/components/DayDock";
import { DayAddButton, DayFreeRow, DayPanel, type FreeHint } from "@/components/DayPanel";
import { DaySheet } from "@/components/DaySheet";
import { ScopeSheet } from "@/components/RecurrenceSheets";
import { DayView } from "@/components/DayView";
import { DotCluster, useWho } from "@/components/Participants";
import { IconChevronLeft, IconChevronRight, IconHeart, IconPlus } from "@/components/icons";
import { TogetherHint, togetherHintOf } from "@/components/TogetherHint";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, Skeleton } from "@/components/ui";
import { messageOf, useAnniversaries, useDeleteEvent, useEvents, useFreeSlots } from "@/hooks";
import {
  dateParam,
  dayStepUrl,
  type EventRouteTarget,
  monthParam,
  parseDayStep,
  parseRouteStep,
  stepDepth,
  withDayStep,
  withSelection,
  type StepTarget,
} from "@/lib/calendar-url";
import { ANNIVERSARIES_PATH, CALENDAR_PATH, FREE_PATH, newEventHref, routeInfo, UPCOMING_PATH } from "@/lib/routes";
import {
  occurrenceCellText,
  occurrencesByDay,
  occurrenceTitle,
  type Occurrence,
} from "@/lib/anniversary";
import { panelMove } from "@/lib/day-panel";
import { anniversariesOn, dayBadge, groupByDay, isMultiDay, nearestAnniversary, upcomingEvents } from "@/lib/day-detail";
import { nextOccurrences, shiftWeek } from "@/lib/day-view";
import {
  addDays,
  dateKeyOf,
  dowOf,
  formatDateKo,
  formatEventTime,
  kstToIso,
  monthGrid,
  parseKey,
  shiftMonth,
  timeOf,
  todayKey,
  WEEKDAYS,
  type DateKey,
} from "@/lib/date";
import { cellDensity } from "@/lib/calendar-cell";
import { fitWeek, packWeek, phoneDayLanes, type BarPiece, type DayFit, type PackedWeek } from "@/lib/month-lanes";
import { upcomingSlots } from "@/lib/free-time";
import { holidayOf } from "@/lib/holidays";
import { eventKey } from "@/lib/recurrence";
import { barColors, chipColor, participantColors, splitBackground, withWho } from "@/lib/participants";
import type { Event, EventScope } from "@/lib/types";
import { useLayout } from "@/lib/useLayout";
import { TodoHomeSection } from "@/components/TodoHomeSection";
import { useMonthSwipe } from "@/lib/useMonthSwipe";
import { countEventsInRange, weekQueryOf } from "@/lib/week-summary";
import { haptic } from "@/lib/app-bridge";

type Props = {
  /** `/events/<코드>` 페이지가 넘기는 일정 자리. `/calendar` 는 없음 */
  initialEvent?: EventRouteTarget | null;
};

const newEventLink = (start: string, end: string) => newEventHref({ start, end });

const nowMs = () => Date.now();

/** 일정 상세를 여는 데 필요한 것. 반복 회차는 회차 날짜까지 (#187). 주소에는 공개 코드가 실린다 (#311) */
type EventRef = { publicCode: string; occurrence: DateKey | null };
const eventStep = (date: DateKey, ev: EventRef): StepTarget => ({ step: "event", date, code: ev.publicCode, occurrence: ev.occurrence ?? null });
const routeKey = (code: string, occurrence: DateKey | null) => `${code}:${occurrence ?? ""}`;

/** 주소(경로 + search)를 기록에 쓴다. state 는 null (#57: Next 가 내부 state 를 붙이고 usePathname, useSearchParams 를 맞춘다) */
function writeUrl(url: string, mode: "push" | "replace") {
  const full = `${url}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", full);
  else window.history.replaceState(null, "", full);
}

/** 지금 일정 상세 경로(`/events/<코드>`) 위에 있는가. 그러면 달력 쿼리(date, month)는 주소에 없다 */
const onEventRoute = () => routeInfo(window.location.pathname).eventDetail;

export function CalendarScreen({ initialEvent = null }: Props) {
  const toast = useToast();
  const layout = useLayout();
  const wide = layout !== "phone";
  const { groupId, group, groups, eventsChanged } = useGroupContext();
  const together = togetherHintOf(group, groups);
  const who = useWho();
  const today = todayKey();
  // 처음 값은 서버 props 가 아니라 지금 주소에서 읽는다 (#81). 뒤로가기는 Next 가 캐시해 둔 처음 렌더(쿼리 없는 주소)를
  // 다시 쓰므로 서버가 넘긴 날짜는 오늘로 돌아가지만, useSearchParams 는 replaceState 로 바꿔 둔 주소를 돌려준다
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [selected, setSelected] = useState(() => initialEvent?.date ?? dateParam(searchParams.get("date")) ?? today);
  const [{ y, m }, setMonth] = useState(() => monthParam(searchParams.get("month")) ?? parseKey(selected));
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* ---------- 날짜 상세 단계 (주소가 원본, 5-5) ---------- */

  // 일정 상세 주소(/events/<코드>)에는 날짜가 없다. 연 순간 기억한 날짜(뒤로가기, 앞으로가기 복원) → 서버가 넘긴 자리 → 받아 둔 목록의 그 회차 순
  // (상태로 둔 Map. 연 순간 기록하고 렌더에서 읽기만 한다. 바뀐다고 다시 그릴 필요는 없다)
  const [routeDates] = useState(() => new Map<string, DateKey>());

  // 6주 그리드. 마지막 주가 통째로 다음 달이면 5주만 그린다 (목업처럼)
  const grid42 = useMemo(() => monthGrid(y, m), [y, m]);
  const grid = useMemo(() => (parseKey(grid42[35]).m !== m ? grid42.slice(0, 35) : grid42), [grid42, m]);

  // 일 목록은 세 상태 중 하나: 로딩(events=null, 오류 없음) / 오류(eventsError) / 준비됨(events 배열, 비어 있으면 빈 상태)
  // 늦게 온 응답이 최신 상태를 덮지 않는 것, 오류에도 직전 값을 유지하는 것은 훅이 보장한다 (#18)
  const eventsQ = useEvents(groupId, { from: kstToIso(grid42[0]), to: kstToIso(addDays(grid42[41], 1)) });
  const events = eventsQ.data;
  const eventsError = eventsQ.error ? messageOf(eventsQ.error, "일정을 불러오지 못했어요") : null;
  const loadEvents = eventsQ.refetch;

  // 다가오는 일정 (개요). 보는 달과 상관없이 오늘부터 한 달
  const upcomingQ = useEvents(groupId, { from: kstToIso(today), to: kstToIso(addDays(today, 31)) });
  const loadUpcoming = upcomingQ.refetch;
  const upcomingData = upcomingQ.data;

  const rawStep = useMemo(() => {
    const dateOf = (code: string, occurrence: DateKey | null): DateKey | null => {
      const remembered = routeDates.get(routeKey(code, occurrence));
      if (remembered) return remembered;
      if (initialEvent && initialEvent.code === code) return initialEvent.date;
      const found = [...(events ?? []), ...(upcomingData ?? [])].find((e) => e.publicCode === code && (e.occurrence ?? null) === occurrence);
      return found ? dateKeyOf(found.startsAt) : null;
    };
    const step = parseRouteStep(pathname, searchParams, today, dateOf);
    // 반복 일정을 `?occurrence=` 없이 열면(공유, 알림) 서버가 알아낸 첫 회차
    if (step.open && step.step === "event" && step.occurrence === null && initialEvent?.code === step.code && initialEvent.occurrence) {
      return { ...step, occurrence: initialEvent.occurrence };
    }
    return step;
  }, [pathname, searchParams, today, initialEvent, events, upcomingData, routeDates]);
  // 새로고침, 공유 주소로 add=1 에 들어오면 빈 폼을 띄우지 않고 날짜 상세로 본다 (5-5). 주소는 아래 효과가 고친다.
  // Next 가 history 를 붙잡기 전의 replaceState 는 useSearchParams 에 안 잡히므로 화면은 이 값으로 정한다
  const [ignoreAdd, setIgnoreAdd] = useState(() => rawStep.open && rawStep.step === "add");
  const urlStep = useMemo<typeof rawStep>(
    () => (ignoreAdd && rawStep.open && rawStep.step === "add" ? { open: true, date: rawStep.date, step: "day" } : rawStep),
    [ignoreAdd, rawStep],
  );
  // 우리가 pushState 로 쌓지 않은 칸 수 (새로고침, 공유 주소로 day=1 에 바로 들어온 경우). 닫을 때 그만큼은 replaceState 로 뗀다
  // add=1 은 새로고침 시 무시하므로(아래 효과가 뗀다) 날짜 상세 한 칸으로 센다
  const [foreign, setForeign] = useState(() => (urlStep.open && urlStep.step === "add" ? 1 : stepDepth(urlStep)));
  // 닫기를 눌렀고 history.go(-n) 결과를 기다리는 중. 그동안 표면은 바로 숨긴다
  const [closing, setClosing] = useState(false);
  if (!urlStep.open && (closing || foreign !== 0)) {
    // 렌더 중 상태 맞추기 (주소가 닫힘이 되면 둘 다 처음으로)
    setClosing(false);
    setForeign(0);
  }
  const visible = urlStep.open && !closing;
  const ownDepth = Math.max(0, stepDepth(urlStep) - foreign);
  // 닫히는 중에 다른 날짜를 누른 경우: 닫힘이 주소에 반영된 뒤 연다
  const pending = useRef<{ date: DateKey; ev?: EventRef } | null>(null);

  // phone 일 상세에서 고른 다른 날. replaceState 가 useSearchParams 에 닿기 전에도 화면이 그날을 그리게 (스와이프 중 옛 주가 비치지 않게)
  const [dayTarget, setDayTarget] = useState<DateKey | null>(null);
  if (dayTarget !== null && (!urlStep.open || urlStep.date === dayTarget)) setDayTarget(null);
  const openDate = urlStep.open ? (dayTarget ?? urlStep.date) : null;

  // 열린 상세의 날짜를 선택 날짜로 (앞으로가기, 새로고침으로 들어온 경우)
  if (visible && openDate && openDate !== selected) {
    setSelected(openDate);
    const p = parseKey(openDate);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  // 새로고침으로 add=1 에 들어오면 빈 폼을 띄우지 않고 날짜 상세로 (5-5). 주소에서도 뗀다.
  // 자식 효과는 Next 앱 라우터의 효과보다 먼저 돌아서, 바로 replaceState 하면 Next 가 그 칸을 모른다. 한 틱 미룬다
  useEffect(() => {
    const t = setTimeout(() => {
      if (onEventRoute()) return;
      const first = parseDayStep(new URLSearchParams(window.location.search), todayKey());
      if (first.open && first.step === "add") writeUrl(`${CALENDAR_PATH}${withDayStep(window.location.search, { step: "day", date: first.date }, todayKey())}`, "replace");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // 선택 날짜와 보던 달을 URL 에 남긴다 (새로고침, 공유, 뒤로가기 복원 #81, + 버튼의 기준 날짜 #57)
  // router.replace 대신 history.replaceState 를 쓴다. router.replace 는 날짜를 누를 때마다 서버 렌더를 다시 받는다.
  // 뒤로가기로 주소가 바뀐 뒤에도 다시 맞추도록 searchParams 를 같이 본다. day, add 는 건드리지 않는다.
  // 일정 상세 경로(/events/<코드>) 위에서는 쓰지 않는다 (그 주소에는 달력 쿼리가 없다)
  useEffect(() => {
    if (onEventRoute()) return;
    const next = withSelection(window.location.search, selected, today, { y, m });
    if (next !== null) writeUrl(`${CALENDAR_PATH}${next}`, "replace");
  }, [selected, today, y, m, searchParams, pathname]);

  /** 달력 쿼리의 바탕. 일정 상세 경로 위에서는 주소에 없으니 지금 선택 날짜와 보는 달로 만든다 */
  const calendarSearch = useCallback(() => (onEventRoute() ? (withSelection("", selected, today, { y, m }) ?? "") : window.location.search), [selected, today, y, m]);

  /* ---------- 데이터 ---------- */

  // 넓은 화면 요약 카드 "이번 주 일정" (월요일 시작 KST 한 주, 보는 달과 상관없이)
  const weekQ = useEvents(groupId, weekQueryOf(today), { enabled: wide });
  const loadWeek = weekQ.refetch;
  // 기념일은 못 받아도 빈 목록으로 본다 (D-day 줄만 안내로 바뀜)
  const anniversariesQ = useAnniversaries(groupId);
  const { data: anniversaryData, error: anniversaryError } = anniversariesQ;
  const anniversaries = useMemo(
    () => anniversaryData ?? (anniversaryError ? [] : null),
    [anniversaryData, anniversaryError],
  );

  const memberCount = group?.members.length ?? 0;

  // 오늘 모두 비는 시간 (첫 구간). phone 일 상세의 오늘 요약, 넓은 화면 요약 카드
  const todayFreeQ = useFreeSlots(groupId, {
    from: kstToIso(today),
    to: kstToIso(addDays(today, 1)),
    dayStart: "09:00",
    dayEnd: "23:00",
    minMinutes: 60,
    includeAllDay: false,
  });
  const todayFree = todayFreeQ.data ? (upcomingSlots(todayFreeQ.data.slots, 60)[0] ?? null) : undefined;

  // 날짜 상세의 비는 시간 한 줄: 멤버 2명 이상(phone 일 상세는 혼자여도 "비는 시간"), 오늘 이후만. 하루 1회, 오늘은 위 값을 다시 쓴다 (5-2)
  const surfaceDate = visible ? openDate : null;
  const minFreeMembers = wide ? 2 : 1;
  const dayFreeEnabled = surfaceDate !== null && memberCount >= minFreeMembers && surfaceDate > today;
  const dayFreeQ = useFreeSlots(
    groupId,
    {
      from: kstToIso(surfaceDate ?? today),
      to: kstToIso(addDays(surfaceDate ?? today, 1)),
      dayStart: "09:00",
      dayEnd: "23:00",
      minMinutes: 60,
      includeAllDay: false,
    },
    { enabled: dayFreeEnabled },
  );
  // 일정을 추가, 수정, 삭제한 뒤: 일정에서 나오는 값을 모두 다시 받는다 (월 그리드, 다가오는 일정, 이번 주, 비는 시간 QA3-M4)
  const loadTodayFree = todayFreeQ.refetch;
  const loadDayFree = dayFreeQ.refetch;
  const reload = useCallback(() => {
    void loadEvents();
    void loadUpcoming();
    if (wide) void loadWeek();
    void loadTodayFree();
    // refetch 는 enabled 를 보지 않으므로 켜져 있을 때만
    if (dayFreeEnabled) void loadDayFree();
    // 사이드바 "다가오는 일정" 도 다시 받게
    eventsChanged();
  }, [loadEvents, loadUpcoming, loadWeek, wide, loadTodayFree, loadDayFree, dayFreeEnabled, eventsChanged]);

  const dayFreeLabel = memberCount <= 1 ? "비는 시간" : memberCount === 2 ? "둘 다 비는 시간" : "모두 비는 시간";
  let freeHint: FreeHint = null;
  if (surfaceDate && memberCount >= minFreeMembers && surfaceDate >= today) {
    if (surfaceDate === today) {
      if (!todayFreeQ.error) freeHint = { label: dayFreeLabel, slot: todayFree === undefined ? "loading" : todayFree };
    } else if (!dayFreeQ.error) {
      freeHint = { label: dayFreeLabel, slot: dayFreeQ.isLoading || !dayFreeQ.data ? "loading" : (upcomingSlots(dayFreeQ.data.slots, 60)[0] ?? null) };
    }
  }

  const byDay = useMemo(() => groupByDay(events ?? []), [events]);
  // 주마다 여러 날 일정 막대 레인 (#202). 넓은 화면은 칸 높이별(칩 2줄 tall, 3줄 taller) 로 자리를 맞춰 둔다
  const weeks = useMemo(() => {
    const out: { packed: PackedWeek<Event>; fit2: ReturnType<typeof fitWeek<Event>>; fit3: ReturnType<typeof fitWeek<Event>> }[] = [];
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
  // phone "기념일" 구역 카드: 기념일마다 다음 항목 하나 (#212)
  const annCards = useMemo(() => (anniversaries ? nextOccurrences(anniversaries, today, 10) : null), [anniversaries, today]);

  // 요약 카드 "오늘 기념일" / "다음 기념일" (이름 + N일 + D-n)
  const nearest = useMemo(() => nearestAnniversary(anniversaries, today), [anniversaries, today]);

  // 요약 카드 라벨: 혼자인 팀은 "비는 시간" (디자인규칙.md 2-2, #212)
  const freeLabel = memberCount <= 1 ? "비는 시간" : memberCount === 2 ? "오늘 둘 다 비는 시간" : "오늘 모두 비는 시간";
  const weekRange = weekQueryOf(today);
  const weekCount = weekQ.data ? countEventsInRange(weekQ.data, weekRange.from, weekRange.to) : null;

  /* ---------- 상세에 넣을 것 ---------- */

  const surfaceEvents = surfaceDate && events ? (byDay.get(surfaceDate) ?? []) : null;
  // 반복 회차는 (공개 코드, occurrence) 로 찾는다 (#187, #311). 한 번짜리는 occurrence 가 둘 다 null
  const surfaceRef = visible && urlStep.step === "event" ? { code: urlStep.code, occurrence: urlStep.occurrence } : null;
  const isSurface = (e: Event) => surfaceRef !== null && e.publicCode === surfaceRef.code && (e.occurrence ?? null) === surfaceRef.occurrence;
  const surfaceEvent = surfaceRef === null ? undefined : (events?.find(isSurface) ?? upcomingData?.find(isSurface));
  const eventMissing = surfaceRef !== null && surfaceEvent === undefined && events !== null && !eventsError && upcomingData !== null;

  /* ---------- 동작 ---------- */

  function go(n: number) {
    setMonth(shiftMonth(y, m, n));
  }
  // 달력 좌우 스와이프 (#162): 왼쪽으로 밀면 다음 달. 날짜 상세가 떠 있는 동안은 보지 않는다
  const swipeRef = useMonthSwipe<HTMLUListElement>({
    enabled: !visible,
    onCommit: (dir) => {
      go(dir);
      haptic("light");
    },
  });
  function goToday() {
    const p = parseKey(today);
    setMonth({ y: p.y, m: p.m });
    setSelected(today);
  }
  function pick(key: string) {
    setSelected(key);
    const p = parseKey(key);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  /** 닫기 버튼, 배경, 끌기, 바깥 클릭, Esc. 쌓은 칸 수만큼 되돌린다 (앞으로가기에 유령 상태가 남지 않게) */
  function close() {
    if (!urlStep.open) return;
    setClosing(true);
    if (ownDepth > 0) window.history.go(-ownDepth);
    else writeUrl(dayStepUrl(calendarSearch(), { step: "closed" }, today), "replace");
  }

  /** 날짜 상세를 연다 (ev 가 있으면 그 일정 상세까지 두 칸). 이미 열려 있으면 닫고 나서 연다. 넓은 화면은 openDay 가 먼저 패널을 본다 */
  function openDayFresh(date: DateKey, ev?: EventRef) {
    if (urlStep.open) {
      pending.current = { date, ev };
      if (!closing) close();
      return;
    }
    pick(date);
    // 바탕 칸에 고른 날짜를 먼저 남긴다. 뒤로가기로 닫혀도 같은 날짜가 선택돼 있게 (여기 올 때 주소는 늘 /calendar 다)
    const p = parseKey(date);
    const base = withSelection(window.location.search, date, today, { y: p.y, m: p.m });
    if (base !== null) writeUrl(`${CALENDAR_PATH}${base}`, "replace");
    writeUrl(dayStepUrl(window.location.search, { step: "day", date }, today), "push");
    if (ev !== undefined) {
      routeDates.set(routeKey(ev.publicCode, ev.occurrence ?? null), date);
      writeUrl(dayStepUrl(window.location.search, eventStep(date, ev), today), "push");
    }
  }

  // 닫힘이 주소에 반영된 뒤 기다리던 열기를 지금 렌더의 openDay 로 (옛 렌더의 urlStep 을 보지 않게)
  const runPending = useEffectEvent(() => {
    const p = pending.current;
    pending.current = null;
    if (p) openDayFresh(p.date, p.ev);
  });

  useEffect(() => {
    if (!urlStep.open) {
      // 닫힘이 반영됐다. 기다리던 열기가 있으면 지금
      if (pending.current) queueMicrotask(runPending);
      return;
    }
    // 우리가 쌓은 칸을 다 되돌렸는데 남의 칸(새로고침 주소)이 남아 있으면 떼어 낸다
    if (closing && ownDepth === 0) writeUrl(dayStepUrl(calendarSearch(), { step: "closed" }, today), "replace");
  }, [urlStep, closing, ownDepth, today, calendarSearch]);

  /** 날짜 상세 안에서 한 단계 더 (일정 상세, 빠른 추가). 날짜 단계 위에서만 부르므로 주소는 /calendar 다 */
  function forward(target: StepTarget) {
    setIgnoreAdd(false);
    if (target.step === "event") routeDates.set(routeKey(target.code, target.occurrence), target.date);
    writeUrl(dayStepUrl(window.location.search, target, today), "push");
  }

  /** ← : 일정 상세/빠른 추가 → 날짜 상세. 우리가 쌓은 칸이면 history.back, 아니면 주소만 바꾼다 */
  function back() {
    if (!urlStep.open) return;
    // 맨 위 칸(일정 상세/빠른 추가)을 우리가 쌓았으면 되돌리고, 새로고침 주소면 바꿔 쓴다
    if (ownDepth >= 1 && stepDepth(urlStep) === 2) window.history.back();
    else writeUrl(dayStepUrl(calendarSearch(), { step: "day", date: urlStep.date }, today), "replace");
  }

  // 일정이 없어졌으면(다른 사람이 삭제) 날짜 상세로
  useEffect(() => {
    if (eventMissing && urlStep.open) writeUrl(dayStepUrl(calendarSearch(), { step: "day", date: urlStep.date }, today), "replace");
  }, [eventMissing, urlStep, today, calendarSearch]);

  // phone 일 상세 (#212). 날짜 단계만 달력 자리를 대신하고, 일정 상세/빠른 추가는 그 위 시트
  const dayView = !wide && visible;
  /** 일 상세 안에서 다른 날로: 기록 칸을 더 쌓지 않고 주소만 바꾼다 (뒤로가기는 여전히 월 보기로, D-58) */
  function changeDay(date: DateKey) {
    if (!urlStep.open || urlStep.step !== "day" || date === openDate) return;
    setDayTarget(date);
    pick(date);
    writeUrl(dayStepUrl(window.location.search, { step: "day", date }, today), "replace");
  }
  // 주간 줄 좌우 스와이프: 왼쪽으로 밀면 다음 주 같은 요일 (달력 스와이프와 같은 판단, #162)
  const stripRef = useMonthSwipe<HTMLUListElement>({
    enabled: dayView && urlStep.open && urlStep.step === "day",
    onCommit: (dir) => {
      if (openDate) changeDay(shiftWeek(openDate, dir));
      haptic("light");
    },
  });

  /* ---------- 넓은 화면 일 상세 패널 (#331) ---------- */

  // 일정 상세/빠른 추가에서 한 칸 되돌린 뒤 바꿀 날 (history.back 결과가 주소에 반영되면 아래 효과가 마저 한다)
  const panelPending = useRef<{ date: DateKey; ev?: EventRef } | null>(null);
  /** 열린 패널에서 다른 날(ev 가 있으면 그날의 그 일정 상세까지)로. 기록은 날짜 단계 한 칸(+ 일정 상세 한 칸)을 넘지 않는다 */
  function showInPanel(date: DateKey, ev?: EventRef) {
    const move = panelMove(urlStep, ownDepth);
    if (move === "open") {
      openDayFresh(date, ev);
      return;
    }
    if (move === "back") {
      panelPending.current = { date, ev };
      window.history.back();
      return;
    }
    if (move === "rewrite") {
      // 새로 고침, 공유로 들어온 일정 상세(되돌릴 칸이 없다): 주소를 그날 날짜 단계로 바꿔 쓴다. 남의 칸은 이제 한 칸
      setIgnoreAdd(false);
      setForeign(1);
      setDayTarget(date);
      pick(date);
      writeUrl(dayStepUrl(calendarSearch(), { step: "day", date }, today), "replace");
    } else if (date !== openDate) {
      changeDay(date);
    }
    if (ev !== undefined) forward(eventStep(date, ev));
  }
  const runPanelPending = useEffectEvent(() => {
    const p = panelPending.current;
    panelPending.current = null;
    if (p) showInPanel(p.date, p.ev);
  });
  useEffect(() => {
    if (panelPending.current && urlStep.open && urlStep.step === "day") queueMicrotask(runPanelPending);
    // 되돌리다 패널이 닫혔으면(다른 경로) 기다리던 것은 버린다
    if (!urlStep.open) panelPending.current = null;
  }, [urlStep]);

  /** 날짜 상세를 연다. (#331) 넓은 화면 패널이 열려 있으면 닫지 않고 내용만 바꾼다 */
  function openDay(date: DateKey, ev?: EventRef) {
    if (wide && urlStep.open) showInPanel(date, ev);
    else openDayFresh(date, ev);
  }

  function onCell(key: DateKey) {
    // (#331) 넓은 화면: 패널이 열려 있으면 내용만 그날로 (같은 날이면 일정 상세에서 그날 목록으로 돌아온다)
    if (wide && visible) {
      showInPanel(key);
      return;
    }
    if (visible && urlStep.date === key) {
      close();
      return;
    }
    openDay(key);
  }

  function onQuickSaved(ev: Event) {
    toast.show("일정을 추가했어요");
    reload();
    // phone 은 일 상세로, 넓은 화면은 패널의 그날 목록으로 돌아간다 (그날 목록에 바로 보이게)
    if (dayView || wide) {
      back();
      return;
    }
    close();
    pick(dateKeyOf(ev.startsAt));
  }

  const remove = useDeleteEvent(groupId);
  // 반복 일정 삭제는 범위 시트 (#187). 고른 범위의 요청 중 표시
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopePending, setScopePending] = useState<EventScope | null>(null);
  function askDelete() {
    if (surfaceEvent?.repeat) setScopeOpen(true);
    else setConfirmDelete(true);
  }
  async function removeEvent(scope: EventScope | null = null) {
    if (!surfaceEvent) return;
    setScopePending(scope);
    const target = surfaceEvent.repeat && scope ? { occurrence: surfaceEvent.occurrence ?? undefined, scope } : {};
    const r = await remove.mutate({ eventId: surfaceEvent.id, ...target });
    setScopePending(null);
    setScopeOpen(false);
    setConfirmDelete(false);
    if (!r.ok) {
      if (r.error.status === 404) {
        toast.show("이미 삭제된 일정이에요");
        back();
        reload();
        return;
      }
      toast.show(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    toast.show("일정을 삭제했어요");
    back();
    reload();
  }

  const newHref = newEventLink(kstToIso(selected, "10:00"), kstToIso(selected, "11:00"));
  const thisYear = parseKey(today).y;
  const titleId = useId();

  /* ---------- 조각 ---------- */

  /* ---------- phone 구역 (디자인규칙.md 2-1, 5, #212) ---------- */

  // 구역 제목줄 32: 제목 18/700 -0.02em + 오른쪽 "전체보기 ›" 13/400 --mute. 내용과 8px
  const sectionHead = (id: string, title: string, more: React.ReactNode) => (
    <div className="mb-2 flex h-8 items-center">
      <h2 id={id} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
        {title}
      </h2>
      <span className="flex-1" />
      {more}
    </div>
  );
  const moreCls = "hit flex h-8 items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink";
  // 가로 카드 줄: 카드 폭 148, 간격 10. 좌우 여백 20 선에서 시작하고 화면 밖으로 다음 카드가 잘려 보인다
  const rail = "-mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  const cardSkeletons = (h: string) => (
    <div className={rail} aria-busy="true" aria-label="불러오는 중">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={`${h} w-[148px] shrink-0 rounded-xl`} />
      ))}
    </div>
  );
  // 빈 구역: 카드 대신 한 줄 안내 + 글자 버튼. 구역은 지우지 않는다
  const emptyLine = (text: string, action: React.ReactNode) => (
    <p className="flex h-11 items-center gap-1.5 text-[14px] text-ink-2">
      {text}
      {action}
    </p>
  );

  // "다가오는 일정" 카드 148×108: 날짜(12/600, 오늘이면 --today-ink "오늘") + 멤버 점 8 / 제목 16/700 두 줄 / 시각 12 --mute.
  // 누르면 그날 일 상세 → 일정 상세. "전체보기" 는 다가오는 일정 목록 화면 (#222, D-68 의 "오늘 일 상세" 를 대신한다)
  const phoneUpcoming = (
    <section aria-labelledby={`${titleId}-pup`} className="mt-[22px]">
      {sectionHead(
        `${titleId}-pup`,
        "다가오는 일정",
        <Link href={UPCOMING_PATH} className={moreCls}>
          전체보기
          <IconChevronRight size={14} />
        </Link>,
      )}
      {upcomingQ.error ? (
        emptyLine(
          "일정을 불러오지 못했어요.",
          <button type="button" onClick={() => void loadUpcoming()} className="font-bold text-btn">
            다시 시도
          </button>,
        )
      ) : upcomingList === null ? (
        cardSkeletons("h-[108px]")
      ) : upcomingList.length === 0 ? (
        emptyLine(
          "한 달 동안 잡힌 일정이 없어요.",
          <Link href={newHref} className="font-bold text-btn">
            일정 추가
          </Link>,
        )
      ) : (
        <ul className={rail}>
          {upcomingList.map((ev) => {
            const k = dateKeyOf(Math.max(Date.parse(ev.startsAt), Date.parse(kstToIso(today))));
            const isToday = k === today;
            return (
              <li key={eventKey(ev)} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => openDay(k, ev)}
                  aria-label={withWho(`${isToday ? "오늘" : formatDateKo(k)} ${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
                  className="flex h-[108px] w-[148px] flex-col rounded-xl bg-paper px-3.5 py-3 text-left hover:bg-hover"
                >
                  <span aria-hidden="true" className="flex h-4 w-full items-center">
                    <small className={`text-[12px] font-semibold leading-4 ${isToday ? "text-today-ink" : "text-ink-2"}`}>
                      {isToday ? "오늘" : formatDateKo(k)}
                    </small>
                    {/* 참여자 점 최대 3 (간격 3) + 넘치면 "+". 참여자 없음은 회색 점 1 (#248 7-2) */}
                    <DotCluster event={ev} size={8} gap={3} className="ml-auto" plusClass="text-[11px] font-bold leading-none text-soft" />
                  </span>
                  <b aria-hidden="true" className="mt-1.5 line-clamp-2 text-[16px] font-bold leading-[22px] tracking-[-0.02em]">
                    {ev.title}
                  </b>
                  <span aria-hidden="true" className="mt-auto truncate text-[12px] leading-4 text-ink-2">
                    {formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  // "기념일" 카드 148×84: D-n 22/700 (오늘이면 --acc-ink "오늘") / 이름 13/500 한 줄. 누르면 그날 일 상세
  const phoneAnniversaries = (
    <section aria-labelledby={`${titleId}-pann`} className="mt-[22px]">
      {sectionHead(
        `${titleId}-pann`,
        "기념일",
        <Link href={ANNIVERSARIES_PATH} className={moreCls}>
          전체보기
          <IconChevronRight size={14} />
        </Link>,
      )}
      {annCards === null ? (
        cardSkeletons("h-[84px]")
      ) : annCards.length === 0 ? (
        emptyLine(
          "기념일을 등록하면 D-day 가 보여요.",
          <Link href={ANNIVERSARIES_PATH} className="font-bold text-btn">
            기념일 추가
          </Link>,
        )
      ) : (
        <ul className={rail}>
          {annCards.map((o) => {
            const badge = dayBadge(o.date, today);
            const title = occurrenceTitle(o);
            return (
              <li key={`${o.anniversary.id}-${o.date}`} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => openDay(o.date)}
                  aria-label={`${title}, ${formatDateKo(o.date)}, ${badge}`}
                  className="flex h-[84px] w-[148px] flex-col justify-between rounded-xl bg-paper px-3.5 py-3 text-left hover:bg-hover"
                >
                  <b aria-hidden="true" className={`text-[22px] font-bold leading-7 tracking-[-0.02em] ${badge === "오늘" ? "text-acc-ink" : ""}`}>
                    {badge}
                  </b>
                  <span aria-hidden="true" className="truncate text-[13px] font-medium leading-[18px]">
                    {title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const panel = surfaceDate ? (
    <DayPanel
      groupId={groupId}
      date={surfaceDate}
      today={today}
      step={urlStep.open ? urlStep.step : "day"}
      titleId={titleId}
      events={surfaceEvents}
      eventsError={eventsError}
      onRetry={reload}
      anniversaries={anniversariesOn(anniversaries, surfaceDate)}
      event={surfaceEvent}
      onClose={dayView ? back : close}
      onBack={back}
      onOpenEvent={(ev) => forward(eventStep(surfaceDate, ev))}
      onPickDay={changeDay}
      onSaved={onQuickSaved}
      onDelete={askDelete}
    />
  ) : null;
  // 날짜 단계만 비는 시간 줄과 "이 날 일정 추가" 를 표면 바닥에 고정한다 (#175, #331). 빠른 추가, 상세는 자기 버튼이 있다
  const dayFooter =
    surfaceDate && (!urlStep.open || urlStep.step === "day") ? (
      <>
        {freeHint && <DayFreeRow free={freeHint} newEventHref={newEventLink} />}
        <DayAddButton onAdd={() => forward({ step: "add", date: surfaceDate })} />
      </>
    ) : null;

  /* ---------- 넓은 화면 요약 카드 (디자인규칙.md 2-2, 5: 3열 × 84, 라벨 13 --mute / 값 20/700) ---------- */

  const sumCard =
    "flex h-[84px] min-w-0 flex-col justify-between rounded-xl bg-paper px-4 py-3.5 text-left main-cardstack:h-12 main-cardstack:flex-row main-cardstack:items-center main-cardstack:gap-3 main-cardstack:py-0";
  const sumLabel = "block truncate text-[13px] leading-[18px] text-ink-2 main-cardstack:shrink-0";
  const sumValue = "block truncate text-[20px] font-bold leading-7 tracking-[-0.02em] main-cardstack:text-[17px]";
  const freeCard =
    todayFreeQ.error && todayFree === undefined ? (
      <button type="button" onClick={() => void todayFreeQ.refetch()} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-[15px] text-ink-2`}>계산 실패, 다시 시도</span>
      </button>
    ) : todayFree === undefined ? (
      <div className={sumCard} aria-busy="true">
        <span className={sumLabel}>{freeLabel}</span>
        <Skeleton className="h-6 w-28" />
      </div>
    ) : todayFree === null ? (
      <Link href={FREE_PATH} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-ink-2`}>없어요</span>
      </Link>
    ) : (
      <Link
        href={newEventLink(todayFree.startsAt, todayFree.endsAt)}
        aria-label={`${freeLabel} ${timeOf(todayFree.startsAt)}부터 ${timeOf(todayFree.endsAt)}까지, 눌러서 바로 약속 잡기`}
        className={`${sumCard} hover:bg-hover`}
      >
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-acc-ink`}>
          {timeOf(todayFree.startsAt)}~{timeOf(todayFree.endsAt)}
        </span>
      </Link>
    );
  const annToday = nearest?.value === "오늘";
  const annCard =
    anniversaries === null ? (
      <div className={sumCard} aria-busy="true">
        <span className={sumLabel}>오늘 기념일</span>
        <Skeleton className="h-6 w-24" />
      </div>
    ) : (
      <Link href={ANNIVERSARIES_PATH} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{annToday ? "오늘 기념일" : "다음 기념일"}</span>
        {nearest === null ? (
          <span className={`${sumValue} text-ink-2`}>없어요</span>
        ) : annToday ? (
          // 좁은 폭(884)에서 이름만 줄이고 "1000일" 은 남긴다 (QA3-L4)
          <span className="flex min-w-0 items-baseline gap-1 text-acc-ink">
            <span className={`${sumValue} min-w-0`}>{nearest.name}</span>
            {nearest.label && <span className={`${sumValue} shrink-0`}>{nearest.label}</span>}
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <b className={`${sumValue} shrink-0`}>{nearest.value}</b>
            <span className="min-w-0 truncate text-[13px] font-medium text-soft">{nearest.name}</span>
            {nearest.label && <span className="-ml-1 shrink-0 text-[13px] font-medium text-soft">{nearest.label}</span>}
          </span>
        )}
      </Link>
    );
  const weekCard = (
    <div className={sumCard} aria-busy={weekCount === null && !weekQ.error ? true : undefined}>
      <span className={sumLabel}>이번 주 일정</span>
      {weekQ.error ? (
        <button type="button" onClick={() => void loadWeek()} className={`${sumValue} text-left text-[15px] text-ink-2`}>
          불러오기 실패, 다시 시도
        </button>
      ) : weekCount === null ? (
        <Skeleton className="h-6 w-14" />
      ) : (
        <span className={sumValue}>{weekCount}개</span>
      )}
    </div>
  );

  return (
    // 넓은 화면은 AppShell 본문 바깥 여백(28 32) 안에서 화면 높이를 채운다 (제목줄 → 요약 카드 → 달력).
    // (#331) 가로로 [달력 칸 | 일 상세 패널 400]. 패널은 본문 760 이상에서만 이 줄에 들어오고(main-panel), 그보다 좁으면 fixed 시트
    <div className="fold:flex fold:h-[calc(100dvh-56px)] fold:min-h-[540px]">
      {/* phone 일 상세: 달력 자리를 대신한다 (#212) */}
      {dayView && surfaceDate && (
        <DayView
          date={surfaceDate}
          today={today}
          titleId={`${titleId}-dv`}
          byDay={events ? byDay : null}
          eventsError={eventsError}
          onRetry={reload}
          anniversaries={anniversariesOn(anniversaries, surfaceDate)}
          free={freeHint}
          stripRef={stripRef}
          onPickDay={changeDay}
          onMonth={close}
          onOpenEvent={(ev) => forward(eventStep(surfaceDate, ev))}
          onAdd={() => forward({ step: "add", date: surfaceDate })}
          newEventHref={newEventLink}
        />
      )}
      {/* 왼쪽: 월 헤더 + 달력. (#331) 이 칸도 컨테이너 main 이라 안쪽 main-* 변형(좁은 제목줄, 요약 카드 3열/세로)은
          패널이 붙어 좁아진 달력 폭으로 갈린다 */}
      <section className={`${dayView ? "hidden" : "flex"} @container/main min-w-0 flex-col fold:min-h-0 fold:flex-1`}>
        {/* phone: 같이 쓰기 입구(있을 때만) → "11월" 제목줄 32 (제목 18/700 / 오늘 알약 + ‹ ›).
            넓은 화면도 입구는 제목줄 위에 같은 카드로 */}
        {together && (
          <div className="mb-[22px] rounded-xl bg-paper px-3.5 empty:hidden fold:mb-3 [&>div:last-child]:hidden">
            <TogetherHint hint={together} />
          </div>
        )}
        <div className="mt-1 flex h-8 items-center fold:hidden">
          <h1 aria-label={`${y}년 ${m}월`} className="shrink-0 whitespace-nowrap text-[18px] font-bold leading-6 tracking-[-0.02em]">
            {y !== thisYear ? `${y}년 ${m}월` : `${m}월`}
          </h1>
          <span className="flex-1" />
          <button type="button" onClick={goToday} className="hit h-8 shrink-0 rounded-full bg-paper px-3.5 text-[13px] font-bold">
            오늘
          </button>
          <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="hit ml-3 grid size-8 place-items-center rounded-full hover:bg-hover">
            <IconChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="다음 달" className="hit ml-3 grid size-8 place-items-center rounded-full hover:bg-hover">
            <IconChevronRight size={18} />
          </button>
        </div>
        {/* 넓은 화면 제목줄 44: "2026년 11월" 28/700, 오늘 알약, ‹ ›, 오른쪽 주 버튼 "일정 추가" (FAB 대신, 디자인규칙.md 2-2).
            본문이 좁은 폭(384 미만. 펼친 사이드바면 뷰포트 712 미만: 아이폰 듀오 펼침 세로 669, 폴드 세로) 에서는
            한 줄에 다 안 들어가 가로 스크롤이 생겼다. 제목만 첫 줄, 둘째 줄에 오늘 ‹ › 와 "+ 추가".
            (#323) 뷰포트가 아니라 본문 폭(main-narrow/main-roomy)으로 고른다. 사이드바를 접으면 같은 뷰포트에서 본문이 192 넓다 */}
        <div className="hidden shrink-0 flex-wrap items-center gap-2 fold:flex main-roomy:h-11">
          <h1 className="mr-2 shrink-0 whitespace-nowrap text-[28px] font-bold leading-9 tracking-[-0.02em] main-narrow:basis-full">
            {y}년 {m}월
          </h1>
          <button type="button" onClick={goToday} className="hit h-8 shrink-0 whitespace-nowrap rounded-full bg-paper px-3.5 text-[13px] font-bold hover:bg-hover">
            오늘
          </button>
          {/* 화살표는 보이는 크기 32, 누르는 칸 44 가 겹치지 않게 중심 간격 44 (#133) */}
          <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="hit ml-1 grid size-8 place-items-center rounded-full hover:bg-paper">
            <IconChevronLeft size={20} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="다음 달" className="hit ml-3 grid size-8 place-items-center rounded-full hover:bg-paper">
            <IconChevronRight size={20} />
          </button>
          <span className="flex-1" />
          <Link
            href={newHref}
            aria-label="일정 추가"
            className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-btn px-4 text-[14px] font-bold text-on-btn hover:brightness-95 main-narrow:px-3"
          >
            <IconPlus size={18} strokeWidth={2.2} />
            <span>
              <span className="main-narrow:hidden">일정 </span>추가
            </span>
          </Link>
        </div>

        {/* 넓은 화면 요약 카드 3열, 간격 12. 본문이 좁으면(main-cardstack, <640, #325) 3열이면 카드가 85px 남짓이라 값이 잘린다 →
            한 줄 카드(높이 48, 왼쪽 라벨, 오른쪽 값) 3장을 세로로 */}
        <div className="mt-4 hidden shrink-0 grid-cols-3 gap-3 fold:grid main-cardstack:mt-3 main-cardstack:grid-cols-1 main-cardstack:gap-2">
          {freeCard}
          {annCard}
          {weekCard}
        </div>

        {/* 달력 타일 */}
        <div className="mt-2 overflow-x-clip rounded-xl bg-paper px-1.5 pb-1 fold:mt-3 fold:flex fold:min-h-0 fold:flex-1 fold:flex-col fold:px-2">
          <div aria-hidden="true" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={i === 0 || i === 6 ? "text-holiday" : ""}>
                {w}
              </span>
            ))}
          </div>
          {/* 날짜 칸 격자 위에 같은 줄 격자로 주마다 여러 날 일정 막대를 겹쳐 그린다 (#202, 넓은 화면) */}
          <div className="relative fold:flex fold:min-h-0 fold:flex-1 fold:flex-col">
            {/* touch-pan-y: 세로 스크롤은 브라우저가, 가로는 스와이프가 (#162) */}
            <ul
              ref={swipeRef}
              aria-label={`${y}년 ${m}월 날짜`}
              className="grid touch-pan-y grid-cols-7 fold:min-h-0 fold:flex-1 fold:auto-rows-fr"
            >
              {grid.map((key, i) => {
                const w = weeks[Math.floor(i / 7)];
                const col = i % 7;
                return (
                  <DayCell
                    key={key}
                    dateKey={key}
                    inMonth={parseKey(key).m === m}
                    isToday={key === today}
                    isSelected={key === selected}
                    isAnchor={wide && surfaceDate === key}
                    events={byDay.get(key) ?? []}
                    anniversaries={annByDay.get(key) ?? []}
                    week={w.packed}
                    col={col}
                    fit2={w.fit2.days[col]}
                    fit3={w.fit3.days[col]}
                    loading={events === null}
                    onPick={() => onCell(key)}
                    onOpen={(ev) => openDay(key, ev)}
                  />
                );
              })}
            </ul>
            {events !== null && (
              <div
                className="pointer-events-none absolute inset-0 hidden grid-cols-7 fold:grid"
                style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
              >
                {weeks.map((w, r) => (
                  // 칸(li) 과 같은 높이, 같은 위 1px 테두리라야 tall/taller 가 칸과 똑같이 갈린다
                  <div key={w.packed.days[0]} className="relative border-t border-transparent [container-type:size]" style={{ gridRow: r + 1, gridColumn: "1 / -1" }}>
                    {w.fit2.pieces.map((p) => (
                      <WeekBar key={`2@${p.key}@${p.col}`} piece={p} className="hidden tall:flex taller:hidden" onOpen={() => openDay(w.packed.days[p.col], p.event)} />
                    ))}
                    {w.fit3.pieces.map((p) => (
                      <WeekBar key={`3@${p.key}@${p.col}`} piece={p} className="hidden taller:flex" onOpen={() => openDay(w.packed.days[p.col], p.event)} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* phone: 다가오는 일정, 기념일, 할 일(#276) 가로 카드 구역 (그날 내용은 일 상세가 보여 준다) */}
        <div className="fold:hidden">
          {phoneUpcoming}
          {phoneAnniversaries}
          <TodoHomeSection groupId={groupId} enabled={!wide} titleId={`${titleId}-ptodo`} />
        </div>
      </section>

      {/* 날짜 상세: phone 바텀 시트, 넓은 화면 오른쪽 패널(#331). 폭이 바뀌면 같은 상태로 표면만 바뀐다 */}
      {visible &&
        panel &&
        surfaceDate &&
        (wide ? (
          <DayDock date={surfaceDate} titleId={titleId} onClose={close} paused={confirmDelete || scopeOpen} footer={dayFooter}>
            {panel}
          </DayDock>
        ) : urlStep.open && urlStep.step !== "day" ? (
          <DaySheet titleId={titleId} onClose={back} paused={confirmDelete || scopeOpen}>
            {panel}
          </DaySheet>
        ) : null)}

      <ConfirmDialog
        open={confirmDelete}
        title="이 일정을 삭제할까요?"
        body="팀원 모두에게서 사라져요"
        confirmLabel="삭제"
        danger
        loading={remove.isPending}
        onConfirm={() => void removeEvent()}
        onCancel={() => setConfirmDelete(false)}
      />
      {surfaceEvent?.repeat && (
        <ScopeSheet
          open={scopeOpen}
          mode="delete"
          occurrence={surfaceEvent.occurrence ?? dateKeyOf(surfaceEvent.startsAt)}
          pending={scopePending}
          onPick={(scope) => void removeEvent(scope)}
          onClose={() => setScopeOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- 날짜 칸 ---------- */

// 칩, 막대 한 줄 = 위 여백 2 + 높이 18
const ROW_PX = 20;
// 칸 위 1px 테두리 다음부터 첫 줄까지: 위 여백 4 + 숫자 줄 24 + 줄 위 여백 2
const FIRST_ROW_TOP = 30;

/**
 * 넓은 화면 여러 날 일정 막대 (#202). 한 주 줄 위에 걸친 칸만큼 한 줄로. 모양은 칩과 같다
 * (11/500, 높이 18, 모서리 5, 옅은 멤버 색 면 + 진한 글자). 진짜 시작, 끝만 둥글고 칸 안쪽 4px 에서 시작한다.
 * 앞 주에서 이어지거나 다음 주로 넘어가는 쪽은 칸 끝까지 각지게 붙인다. 제목은 조각마다 한 번
 */
function WeekBar({ piece, className, onOpen }: { piece: BarPiece<Event>; className: string; onOpen: () => void }) {
  const ev = piece.event;
  const who = useWho();
  // 글자가 있는 막대라 칩 규칙 (#248 D-141): 첫 참여자 색 면 + 참여자 둘 이상이면 제목 앞 점 묶음
  const cluster = participantColors(ev).length >= 2;
  const l = piece.roundStart ? 4 : 0;
  const r = piece.roundEnd ? 4 : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={withWho(`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
      className={`pointer-events-auto absolute h-[18px] items-center gap-1 overflow-hidden px-1.5 text-left text-[11px] font-medium leading-[18px] whitespace-nowrap text-ink hover:brightness-95 ${
        piece.roundStart ? "rounded-l-[5px]" : ""
      } ${piece.roundEnd ? "rounded-r-[5px]" : ""} ${className}`}
      style={{
        top: FIRST_ROW_TOP + piece.lane * ROW_PX,
        left: `calc(${piece.col} * 100% / 7 + ${l}px)`,
        width: `calc(${piece.span} * 100% / 7 - ${l + r}px)`,
        background: `color-mix(in srgb, ${chipColor(ev)} 18%, transparent)`,
      }}
    >
      {cluster && <DotCluster event={ev} />}
      <span className="truncate">
        {ev.title}
        {!ev.allDay && piece.roundStart ? ` ${timeOf(ev.startsAt)}` : ""}
      </span>
    </button>
  );
}

// 칸 모양은 칸 높이로 고른다 (폴더블.md 4-2): 넓은 화면에서 칸이 [container-type:size] 이고,
// 높이 ≥84px 이면 tall: 로 2줄, ≥110px 이면 taller: 로 3줄. 줄은 위에서부터 여러 날 막대 레인(WeekBar 가 겹쳐 그림, 칸은 자리만) →
// 한 날 일정 칩(디자인규칙.md 2-2) → 넘치면 "+N개 더". 그보다 낮으면(폰, 아이폰 듀오 가로) 4px 막대 + 점 + 제목 한 줄
function DayCell({
  dateKey,
  inMonth,
  isToday,
  isSelected,
  isAnchor,
  events,
  anniversaries,
  week,
  col,
  fit2,
  fit3,
  loading,
  onPick,
  onOpen,
}: {
  dateKey: DateKey;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** 일 상세 패널이 보여 주는 날 (--pri 2px 테두리, #331) */
  isAnchor: boolean;
  events: Event[];
  /** 그날 기념일 항목 (우선순위 순). 칸에는 첫 1개만 (#107) */
  anniversaries: Occurrence[];
  /** 이 칸이 든 주의 막대 레인 (#202) */
  week: PackedWeek<Event>;
  /** 주 안 칸 (0=일) */
  col: number;
  /** 칩 2줄(tall), 3줄(taller) 일 때 이 칸의 칩 자리 */
  fit2: DayFit<Event>;
  fit3: DayFit<Event>;
  loading: boolean;
  onPick: () => void;
  onOpen: (ev: Event) => void;
}) {
  const who = useWho();
  const p = parseKey(dateKey);
  const dow = dowOf(dateKey);
  const holiday = holidayOf(dateKey);
  const red = dow === 0 || dow === 6 || Boolean(holiday);
  // 선택 = 숫자 뒤 원(--sel-fill) + 흰 숫자, 선택 안 된 오늘 = 숫자만 --today-ink (D-57, 칸 면 채움 없음)
  const numClass = isSelected
    ? "bg-sel-fill font-bold text-on-pri"
    : isToday && inMonth
      ? "font-bold text-today-ink"
      : !inMonth
        ? red
          ? "font-medium text-holiday-faint"
          : "font-medium text-faint"
        : red
          ? "font-semibold text-holiday"
          : "font-semibold";
  // 기념일 줄 1개 (N주년 > N일 > 매년/원래 날짜). 공휴일과 겹치면 칸 글자는 기념일, 공휴일은 빨간 숫자로만 (3-6)
  const ann = anniversaries[0] ?? null;
  const annText = ann ? occurrenceCellText(ann) : null;
  const holidayText = ann ? null : holiday;
  const annLabel = anniversaries.length ? `, 기념일 ${anniversaries.map(occurrenceTitle).join(", ")}` : "";
  const label = `${formatDateKo(dateKey, true)}${holiday ? `, ${holiday}` : ""}${annLabel}${events.length ? `, 일정 ${events.length}개` : ""}${isToday ? ", 오늘" : ""}`;

  // 점 모양: 여러 날 일정은 칸을 잇는 4px 막대(주 단위 레인, 최대 2줄), 나머지는 멤버 색 점(5px, 최대 3개, 막대가 있는 날도) + 첫 일정 제목.
  // 기념일/공휴일 줄이 있으면 막대는 1줄. 레인이 모자란 막대 일정은 그날 점으로 (QA3-M2). 일정 하나에 점 하나 + 넘치면 "+N" (#139)
  const lined = Boolean(annText || holidayText);
  const phone = phoneDayLanes(week, col, lined ? 1 : 2);
  const singles = week.singles[col];
  const density = cellDensity([...phone.overflow, ...singles]);
  const hasBar = phone.lanes.length > 0;
  // 숫자 아래 기념일/공휴일 줄 + 막대 + 점이면 칸 높이가 모자란다
  const crowded = hasBar && lined;
  const barHere = phone.lanes.find((s) => s !== null && s.col === col)?.event;
  const labelEvent = barHere ?? [...phone.overflow, ...singles].find((e) => dateKeyOf(e.startsAt) === dateKey || dow === 0) ?? null;
  // 칩 모양: 막대 레인 아래 한 날 일정 칩. tall 2줄, taller 3줄. 넘치면 "+N개 더" 를 칸 높이별로 따로 센다 (month-lanes.ts)
  const shown2 = fit2.chips.length;
  const chips = singles.slice(0, Math.max(shown2, fit3.chips.length));
  const rowsVar = { "--rows2": `${fit2.chipRow * ROW_PX}px`, "--rows3": `${fit3.chipRow * ROW_PX}px` } as React.CSSProperties;

  return (
    <li data-date={dateKey} className="relative h-[52px] border-t border-line fold:h-auto fold:min-h-0 fold:[container-type:size]">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={isSelected}
        aria-expanded={isAnchor || undefined}
        aria-label={label}
        aria-haspopup="dialog"
        className="absolute inset-0 hover:bg-hover/50"
      />
      {isAnchor && <span aria-hidden="true" className="pointer-events-none absolute inset-px rounded-sm border-2 border-pri" />}
      <div className="pointer-events-none relative flex h-full flex-col items-center overflow-hidden px-[3px] pt-1 text-center text-[13px] tall:items-stretch tall:px-1 tall:pb-1 tall:text-left tall:text-[12px]">
        <span className="relative flex max-w-full min-w-0 items-center tall:gap-1">
          <span className={`anim-pick grid size-[26px] shrink-0 place-items-center rounded-full leading-none tall:ml-0.5 tall:size-6 ${numClass}`}>{p.d}</span>
          {holidayText && (
            <span aria-hidden="true" className={`hidden truncate text-[11px] font-medium tall:inline ${inMonth ? "text-holiday" : "text-holiday-faint"}`}>
              {holidayText}
            </span>
          )}
          {/* 기념일도 공휴일처럼 숫자 옆 한 줄 (#202): 칩 줄을 쓰면 주마다 막대 레인 높이가 칸마다 달라진다 */}
          {annText && (
            <span
              aria-hidden="true"
              className={`hidden min-w-0 items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap text-acc-ink tall:flex ${inMonth ? "" : "opacity-60"}`}
            >
              <IconHeart size={11} className="shrink-0" />
              <span className="truncate">{annText}</span>
            </span>
          )}
        </span>
        {holidayText && (
          <span
            aria-hidden="true"
            className={`relative block max-w-full shrink-0 truncate text-[10px] font-medium leading-3 tall:hidden ${inMonth ? "text-holiday" : "text-holiday-faint"}`}
          >
            {holidayText}
          </span>
        )}
        {/* 기념일 줄 (점 모양): 숫자 아래 10px --acc-ink 한 줄. 일정 제목 줄 위 */}
        {annText && (
          <span
            aria-hidden="true"
            className={`relative flex max-w-full shrink-0 items-center justify-center gap-px text-[10px] font-semibold leading-3 text-acc-ink tall:hidden ${inMonth ? "" : "opacity-60"}`}
          >
            {/* 하트로 기념일임을 보인다 (주말 칸에서 공휴일처럼 보이지 않게, #140 L3) */}
            <IconHeart size={8} strokeWidth={2.6} className="shrink-0" />
            <span className="truncate">{annText}</span>
          </span>
        )}

        {/* 점 + 제목 한 줄 */}
        <span aria-hidden="true" className="relative block w-full tall:hidden">
          {loading ? null : (
            <>
              {phone.lanes.map((s, i) => {
                const gap = i === 0 ? "mt-[3px]" : "mt-px";
                if (!s) return <span key={`gap${i}`} className={`${gap} block h-1`} />;
                const start = s.isStart && s.col === col;
                const end = s.isEnd && s.col + s.span - 1 === col;
                return (
                  <span
                    key={s.key}
                    className={`${gap} block h-1 opacity-85 ${start ? "ml-1 rounded-l-[2px]" : "-ml-[3px]"} ${end ? "mr-1 rounded-r-[2px]" : "-mr-[3px]"}`}
                    // 참여자 색을 칸마다 왼쪽에서 오른쪽으로 나눈다 (4px 두께 방향은 안 보인다, D-141)
                    style={{ background: splitBackground(barColors(s.event), "to right") }}
                  />
                );
              })}
              {/* 막대가 있는 날도 그날 다른 일정은 점으로 (QA3-M2). 보통은 막대 아래 한 줄,
                  기념일/공휴일 줄까지 있으면 칸(52)에 넷째 줄이 안 들어가 막대 위에 칸 색 테두리를 두른 점으로 겹친다 */}
              {density.dots.length > 0 && (
                <span
                  className={`${!hasBar ? "mt-0.5" : crowded ? "absolute inset-x-0 top-[3px] h-1" : "mt-px"} flex ${crowded ? "" : "h-[7px]"} items-center justify-center gap-[3px]`}
                >
                  {density.dots.map((c, i) => (
                    <i key={i} className={`block size-[5px] rounded-full ${crowded ? "ring-[1.5px] ring-paper" : ""}`} style={{ background: c }} />
                  ))}
                  {/* +N = 점을 못 그린 일정 수, 숫자 없는 + = 참여자 점만 잘림 (#248 D-140) */}
                  {(density.more > 0 || density.cut) && <b className="text-[9px] font-bold leading-[7px] text-ink-2">+{density.more || ""}</b>}
                </span>
              )}
              {/* 기념일, 공휴일 줄이 있으면 칸 높이가 모자라 일정 제목 줄은 숨긴다 (막대, 점은 유지).
                  공휴일 줄은 shrink-0 이라야 truncate(overflow hidden) 때문에 높이 0 으로 눌려 사라지지 않는다 (#140 L2) */}
              {labelEvent && !annText && !holidayText && <span className="mx-auto mt-px hidden max-w-[94%] truncate fold:block text-[10px] font-medium leading-3 text-ink-2">{labelEvent.title}</span>}
            </>
          )}
        </span>

        {/* 한 날 일정 칩 (제목 + 시간). 위는 여러 날 막대 레인 자리(막대는 WeekBar 가 주 줄 위에 그린다).
            누르면 그날 상세 → 일정 상세 */}
        <span className="relative hidden tall:block" style={rowsVar}>
          <span aria-hidden="true" className="block h-[var(--rows2)] taller:h-[var(--rows3)]" />
          {chips.map((ev, i) => (
            <button
              key={eventKey(ev)}
              type="button"
              onClick={() => onOpen(ev)}
              aria-haspopup="dialog"
              aria-label={withWho(`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
              className={`pointer-events-auto mt-0.5 h-[18px] w-full items-center gap-1 overflow-hidden rounded-[5px] px-1.5 text-left text-[11px] font-medium leading-[18px] whitespace-nowrap text-ink hover:brightness-95 ${
                i < shown2 ? "flex" : "hidden taller:flex"
              }`}
              style={{ background: `color-mix(in srgb, ${chipColor(ev)} 18%, transparent)` }}
            >
              {/* 첫 참여자 색 면 + 참여자 둘 이상이면 제목 앞 점 묶음 (#248 7-2) */}
              {participantColors(ev).length >= 2 && <DotCluster event={ev} />}
              <span className="truncate">
                {ev.title}
                {!ev.allDay && dateKeyOf(ev.startsAt) === dateKey ? ` ${timeOf(ev.startsAt)}` : ""}
              </span>
            </button>
          ))}
          {fit2.more > 0 && <span aria-hidden="true" className="mt-0.5 block truncate whitespace-nowrap px-1 text-[11px] font-medium leading-4 text-ink-2 taller:hidden">+{fit2.more}<span className="@max-[60px]:hidden">개 더</span></span>}
          {fit3.more > 0 && <span aria-hidden="true" className="mt-0.5 hidden truncate whitespace-nowrap px-1 text-[11px] font-medium leading-4 text-ink-2 taller:block">+{fit3.more}<span className="@max-[60px]:hidden">개 더</span></span>}
        </span>
      </div>
    </li>
  );
}
