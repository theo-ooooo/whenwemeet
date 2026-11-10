"use client";
// 4 달력. 배치는 디자인-2026*.html 그대로, 크기와 색은 최종-A-시안.html (D-57, 밀도 조정 + 색 A).
// 모바일: "11월" + 화살표 한 줄 → 비는 시간/D-day 정보 줄 카드 → 달력 카드 → 선택일 목록 카드. 일정 탭 → 바텀 시트
// PC: 가운데 큰 달력(칸 안 일정 칩) + 우측 패널(정보 줄 카드, 선택일 일정 또는 일정 상세, 이번 주 빈 시간)
// 바로 추가(#46): 모바일은 선택된 날짜 재탭 = 빠른 추가 시트, PC 는 날짜 칸 빈 곳 클릭 = 칸 옆 팝오버
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconClock, IconClose, IconHeart, IconPlus } from "@/components/icons";
import { QuickAddPopover, QuickAddSheet } from "@/components/QuickAdd";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, ErrorState, Skeleton } from "@/components/ui";
import { messageOf, useAnniversaries, useDeleteEvent, useEvents, useFreeSlots } from "@/hooks";
import { memberColor } from "@/lib/colors";
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
  toKst,
  WEEKDAYS,
  type DateKey,
} from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import { iGa } from "@/lib/text";
import type { Event, FreeSlots } from "@/lib/types";
import { useIsDesktop } from "@/lib/useIsDesktop";

type Props = { groupId: number };

/** 쿼리의 날짜(YYYY-MM-DD)를 검사한다. 2026-02-31 처럼 없는 날은 버린다 */
function dateParam(raw: string | null): DateKey | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const { y, m, d } = parseKey(raw);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? raw : null;
}

/** 쿼리의 보던 달(YYYY-MM) */
function monthParam(raw: string | null): { y: number; m: number } | null {
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return null;
  const [y, m] = raw.split("-").map(Number);
  return { y, m };
}

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

const isMultiDayAllDay = (ev: Event) => ev.allDay && daysBetween(dateKeyOf(ev.startsAt), dateKeyOf(ev.endsAt)) > 1;

export function CalendarScreen({ groupId }: Props) {
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const { group } = useGroupContext();
  const today = todayKey();
  // 처음 값은 서버 props 가 아니라 지금 주소에서 읽는다 (#81). 뒤로가기는 Next 가 캐시해 둔 처음 렌더(쿼리 없는 주소)를
  // 다시 쓰므로 서버가 넘긴 날짜는 오늘로 돌아가지만, useSearchParams 는 replaceState 로 바꿔 둔 주소를 돌려준다
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState(() => dateParam(searchParams.get("date")) ?? today);
  const [{ y, m }, setMonth] = useState(() => monthParam(searchParams.get("month")) ?? parseKey(selected));
  const [detail, setDetail] = useState<Event | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeDetail = useCallback(() => setDetail(null), []);
  // 빠른 추가: 날짜와 (PC 팝오버를 붙일) 날짜 칸
  const [quick, setQuick] = useState<{ date: DateKey; anchor: HTMLElement | null } | null>(null);
  const closeQuick = useCallback(() => setQuick(null), []);

  // 6주 그리드. 마지막 주가 통째로 다음 달이면 5주만 그린다 (목업처럼)
  const grid42 = useMemo(() => monthGrid(y, m), [y, m]);
  const grid = useMemo(() => (parseKey(grid42[35]).m !== m ? grid42.slice(0, 35) : grid42), [grid42, m]);

  // 일 목록은 세 상태 중 하나: 로딩(events=null, 오류 없음) / 오류(eventsError) / 준비됨(events 배열, 비어 있으면 빈 상태)
  // 늦게 온 응답이 최신 상태를 덮지 않는 것, 오류에도 직전 값을 유지하는 것은 훅이 보장한다 (#18)
  const eventsQ = useEvents(groupId, { from: kstToIso(grid42[0]), to: kstToIso(addDays(grid42[41], 1)) });
  const events = eventsQ.data;
  const eventsError = eventsQ.error ? messageOf(eventsQ.error, "일정을 불러오지 못했어요") : null;
  const loadEvents = eventsQ.refetch;

  // 기념일은 못 받아도 빈 목록으로 본다 (D-day 타일만 안내로 바뀜)
  const anniversariesQ = useAnniversaries(groupId);
  const { data: anniversaryData, error: anniversaryError } = anniversariesQ;
  const anniversaries = useMemo(
    () => anniversaryData ?? (anniversaryError ? [] : null),
    [anniversaryData, anniversaryError],
  );

  // 오늘 모두 비는 시간 (첫 구간) / 이번 주 빈 시간 (PC 우측 패널 3개)
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
    { enabled: isDesktop },
  );
  const todayFree = todayFreeQ.data ? (upcoming(todayFreeQ.data.slots, 60)[0] ?? null) : undefined;
  const weekFree = weekFreeQ.data ? upcoming(weekFreeQ.data.slots, 120).slice(0, 3) : null;

  // 선택 날짜와 보던 달을 URL 에 남긴다 (새로고침, 공유, 뒤로가기 복원 #81, + 버튼의 기준 날짜 #57)
  // date 는 오늘이 아닐 때만, month 는 선택 날짜와 다른 달을 볼 때만 붙여 기본 주소(/calendar)를 깨끗하게 둔다
  // router.replace 대신 history.replaceState 를 쓴다. router.replace 는 날짜를 누를 때마다 서버 렌더를 다시 받는다.
  // state 는 null 로 넘긴다. Next 내부 state(__NA)를 그대로 넘기면 Next 가 내부 호출로 보고 useSearchParams 를 갱신하지 않아
  // AppShell 의 + 버튼이 처음 연 날짜에 머문다 (#57). null 이면 Next 가 내부 state 를 복사해 붙이고 쿼리를 동기화한다
  useEffect(() => {
    const url = new URL(window.location.href);
    const sel = parseKey(selected);
    const date = selected === today ? null : selected;
    const month = sel.y === y && sel.m === m ? null : `${y}-${String(m).padStart(2, "0")}`;
    if (url.searchParams.get("date") === date && url.searchParams.get("month") === month) return;
    if (date) url.searchParams.set("date", date);
    else url.searchParams.delete("date");
    if (month) url.searchParams.set("month", month);
    else url.searchParams.delete("month");
    window.history.replaceState(null, "", url);
  }, [selected, today, y, m]);

  // 날짜별 일정 (겹치는 모든 날에 넣는다). 여러 날 종일 → 종일 → 시각 순
  const byDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    if (!events) return map;
    for (const ev of events) {
      const startKey = dateKeyOf(ev.startsAt);
      const endKeyExclusive = dateKeyOf(new Date(ev.endsAt).getTime() - 1);
      let k = startKey;
      while (k <= endKeyExclusive) {
        const arr = map.get(k) ?? [];
        arr.push(ev);
        map.set(k, arr);
        k = addDays(k, 1);
      }
    }
    const rank = (e: Event) => (isMultiDayAllDay(e) ? 0 : e.allDay ? 1 : 2);
    for (const arr of map.values()) arr.sort((a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [events]);

  const dayEvents = byDay.get(selected) ?? [];

  // 가장 가까운 기념일 1개
  const nearest = useMemo(() => {
    if (!anniversaries || anniversaries.length === 0) return null;
    return anniversaries
      .map((a) => ({ a, dist: Math.abs(daysBetween(today, a.date)) }))
      .sort((x, y2) => x.dist - y2.dist)[0].a;
  }, [anniversaries, today]);

  const memberCount = group?.members.length ?? 0;
  const freeLabel = memberCount <= 1 ? "오늘 비는 시간" : memberCount === 2 ? "오늘 둘 다 비는 시간" : "오늘 모두 비는 시간";

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

  /** 날짜 칸을 눌렀을 때. 모바일은 1탭 선택, 선택된 칸 재탭 = 빠른 추가. PC 는 선택 + 칸 옆 팝오버 */
  function onCell(key: DateKey, cell: HTMLElement) {
    if (isDesktop) {
      pick(key);
      setQuick({ date: key, anchor: cell });
      return;
    }
    if (key === selected) setQuick({ date: key, anchor: null });
    else pick(key);
  }
  function openQuick(key: DateKey) {
    const cell = isDesktop ? document.querySelector<HTMLElement>(`[data-date="${key}"]`) : null;
    setQuick({ date: key, anchor: cell });
  }
  function onQuickSaved(ev: Event) {
    setQuick(null);
    toast.show("일정을 추가했어요");
    pick(dateKeyOf(ev.startsAt));
    void loadEvents();
  }

  const remove = useDeleteEvent(groupId);
  async function removeEvent() {
    if (!detail) return;
    const r = await remove.mutate(detail.id);
    setConfirmDelete(false);
    if (!r.ok) {
      if (r.error.status === 404) {
        toast.show("이미 삭제된 일정이에요");
        setDetail(null);
        void loadEvents();
        return;
      }
      toast.show(messageOf(r.error, "삭제하지 못했어요. 다시 시도해 주세요"));
      return;
    }
    toast.show("일정을 삭제했어요");
    setDetail(null);
    void loadEvents();
  }

  const newHref = newEventHref(groupId, kstToIso(selected, "10:00"), kstToIso(selected, "11:00"));
  const showToday = !(selected === today && parseKey(today).m === m && parseKey(today).y === y);
  const thisYear = parseKey(today).y;

  /* ---------- 조각 ---------- */

  const freeTile = (
    <FreeTile
      label={freeLabel}
      slot={todayFree}
      groupId={groupId}
      onRetry={todayFreeQ.error ? () => void todayFreeQ.refetch() : undefined}
    />
  );
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
      {freeTile}
      <div aria-hidden="true" className="h-px bg-line" />
      {ddayRow}
    </div>
  );

  const dayHeading = (() => {
    const p = parseKey(selected);
    const base = `${p.d}일 ${WEEKDAYS[dowOf(selected)]}요일`;
    return p.m !== m || p.y !== y ? `${p.m}월 ${base}` : base;
  })();

  const dayList = (
    <>
      <h2 className="t-sec">
        {dayHeading}
        {selected === today && <em className="text-[12px] font-bold not-italic text-today-ink">오늘</em>}
        {holidayOf(selected) && <span className="text-[12px] font-medium text-holiday">{holidayOf(selected)}</span>}
      </h2>
      {eventsError ? (
        <div className="mt-1">
          <ErrorState message={eventsError} onRetry={loadEvents} />
        </div>
      ) : events === null ? (
        <div className="space-y-2 py-1" aria-busy="true" aria-label="불러오는 중">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-11 items-center gap-2.5">
              <Skeleton className="h-8 w-[3px] rounded-[2px]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : dayEvents.length === 0 ? (
        <div className="flex flex-col gap-2 pb-1.5">
          <p className="py-1 text-[14px] text-ink-2">이 날은 아직 일정이 없어요. 바로 추가해 보세요</p>
          <button
            type="button"
            onClick={() => openQuick(selected)}
            aria-haspopup="dialog"
            className="flex h-11 items-center justify-center gap-1.5 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
          >
            <IconPlus size={16} strokeWidth={2.2} />이 날 일정 추가
          </button>
        </div>
      ) : (
        <ul>
          {dayEvents.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => setDetail(ev)}
                aria-haspopup="dialog"
                className="flex min-h-11 w-full items-stretch gap-2.5 rounded-sm py-1 text-left hover:bg-hover/60"
              >
                <i aria-hidden="true" className="my-1 block w-[3px] shrink-0 rounded-[2px]" style={{ background: memberColor(ev.creator.color) }} />
                <span className="min-w-0 flex-1 self-center">
                  <b className="block truncate text-[15px] font-semibold leading-5">{ev.title}</b>
                  <span className="block text-[12px] leading-4 text-ink-2">{formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}</span>
                </span>
                <span className="ml-auto shrink-0 self-center text-[12px] text-ink-2">{ev.creator.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-2 lg:px-4 lg:pb-4 lg:pt-3.5">
      {/* 가운데: 월 헤더 + 달력 */}
      <section className="flex flex-col lg:min-h-0">
        {/* 월 헤더: "11월" 20/28 700 + 좌우 화살표 한 줄, 연도는 다른 해일 때만 (시안 .mh) */}
        <div className="flex items-center gap-1 pb-2 pt-1 lg:h-10 lg:p-0">
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
          {/* 모바일은 오늘에서 벗어났을 때만, PC 는 항상. 아이콘 버튼 중 오늘만 면 */}
          <button
            type="button"
            onClick={goToday}
            className={`h-8 place-items-center rounded-sm bg-paper px-3 text-[13px] font-bold ${showToday ? "grid" : "hidden lg:grid"}`}
          >
            오늘
          </button>
          <Link
            href={newHref}
            className="ml-1.5 hidden h-8 items-center gap-1 rounded-sm bg-btn px-3 text-[13px] font-bold text-on-btn hover:brightness-95 lg:flex"
          >
            <IconPlus size={16} strokeWidth={2.2} />
            일정 추가
          </Link>
        </div>

        {/* 모바일: 비는 시간 + D-day 정보 줄 카드 */}
        <div className="mb-2 lg:hidden">{infoCard}</div>

        {/* 달력 타일 */}
        <div className="rounded-xl bg-paper px-1.5 pb-1 lg:mt-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <div aria-hidden="true" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={i === 0 || i === 6 ? "text-holiday" : ""}>
                {w}
              </span>
            ))}
          </div>
          <ul
            aria-label={`${y}년 ${m}월 날짜`}
            className="grid grid-cols-7 lg:min-h-0 lg:flex-1 lg:auto-rows-fr"
          >
            {grid.map((key) => (
              <DayCell
                key={key}
                dateKey={key}
                inMonth={parseKey(key).m === m}
                isToday={key === today}
                isSelected={key === selected}
                isDesktop={isDesktop}
                events={byDay.get(key) ?? []}
                loading={events === null}
                onPick={(cell) => onCell(key, cell)}
                onOpen={(ev) => {
                  pick(key);
                  setDetail(ev);
                }}
              />
            ))}
          </ul>
        </div>

        {/* 모바일 선택일 목록 */}
        <section aria-live="polite" className="mt-2 rounded-xl bg-paper px-3.5 pb-1.5 pt-1 lg:hidden">
          {dayList}
        </section>
      </section>

      {/* PC 우측 패널 */}
      <aside className="hidden min-h-0 flex-col gap-2 overflow-y-auto lg:mt-12 lg:flex">
        {infoCard}
        <section aria-live="polite" className="flex-1 rounded-xl bg-paper px-3.5 pb-3 pt-1.5">
          {detail && isDesktop ? (
            <EventDetail
              key={detail.id}
              event={detail}
              groupId={groupId}
              onClose={() => setDetail(null)}
              onDelete={() => setConfirmDelete(true)}
              panel
            />
          ) : (
            <>
              {dayList}
              <h2 className="t-sec mt-1">이번 주 빈 시간</h2>
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
            </>
          )}
        </section>
      </aside>

      {/* 모바일 일정 상세 시트 */}
      {detail && !isDesktop && (
        <DetailSheet onClose={closeDetail}>
          {(titleId) => (
            <EventDetail
              event={detail}
              groupId={groupId}
              titleId={titleId}
              onClose={() => setDetail(null)}
              onDelete={() => setConfirmDelete(true)}
            />
          )}
        </DetailSheet>
      )}

      {/* 빠른 추가 */}
      {quick &&
        (isDesktop ? (
          <QuickAddPopover key={quick.date} groupId={groupId} date={quick.date} anchor={quick.anchor} onClose={closeQuick} onSaved={onQuickSaved} />
        ) : (
          <QuickAddSheet key={quick.date} groupId={groupId} date={quick.date} onClose={closeQuick} onSaved={onQuickSaved} />
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

function DayCell({
  dateKey,
  inMonth,
  isToday,
  isSelected,
  isDesktop,
  events,
  loading,
  onPick,
  onOpen,
}: {
  dateKey: DateKey;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDesktop: boolean;
  events: Event[];
  loading: boolean;
  /** 칸(li)을 넘긴다. PC 팝오버를 그 옆에 붙인다 */
  onPick: (cell: HTMLElement) => void;
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
  const hint = isDesktop ? ", 눌러서 일정 추가" : isSelected ? ", 한 번 더 누르면 일정 추가" : "";
  const label = `${formatDateKo(dateKey, true)}${holiday ? `, ${holiday}` : ""}${events.length ? `, 일정 ${events.length}개` : ""}${isToday ? ", 오늘" : ""}${hint}`;

  // 모바일: 여러 날 종일 일정은 칸을 잇는 4px 막대, 나머지는 멤버 색 점(5px, 최대 3개) + 첫 일정 제목
  const band = events.find(isMultiDayAllDay) ?? null;
  const bandStart = band ? dateKeyOf(band.startsAt) === dateKey : false;
  const bandEnd = band ? addDays(dateKeyOf(band.endsAt), -1) === dateKey : false;
  const rest = events.filter((e) => e !== band);
  const colors = Array.from(new Set(rest.map((e) => e.creator.color))).slice(0, 3);
  const labelEvent = band && (bandStart || dow === 0) ? band : (rest.find((e) => dateKeyOf(e.startsAt) === dateKey || dow === 0) ?? null);
  // PC: 칩 최대 3개
  const chips = events.slice(0, 3);
  const more = events.length - chips.length;

  return (
    <li
      data-date={dateKey}
      className="anim-pick relative flex h-[52px] flex-col items-center overflow-hidden border-t border-line px-[3px] pt-1 text-center text-[13px] lg:h-auto lg:min-h-0 lg:items-stretch lg:px-1 lg:pb-1 lg:text-left lg:text-[12px]"
    >
      <button
        type="button"
        onClick={(e) => onPick(e.currentTarget.parentElement as HTMLElement)}
        aria-pressed={isSelected}
        aria-label={label}
        aria-haspopup={isDesktop || isSelected ? "dialog" : undefined}
        className="absolute inset-0 hover:bg-hover/50"
      />
      <span className="pointer-events-none relative flex items-center lg:gap-1">
        <span className={`anim-pick grid size-[26px] place-items-center rounded-full leading-none lg:ml-0.5 lg:size-6 ${numClass}`}>{p.d}</span>
        {holiday && (
          <span
            aria-hidden="true"
            className={`hidden truncate text-[11px] font-medium lg:inline ${inMonth ? "text-holiday" : "text-holiday-faint"}`}
          >
            {holiday}
          </span>
        )}
      </span>
      {holiday && (
        <span
          aria-hidden="true"
          className={`pointer-events-none relative block max-w-full truncate text-[10px] font-medium leading-3 lg:hidden ${inMonth ? "text-holiday" : "text-holiday-faint"}`}
        >
          {holiday}
        </span>
      )}

      {/* 모바일 표시 */}
      <span aria-hidden="true" className="pointer-events-none relative block w-full lg:hidden">
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

      {/* PC 표시: 일정 칩 (색 점 + 제목 + 시간), 여러 날 종일은 멤버 색 16% 면 */}
      <span className="relative hidden lg:block">
        {chips.map((ev) => {
          const isBand = isMultiDayAllDay(ev);
          const style = isBand ? { background: `color-mix(in srgb, ${memberColor(ev.creator.color)} 16%, transparent)` } : undefined;
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => onOpen(ev)}
              aria-label={`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, ${ev.creator.displayName}`}
              className={`mt-0.5 flex w-full items-center gap-1 overflow-hidden rounded-xs px-1 py-px text-left text-[11px] font-medium leading-4 whitespace-nowrap ${isBand ? "" : "hover:bg-hover"}`}
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
        {more > 0 && (
          <span aria-hidden="true" className="pointer-events-none mt-0.5 block px-1 text-[11px] font-medium text-ink-2">
            +{more}개 더
          </span>
        )}
      </span>
    </li>
  );
}

/* ---------- 일정 상세 ---------- */

/** 'M월 D일 HH:mm' */
function stamp(iso: string): string {
  const t = toKst(iso);
  return `${t.m}월 ${t.d}일 ${String(t.h).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;
}

function EventDetail({
  event: ev,
  groupId,
  titleId,
  onClose,
  onDelete,
  panel = false,
}: {
  event: Event;
  groupId: number;
  titleId?: string;
  onClose: () => void;
  onDelete: () => void;
  panel?: boolean;
}) {
  const router = useRouter();
  const startKey = dateKeyOf(ev.startsAt);
  const endKey = ev.allDay ? addDays(dateKeyOf(ev.endsAt), -1) : dateKeyOf(ev.endsAt);
  const short = (k: DateKey) => {
    const p = parseKey(k);
    return `${p.m}월 ${p.d}일 (${WEEKDAYS[dowOf(k)]})`;
  };
  const edited = ev.updatedAt && ev.updatedAt !== ev.createdAt;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-8 items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: memberColor(ev.creator.color) }} />
          {iGa(ev.creator.displayName)} 등록
        </span>
        {panel && (
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="grid size-8 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
            <IconClose size={18} />
          </button>
        )}
      </div>
      <h3 id={titleId} className="mt-1 text-[20px] font-bold leading-7 tracking-[-0.02em] break-words">
        {ev.title}
      </h3>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-sm bg-surface px-3.5 py-2.5">
        <div>
          <small className="block text-[12px] leading-4 text-ink-2">{short(startKey)}</small>
          <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : timeOf(ev.startsAt)}</b>
        </div>
        <IconArrowRight size={16} className="text-ink-2" />
        <div className="text-right">
          <small className="block text-[12px] leading-4 text-ink-2">{short(endKey)}</small>
          <b className="block text-[15px] font-bold leading-5">{ev.allDay ? "종일" : timeOf(ev.endsAt)}</b>
        </div>
      </div>
      {ev.memo && <p className="mt-2.5 whitespace-pre-wrap text-[14px] leading-5 text-soft">{ev.memo}</p>}
      <p className="mt-2.5 text-[12px] leading-4 text-ink-2">
        {stamp(ev.createdAt)} 등록{edited ? ` · ${stamp(ev.updatedAt)} 수정` : ""}
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/${ev.id}`)}
          className="h-11 flex-1 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
        >
          수정
        </button>
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/new?copy=${ev.id}`)}
          className="h-11 flex-1 rounded-md bg-hover text-[13.5px] font-bold hover:brightness-95"
        >
          복제
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="h-11 shrink-0 basis-14 rounded-md bg-hover px-3 text-[13.5px] font-bold text-danger hover:brightness-95"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

/** 모바일 바텀 시트 (목업 .dim + .sheet). 제목은 일정 제목이라 헤더 없이 grab 만 둔다 */
function DetailSheet({ onClose, children }: { onClose: () => void; children: (titleId: string) => React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 bg-[var(--scrim)]" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-paper px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-2 outline-none"
      >
        <div aria-hidden="true" className="mx-auto mb-1 h-1 w-9 rounded-full bg-[var(--grab)]" />
        {children(titleId)}
      </div>
    </div>
  );
}
