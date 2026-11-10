"use client";
// 4 달력. 크기와 색은 최종-A-시안.html (D-57), 배치는 docs/설계/폴더블.md (D-58).
// phone(<600): "11월" + 화살표 → 비는 시간/D-day 정보 줄 카드 → 달력 카드 → 다가오는 일정 카드
// fold(600~1023), pc(≥1024): 왼쪽 달력 타일(높이를 채움) | 오른쪽 칸 개요(정보 줄 카드, 다가오는 일정, 이번 주 빈 시간)
// 날짜 칸을 누르면 어느 폭이든 그날 상세가 먼저 뜬다: phone 바텀 시트, fold/pc 날짜 칸 옆 팝오버 (5장).
// 그 안에서 "이 날 일정 추가" → 빠른 추가, 일정 → 일정 상세로 같은 자리에서 바뀐다. 바로 추가는 + 버튼만 맡는다.
// 주소: ?date / ?month 는 replaceState(#81), 날짜 상세 단계는 pushState 로 ?day=1, &event=, &add=1 (5-5)
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { DayPanel, type FreeHint } from "@/components/DayPanel";
import { DayPopover } from "@/components/DayPopover";
import { DaySheet } from "@/components/DaySheet";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconClock, IconHeart, IconPlus } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, Skeleton } from "@/components/ui";
import { messageOf, useAnniversaries, useDeleteEvent, useEvents, useFreeSlots } from "@/hooks";
import {
  dateParam,
  monthParam,
  parseDayStep,
  stepDepth,
  withDayStep,
  withSelection,
  type StepTarget,
} from "@/lib/calendar-url";
import { memberColor } from "@/lib/colors";
import { anniversariesOn, groupByDay, isMultiDayAllDay, upcomingEvents } from "@/lib/day-detail";
import {
  addDays,
  dateKeyOf,
  daysBetween,
  dday,
  dowOf,
  formatDateKo,
  formatEventTime,
  formatMinutes,
  kstToIso,
  monthGrid,
  parseKey,
  shiftMonth,
  startOfWeek,
  timeOf,
  todayKey,
  WEEKDAYS,
  type DateKey,
} from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import type { Event, FreeSlots } from "@/lib/types";
import { useLayout } from "@/lib/useLayout";

type Props = { groupId: number };

const newEventHref = (groupId: number, start: string, end: string) =>
  `/g/${groupId}/events/new?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;

/** 30분 단위로 올림한 지금 (오늘 비는 시간의 시작을 지금 이후로 자른다) */
function nowCeil30(): number {
  const step = 30 * 60_000;
  return Math.ceil(Date.now() / step) * step;
}

/** 지금 이후로 자른 빈 시간 목록 (서버가 과거 구간을 줄 수도 있어서 화면에서 한 번 더 자른다) */
function upcoming(slots: FreeSlots["slots"] | undefined, minMinutes: number) {
  const from = nowCeil30();
  return (slots ?? [])
    .map((s) => ({ startsAt: new Date(Math.max(Date.parse(s.startsAt), from)).toISOString(), endsAt: s.endsAt }))
    .filter((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt) >= minMinutes * 60_000);
}

const nowMs = () => Date.now();

/** 지금 주소의 search 를 바꿔 기록에 쓴다. state 는 null (#57: Next 가 내부 state 를 붙이고 useSearchParams 를 맞춘다) */
function writeSearch(search: string, mode: "push" | "replace") {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function CalendarScreen({ groupId }: Props) {
  const toast = useToast();
  const layout = useLayout();
  const wide = layout !== "phone";
  const { group, openSwitcher } = useGroupContext();
  const today = todayKey();
  // 처음 값은 서버 props 가 아니라 지금 주소에서 읽는다 (#81). 뒤로가기는 Next 가 캐시해 둔 처음 렌더(쿼리 없는 주소)를
  // 다시 쓰므로 서버가 넘긴 날짜는 오늘로 돌아가지만, useSearchParams 는 replaceState 로 바꿔 둔 주소를 돌려준다
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState(() => dateParam(searchParams.get("date")) ?? today);
  const [{ y, m }, setMonth] = useState(() => monthParam(searchParams.get("month")) ?? parseKey(selected));
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* ---------- 날짜 상세 단계 (주소가 원본, 5-5) ---------- */

  const rawStep = useMemo(() => parseDayStep(searchParams, today), [searchParams, today]);
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
  const pending = useRef<{ date: DateKey; eventId?: number } | null>(null);

  // 열린 상세의 날짜를 선택 날짜로 (앞으로가기, 새로고침으로 들어온 경우)
  if (visible && urlStep.date !== selected) {
    setSelected(urlStep.date);
    const p = parseKey(urlStep.date);
    if (p.y !== y || p.m !== m) setMonth({ y: p.y, m: p.m });
  }

  // 새로고침으로 add=1 에 들어오면 빈 폼을 띄우지 않고 날짜 상세로 (5-5). 주소에서도 뗀다.
  // 자식 효과는 Next 앱 라우터의 효과보다 먼저 돌아서, 바로 replaceState 하면 Next 가 그 칸을 모른다. 한 틱 미룬다
  useEffect(() => {
    const t = setTimeout(() => {
      const first = parseDayStep(new URLSearchParams(window.location.search), todayKey());
      if (first.open && first.step === "add") writeSearch(withDayStep(window.location.search, { step: "day", date: first.date }, todayKey()), "replace");
    }, 0);
    return () => clearTimeout(t);
  }, []);


  // 선택 날짜와 보던 달을 URL 에 남긴다 (새로고침, 공유, 뒤로가기 복원 #81, + 버튼의 기준 날짜 #57)
  // router.replace 대신 history.replaceState 를 쓴다. router.replace 는 날짜를 누를 때마다 서버 렌더를 다시 받는다.
  // 뒤로가기로 주소가 바뀐 뒤에도 다시 맞추도록 searchParams 를 같이 본다. day, event, add 는 건드리지 않는다
  useEffect(() => {
    const next = withSelection(window.location.search, selected, today, { y, m });
    if (next !== null) writeSearch(next, "replace");
  }, [selected, today, y, m, searchParams]);

  /* ---------- 데이터 ---------- */

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
  const reload = useCallback(() => {
    void loadEvents();
    void loadUpcoming();
  }, [loadEvents, loadUpcoming]);

  // 기념일은 못 받아도 빈 목록으로 본다 (D-day 줄만 안내로 바뀜)
  const anniversariesQ = useAnniversaries(groupId);
  const { data: anniversaryData, error: anniversaryError } = anniversariesQ;
  const anniversaries = useMemo(
    () => anniversaryData ?? (anniversaryError ? [] : null),
    [anniversaryData, anniversaryError],
  );

  const memberCount = group?.members.length ?? 0;

  // 오늘 모두 비는 시간 (첫 구간) / 이번 주 빈 시간 (넓은 화면 개요 3개)
  const todayFreeQ = useFreeSlots(groupId, {
    from: kstToIso(today),
    to: kstToIso(addDays(today, 1)),
    dayStart: "09:00",
    dayEnd: "23:00",
    minMinutes: 60,
    includeAllDay: false,
  });
  const weekEnd = addDays(startOfWeek(today), 7);
  const weekFreeQ = useFreeSlots(
    groupId,
    { from: kstToIso(today), to: kstToIso(weekEnd), dayStart: "09:00", dayEnd: "23:00", minMinutes: 120, includeAllDay: false },
    { enabled: wide },
  );
  const todayFree = todayFreeQ.data ? (upcoming(todayFreeQ.data.slots, 60)[0] ?? null) : undefined;
  const weekFree = weekFreeQ.data ? upcoming(weekFreeQ.data.slots, 120).slice(0, 3) : null;

  // 날짜 상세의 비는 시간 한 줄: 멤버 2명 이상, 오늘 이후만. 하루 1회, 오늘은 위 값을 다시 쓴다 (5-2)
  const surfaceDate = visible ? urlStep.date : null;
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
    { enabled: surfaceDate !== null && memberCount >= 2 && surfaceDate > today },
  );
  const dayFreeLabel = memberCount === 2 ? "둘 다 비는 시간" : "모두 비는 시간";
  let freeHint: FreeHint = null;
  if (surfaceDate && memberCount >= 2 && surfaceDate >= today) {
    if (surfaceDate === today) {
      if (!todayFreeQ.error) freeHint = { label: dayFreeLabel, slot: todayFree === undefined ? "loading" : todayFree };
    } else if (!dayFreeQ.error) {
      freeHint = { label: dayFreeLabel, slot: dayFreeQ.isLoading || !dayFreeQ.data ? "loading" : (upcoming(dayFreeQ.data.slots, 60)[0] ?? null) };
    }
  }

  const byDay = useMemo(() => groupByDay(events ?? []), [events]);
  const upcomingList = useMemo(
    () => (upcomingQ.data ? upcomingEvents(upcomingQ.data, nowMs(), wide ? 5 : 3) : null),
    [upcomingQ.data, wide],
  );

  // 가장 가까운 기념일 1개
  const nearest = useMemo(() => {
    if (!anniversaries || anniversaries.length === 0) return null;
    return anniversaries
      .map((a) => ({ a, dist: Math.abs(daysBetween(today, a.date)) }))
      .sort((x, y2) => x.dist - y2.dist)[0].a;
  }, [anniversaries, today]);

  const freeLabel = memberCount <= 1 ? "오늘 비는 시간" : memberCount === 2 ? "오늘 둘 다 비는 시간" : "오늘 모두 비는 시간";

  /* ---------- 상세에 넣을 것 ---------- */

  const surfaceEvents = surfaceDate && events ? (byDay.get(surfaceDate) ?? []) : null;
  const surfaceEventId = visible && urlStep.step === "event" ? urlStep.eventId : null;
  const surfaceEvent =
    surfaceEventId === null
      ? undefined
      : (events?.find((e) => e.id === surfaceEventId) ?? upcomingQ.data?.find((e) => e.id === surfaceEventId));
  const eventMissing = surfaceEventId !== null && surfaceEvent === undefined && events !== null && !eventsError && upcomingQ.data !== null;

  /* ---------- 동작 ---------- */

  function go(n: number) {
    setMonth(shiftMonth(y, m, n));
  }
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
    else writeSearch(withDayStep(window.location.search, { step: "closed" }, today), "replace");
  }

  /** 날짜 상세를 연다 (eventId 가 있으면 그 일정 상세까지 두 칸). 이미 열려 있으면 닫고 나서 연다 */
  function openDay(date: DateKey, eventId?: number) {
    if (urlStep.open) {
      pending.current = { date, eventId };
      if (!closing) close();
      return;
    }
    pick(date);
    // 바탕 칸에 고른 날짜를 먼저 남긴다. 뒤로가기로 닫혀도 같은 날짜가 선택돼 있게
    const p = parseKey(date);
    const base = withSelection(window.location.search, date, today, { y: p.y, m: p.m });
    if (base !== null) writeSearch(base, "replace");
    writeSearch(withDayStep(window.location.search, { step: "day", date }, today), "push");
    if (eventId !== undefined) writeSearch(withDayStep(window.location.search, { step: "event", date, eventId }, today), "push");
  }

  // 닫힘이 주소에 반영된 뒤 기다리던 열기를 지금 렌더의 openDay 로 (옛 렌더의 urlStep 을 보지 않게)
  const runPending = useEffectEvent(() => {
    const p = pending.current;
    pending.current = null;
    if (p) openDay(p.date, p.eventId);
  });

  useEffect(() => {
    if (!urlStep.open) {
      // 닫힘이 반영됐다. 기다리던 열기가 있으면 지금
      if (pending.current) queueMicrotask(runPending);
      return;
    }
    // 우리가 쌓은 칸을 다 되돌렸는데 남의 칸(새로고침 주소)이 남아 있으면 떼어 낸다
    if (closing && ownDepth === 0) writeSearch(withDayStep(window.location.search, { step: "closed" }, today), "replace");
  }, [urlStep, closing, ownDepth, today]);

  /** 날짜 상세 안에서 한 단계 더 (일정 상세, 빠른 추가) */
  function forward(target: StepTarget) {
    setIgnoreAdd(false);
    writeSearch(withDayStep(window.location.search, target, today), "push");
  }

  /** ← : 일정 상세/빠른 추가 → 날짜 상세. 우리가 쌓은 칸이면 history.back, 아니면 주소만 바꾼다 */
  function back() {
    if (!urlStep.open) return;
    // 맨 위 칸(일정 상세/빠른 추가)을 우리가 쌓았으면 되돌리고, 새로고침 주소면 바꿔 쓴다
    if (ownDepth >= 1 && stepDepth(urlStep) === 2) window.history.back();
    else writeSearch(withDayStep(window.location.search, { step: "day", date: urlStep.date }, today), "replace");
  }


  // 일정이 없어졌으면(다른 사람이 삭제) 날짜 상세로
  useEffect(() => {
    if (eventMissing && urlStep.open) writeSearch(withDayStep(window.location.search, { step: "day", date: urlStep.date }, today), "replace");
  }, [eventMissing, urlStep, today]);

  function onCell(key: DateKey) {
    // 열린 팝오버의 그 날짜를 다시 누르면 닫는다. 다른 날짜면 닫고 그 날짜로 다시 연다 (5-4)
    if (visible && urlStep.date === key) {
      close();
      return;
    }
    openDay(key);
  }

  function onQuickSaved(ev: Event) {
    close();
    toast.show("일정을 추가했어요");
    pick(dateKeyOf(ev.startsAt));
    reload();
  }

  const remove = useDeleteEvent(groupId);
  async function removeEvent() {
    if (!surfaceEvent) return;
    const r = await remove.mutate(surfaceEvent.id);
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

  const newHref = newEventHref(groupId, kstToIso(selected, "10:00"), kstToIso(selected, "11:00"));
  const showToday = !(selected === today && parseKey(today).m === m && parseKey(today).y === y);
  const thisYear = parseKey(today).y;
  const titleId = useId();

  /* ---------- 조각 ---------- */

  // D-day 정보 줄 (선 아이콘 + 라벨 + 값). 타일 면 없이 카드 안 한 줄 (D-57)
  const ddayRow = (
    <Link href={`/g/${groupId}/anniversaries`} className="flex h-10 items-center gap-2 text-[13px] hover:opacity-80">
      <IconHeart size={16} className="shrink-0 text-acc-ink" />
      {nearest ? (
        <>
          <span className="min-w-0 truncate">{nearest.name}</span>
          <b className="shrink-0 font-bold">{dday(nearest.date, today).label}</b>
        </>
      ) : anniversaries === null ? (
        <Skeleton className="h-3.5 w-32" />
      ) : (
        <span className="text-ink-2">기념일을 등록하면 D-day 가 보여요</span>
      )}
      <IconChevronRight size={14} className="ml-auto shrink-0 text-ink-2" />
    </Link>
  );
  // 오늘 비는 시간 + D-day 를 한 카드의 정보 줄 두 개로 (시안 .strip)
  const infoCard = (
    <div className="rounded-xl bg-paper px-3.5">
      <FreeTile
        label={freeLabel}
        slot={todayFree}
        groupId={groupId}
        onRetry={todayFreeQ.error ? () => void todayFreeQ.refetch() : undefined}
      />
      <div aria-hidden="true" className="h-px bg-line" />
      {ddayRow}
    </div>
  );

  // 다가오는 일정 카드 (phone 달력 아래, 넓은 화면 오른쪽 칸). 누르면 그날 상세 → 일정 상세 두 칸으로 연다
  const upcomingCard = (
    <section aria-labelledby={`${titleId}-up`} className="rounded-xl bg-paper px-3.5 pb-1.5 pt-1">
      <h2 id={`${titleId}-up`} className="t-sec">
        다가오는 일정
      </h2>
      {upcomingQ.error ? (
        <p className="pb-2 text-[13px] text-ink-2">일정을 불러오지 못했어요</p>
      ) : upcomingList === null ? (
        <div className="space-y-2 pb-2" aria-busy="true" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : upcomingList.length === 0 ? (
        <p className="pb-2 text-[13px] text-ink-2">앞으로 한 달 동안 잡힌 일정이 없어요. + 로 추가해 보세요</p>
      ) : (
        <ul>
          {upcomingList.map((ev) => {
            const k = dateKeyOf(Math.max(Date.parse(ev.startsAt), Date.parse(kstToIso(today))));
            const p = parseKey(k);
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => openDay(k, ev.id)}
                  aria-haspopup="dialog"
                  aria-label={`${formatDateKo(k)} ${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, ${ev.creator.displayName}`}
                  className="-mx-1.5 flex min-h-11 w-[calc(100%+12px)] items-stretch gap-2.5 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
                >
                  <span aria-hidden="true" className="flex w-7 shrink-0 flex-col items-center justify-center leading-none">
                    <small className={`text-[11px] ${k === today ? "font-bold text-today-ink" : "text-ink-2"}`}>{k === today ? "오늘" : WEEKDAYS[dowOf(k)]}</small>
                    <b className="mt-0.5 text-[16px] font-bold">{p.d}</b>
                  </span>
                  <i aria-hidden="true" className="my-1 block w-[3px] shrink-0 rounded-[2px]" style={{ background: memberColor(ev.creator.color) }} />
                  <span aria-hidden="true" className="min-w-0 flex-1 self-center">
                    <b className="block truncate text-[15px] font-semibold leading-5">{ev.title}</b>
                    <span className="block truncate text-[12px] leading-4 text-ink-2">
                      {formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, {ev.creator.displayName}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const weekCard = (
    <section aria-labelledby={`${titleId}-wk`} className="rounded-xl bg-paper px-3.5 pb-2 pt-1">
      <h2 id={`${titleId}-wk`} className="t-sec">
        이번 주 빈 시간
      </h2>
      {weekFreeQ.error ? (
        <p className="text-[13px] text-ink-2">빈 시간을 계산하지 못했어요</p>
      ) : weekFree === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      ) : weekFree.length === 0 ? (
        <p className="text-[13px] text-ink-2">
          이번 주에는 두 시간 이상 모두 비는 때가 없어요.{" "}
          <Link href={`/g/${groupId}/free`} className="underline underline-offset-2">
            조건 바꿔 찾기
          </Link>
        </p>
      ) : (
        <ul>
          {weekFree.map((s) => {
            const k = dateKeyOf(s.startsAt);
            const p = parseKey(k);
            const mins = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
            return (
              <li key={s.startsAt}>
                <Link
                  href={newEventHref(groupId, s.startsAt, s.endsAt)}
                  className="-mx-1.5 flex min-h-9 items-center gap-2 rounded-sm px-1.5 text-[13px] hover:bg-hover"
                >
                  <span className="w-[68px] shrink-0">
                    {WEEKDAYS[dowOf(k)]} {p.m}/{p.d}
                  </span>
                  <b className="font-bold text-acc-ink">
                    {timeOf(s.startsAt)}~{timeOf(s.endsAt)}
                  </b>
                  <span className="ml-auto text-[12px] text-ink-2">{formatMinutes(mins)}</span>
                </Link>
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
      free={freeHint}
      event={surfaceEvent}
      onClose={close}
      onBack={back}
      onAdd={() => forward({ step: "add", date: surfaceDate })}
      onOpenEvent={(ev) => forward({ step: "event", date: surfaceDate, eventId: ev.id })}
      onSaved={onQuickSaved}
      onDelete={() => setConfirmDelete(true)}
    />
  ) : null;

  return (
    <div className="fold:grid fold:h-dvh fold:grid-cols-[minmax(0,1fr)_272px] fold:gap-2 fold:px-4 fold:pb-4 fold:pt-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* 왼쪽: 월 헤더 + 달력 */}
      <section className="flex flex-col fold:min-h-0">
        {/* 월 헤더: (레일 폭이면 팀 이름) "11월" 20/28 700 + 좌우 화살표 한 줄, 연도는 다른 해일 때만 (시안 .mh) */}
        <div className="flex items-center gap-1 pb-2 pt-1 fold:h-10 fold:p-0">
          <button
            type="button"
            onClick={openSwitcher}
            aria-haspopup="dialog"
            className="mr-2 hidden h-9 min-w-0 max-w-[40%] items-center gap-1 rounded-sm text-[16px] font-bold leading-6 fold:flex wide:hidden"
          >
            {group ? (
              <>
                <span className="truncate">{group.name}</span>
                <IconChevronDown size={16} className="shrink-0 text-ink-2" />
                <span className="sr-only">팀 바꾸기</span>
              </>
            ) : (
              <Skeleton className="h-4 w-16" />
            )}
          </button>
          <h1 aria-label={`${y}년 ${m}월`} className="mr-1 text-[20px] font-bold leading-7 tracking-[-0.02em]">
            {y !== thisYear ? `${y}년 ${m}월` : `${m}월`}
          </h1>
          <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="grid size-8 place-items-center rounded-sm hover:bg-hover">
            <IconChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="다음 달" className="grid size-8 place-items-center rounded-sm hover:bg-hover">
            <IconChevronRight size={18} />
          </button>
          <span className="flex-1" />
          {/* phone 은 오늘에서 벗어났을 때만, 넓은 화면은 항상. 아이콘 버튼 중 오늘만 면 */}
          <button
            type="button"
            onClick={goToday}
            className={`h-8 place-items-center rounded-sm bg-paper px-3 text-[13px] font-bold ${showToday ? "grid" : "hidden fold:grid"}`}
          >
            오늘
          </button>
          {/* 사이드바 폭(≥1200)은 + 가 없어서 여기 둔다. 레일 폭은 레일 + 가 맡는다 */}
          <Link
            href={newHref}
            className="ml-1.5 hidden h-8 items-center gap-1 rounded-sm bg-btn px-3 text-[13px] font-bold text-on-btn hover:brightness-95 wide:flex"
          >
            <IconPlus size={16} strokeWidth={2.2} />
            일정 추가
          </Link>
        </div>

        {/* phone: 비는 시간 + D-day 정보 줄 카드 */}
        <div className="mb-2 fold:hidden">{infoCard}</div>

        {/* 달력 타일 */}
        <div className="rounded-xl bg-paper px-1.5 pb-1 fold:mt-2 fold:flex fold:min-h-0 fold:flex-1 fold:flex-col">
          <div aria-hidden="true" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={i === 0 || i === 6 ? "text-holiday" : ""}>
                {w}
              </span>
            ))}
          </div>
          <ul aria-label={`${y}년 ${m}월 날짜`} className="grid grid-cols-7 fold:min-h-0 fold:flex-1 fold:auto-rows-fr">
            {grid.map((key) => (
              <DayCell
                key={key}
                dateKey={key}
                inMonth={parseKey(key).m === m}
                isToday={key === today}
                isSelected={key === selected}
                isAnchor={wide && visible && urlStep.date === key}
                events={byDay.get(key) ?? []}
                loading={events === null}
                onPick={() => onCell(key)}
                onOpen={(ev) => openDay(key, ev.id)}
              />
            ))}
          </ul>
        </div>

        {/* phone: 다가오는 일정 (선택일 목록 대신. 그날 내용은 날짜 상세 시트가 보여 준다) */}
        <div className="mt-2 fold:hidden">{upcomingCard}</div>
      </section>

      {/* 넓은 화면 오른쪽 칸: 개요 (선택 날짜와 묶이지 않는다, 5-1 권장안 A) */}
      <aside aria-label="개요" className="hidden min-h-0 flex-col gap-2 overflow-y-auto fold:mt-12 fold:flex">
        {infoCard}
        {upcomingCard}
        {weekCard}
      </aside>

      {/* 날짜 상세: phone 바텀 시트, 넓은 화면 날짜 칸 옆 팝오버. 폭이 바뀌면 같은 상태로 표면만 바뀐다 */}
      {visible &&
        panel &&
        (wide ? (
          <DayPopover anchorDate={urlStep.date} titleId={titleId} onClose={close} paused={confirmDelete}>
            {panel}
          </DayPopover>
        ) : (
          <DaySheet titleId={titleId} onClose={close} paused={confirmDelete}>
            {panel}
          </DaySheet>
        ))}

      <ConfirmDialog
        open={confirmDelete}
        title="이 일정을 삭제할까요?"
        body="팀원 모두에게서 사라져요"
        confirmLabel="삭제"
        danger
        loading={remove.isPending}
        onConfirm={removeEvent}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

/* ---------- 오늘 비는 시간 정보 줄 (면 없이 아이콘 + 라벨 + --acc-ink 값, D-57) ---------- */

function FreeTile({
  label,
  slot,
  groupId,
  onRetry,
}: {
  label: string;
  slot: { startsAt: string; endsAt: string } | null | undefined;
  groupId: number;
  onRetry?: () => void;
}) {
  const cls = "flex h-10 w-full items-center gap-2 text-left text-[13px] hover:opacity-80";
  const icon = <IconClock size={16} className="shrink-0 text-acc-ink" />;
  const go = <IconChevronRight size={14} className="ml-auto shrink-0 text-ink-2" />;
  if (onRetry && slot === undefined) {
    return (
      <button type="button" onClick={onRetry} className={cls}>
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <b className="shrink-0 font-bold text-ink-2">계산 실패, 다시 시도</b>
      </button>
    );
  }
  if (slot === undefined) {
    return (
      <div className={cls} aria-busy="true">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <Skeleton className="h-3.5 w-20" />
      </div>
    );
  }
  if (slot === null) {
    return (
      <Link href={`/g/${groupId}/free`} className={cls}>
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        <b className="shrink-0 font-bold text-ink-2">없어요, 다른 날 찾기</b>
        {go}
      </Link>
    );
  }
  return (
    <Link
      href={newEventHref(groupId, slot.startsAt, slot.endsAt)}
      aria-label={`${label} ${timeOf(slot.startsAt)}부터 ${timeOf(slot.endsAt)}까지, 눌러서 바로 약속 잡기`}
      className={cls}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      <b className="shrink-0 font-bold text-acc-ink">
        {timeOf(slot.startsAt)}~{timeOf(slot.endsAt)}
      </b>
      {go}
    </Link>
  );
}

/* ---------- 날짜 칸 ---------- */

// 칸 모양은 칸 높이로 고른다 (폴더블.md 4-2): 넓은 화면에서 칸이 [container-type:size] 이고,
// 높이 ≥110px(폴드 세로, PC) 이면 tall: 로 제목 칩, 아니면(폰, 아이폰 듀오 가로) 점 + 제목 한 줄
function DayCell({
  dateKey,
  inMonth,
  isToday,
  isSelected,
  isAnchor,
  events,
  loading,
  onPick,
  onOpen,
}: {
  dateKey: DateKey;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** 팝오버가 붙어 있는 칸 (--pri 2px 테두리) */
  isAnchor: boolean;
  events: Event[];
  loading: boolean;
  onPick: () => void;
  onOpen: (ev: Event) => void;
}) {
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
  const label = `${formatDateKo(dateKey, true)}${holiday ? `, ${holiday}` : ""}${events.length ? `, 일정 ${events.length}개` : ""}${isToday ? ", 오늘" : ""}`;

  // 점 모양: 여러 날 종일 일정은 칸을 잇는 4px 막대, 나머지는 멤버 색 점(5px, 최대 3개) + 첫 일정 제목
  const band = events.find(isMultiDayAllDay) ?? null;
  const bandStart = band ? dateKeyOf(band.startsAt) === dateKey : false;
  const bandEnd = band ? addDays(dateKeyOf(band.endsAt), -1) === dateKey : false;
  const rest = events.filter((e) => e !== band);
  const colors = Array.from(new Set(rest.map((e) => e.creator.color))).slice(0, 3);
  const labelEvent = band && (bandStart || dow === 0) ? band : (rest.find((e) => dateKeyOf(e.startsAt) === dateKey || dow === 0) ?? null);
  // 칩 모양: 최대 3개
  const chips = events.slice(0, 3);
  const more = events.length - chips.length;

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
        <span className="relative flex items-center tall:gap-1">
          <span className={`anim-pick grid size-[26px] place-items-center rounded-full leading-none tall:ml-0.5 tall:size-6 ${numClass}`}>{p.d}</span>
          {holiday && (
            <span aria-hidden="true" className={`hidden truncate text-[11px] font-medium tall:inline ${inMonth ? "text-holiday" : "text-holiday-faint"}`}>
              {holiday}
            </span>
          )}
        </span>
        {holiday && (
          <span
            aria-hidden="true"
            className={`relative block max-w-full truncate text-[10px] font-medium leading-3 tall:hidden ${inMonth ? "text-holiday" : "text-holiday-faint"}`}
          >
            {holiday}
          </span>
        )}

        {/* 점 + 제목 한 줄 */}
        <span aria-hidden="true" className="relative block w-full tall:hidden">
          {loading ? null : (
            <>
              {band && (
                <span
                  className={`mt-[3px] block h-1 opacity-85 ${bandStart ? "ml-1 rounded-l-[2px]" : "-ml-[3px]"} ${bandEnd ? "mr-1 rounded-r-[2px]" : "-mr-[3px]"}`}
                  style={{ background: memberColor(band.creator.color) }}
                />
              )}
              {!band && colors.length > 0 && (
                <span className="mt-0.5 flex h-[5px] justify-center gap-[3px]">
                  {colors.map((c) => (
                    <i key={c} className="block size-[5px] rounded-full" style={{ background: memberColor(c) }} />
                  ))}
                </span>
              )}
              {labelEvent && <span className="mx-auto mt-px block max-w-[94%] truncate text-[10px] font-medium leading-3 text-ink-2">{labelEvent.title}</span>}
            </>
          )}
        </span>

        {/* 제목 칩 (색 점 + 제목 + 시간), 여러 날 종일은 멤버 색 16% 면. 누르면 그날 상세 → 일정 상세 */}
        <span className="relative hidden tall:block">
          {chips.map((ev) => {
            const isBand = isMultiDayAllDay(ev);
            const style = isBand ? { background: `color-mix(in srgb, ${memberColor(ev.creator.color)} 16%, transparent)` } : undefined;
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onOpen(ev)}
                aria-haspopup="dialog"
                aria-label={`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, ${ev.creator.displayName}`}
                className={`pointer-events-auto mt-0.5 flex w-full items-center gap-1 overflow-hidden rounded-xs px-1 py-px text-left text-[11px] font-medium leading-4 whitespace-nowrap ${isBand ? "" : "hover:bg-hover"}`}
                style={style}
              >
                <i aria-hidden="true" className="block size-1.5 shrink-0 rounded-full" style={{ background: memberColor(ev.creator.color) }} />
                <span className="truncate">
                  {ev.title}
                  {!ev.allDay && dateKeyOf(ev.startsAt) === dateKey ? ` ${timeOf(ev.startsAt)}` : ""}
                </span>
              </button>
            );
          })}
          {more > 0 && <span aria-hidden="true" className="mt-0.5 block px-1 text-[11px] font-medium text-ink-2">+{more}개 더</span>}
        </span>
      </div>
    </li>
  );
}
