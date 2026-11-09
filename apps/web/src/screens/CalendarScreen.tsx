"use client";
// 4 달력. 목업 docs/설계/img/디자인-2026.html(모바일) 과 디자인-2026-PC.html(PC, ≥1024px) 을 그대로 옮긴다.
// 모바일: 큰 월 숫자 → 비는 시간/D-day 타일 → 달력 타일 → 선택일 목록 타일. 일정 탭 → 바텀 시트
// PC: 가운데 큰 달력(칸 안 일정 칩) + 우측 패널(비는 시간, D-day, 선택일 일정 또는 일정 상세, 이번 주 빈 시간)
// 바로 추가(#46): 모바일은 선택된 날짜 재탭 = 빠른 추가 시트, PC 는 날짜 칸 빈 곳 클릭 = 칸 옆 팝오버
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useGroupContext } from "@/components/AppShell";
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconClose, IconPlus } from "@/components/icons";
import { QuickAddPopover, QuickAddSheet } from "@/components/QuickAdd";
import { useToast } from "@/components/Toast";
import { ConfirmDialog, ErrorState, Skeleton } from "@/components/ui";
import { messageOf, useAnniversaries, useDeleteEvent, useEvents, useFreeSlots } from "@/hooks";
import { memberColor, onMemberColor } from "@/lib/colors";
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

type Props = { groupId: number; initialDate: string | null };

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

export function CalendarScreen({ groupId, initialDate }: Props) {
  const toast = useToast();
  const isDesktop = useIsDesktop();
  const { group } = useGroupContext();
  const today = todayKey();
  const [selected, setSelected] = useState(initialDate ?? today);
  const [{ y, m }, setMonth] = useState(() => {
    const p = parseKey(initialDate ?? today);
    return { y: p.y, m: p.m };
  });
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

  // 선택 날짜를 URL 에 남긴다 (새로고침, 공유, + 버튼의 기준 날짜)
  // state 는 null 로 넘긴다. Next 내부 state(__NA)를 그대로 넘기면 Next 가 내부 호출로 보고 useSearchParams 를 갱신하지 않아
  // AppShell 의 + 버튼이 처음 연 날짜에 머문다 (#57). null 이면 Next 가 내부 state 를 복사해 붙이고 쿼리를 동기화한다
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") === selected) return;
    url.searchParams.set("date", selected);
    window.history.replaceState(null, "", url);
  }, [selected]);

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
  const ddayTile = (
    <Link href={`/g/${groupId}/anniversaries`} className="block rounded-lg bg-paper px-4 py-3.5 hover:brightness-[.98] lg:px-[18px] lg:py-4">
      {nearest ? (
        <>
          <small className="block truncate text-[12px] font-semibold text-ink-2">{nearest.name}</small>
          <b className="mt-1 block text-[22px] font-extrabold tracking-[-0.04em]">{dday(nearest.date, today).label}</b>
          <span className="mt-2 flex" aria-label={`멤버 ${memberCount}명`}>
            {(group?.members ?? []).slice(0, 4).map((mb, i) => (
              <i
                key={mb.userId ?? i}
                className="-ml-1.5 block size-[22px] rounded-full border-2 border-paper first:ml-0"
                style={{ background: memberColor(mb.color) }}
              />
            ))}
          </span>
        </>
      ) : anniversaries === null ? (
        <>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-2 h-6 w-20" />
        </>
      ) : (
        <>
          <small className="block text-[12px] font-semibold text-ink-2">기념일</small>
          <b className="mt-1 block text-[15px] font-bold leading-snug tracking-[-0.02em]">등록하면 D-day 가 보여요</b>
        </>
      )}
    </Link>
  );

  const dayHeading = (() => {
    const p = parseKey(selected);
    const base = `${p.d}일 ${WEEKDAYS[dowOf(selected)]}요일`;
    return p.m !== m || p.y !== y ? `${p.m}월 ${base}` : base;
  })();

  const dayList = (
    <>
      <h2 className="flex items-center gap-2 text-[15px] font-extrabold tracking-[-0.02em]">
        {dayHeading}
        {selected === today && <em className="rounded-full bg-today px-2 py-[3px] text-[11px] font-bold not-italic text-today-ink">오늘</em>}
        {holidayOf(selected) && <span className="text-[12px] font-bold text-holiday">{holidayOf(selected)}</span>}
      </h2>
      {eventsError ? (
        <div className="mt-3">
          <ErrorState message={eventsError} onRetry={loadEvents} />
        </div>
      ) : events === null ? (
        <div className="mt-3 space-y-3" aria-busy="true" aria-label="불러오는 중">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-3 rounded-[4px]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : dayEvents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-5 text-center">
          <p className="text-[14px] font-semibold leading-relaxed text-ink-2">이 날은 아직 일정이 없어요. 바로 추가해 보세요</p>
          <button
            type="button"
            onClick={() => openQuick(selected)}
            aria-haspopup="dialog"
            className="flex h-11 items-center gap-1.5 rounded-full bg-today px-5 text-[14px] font-bold text-sel-ink hover:brightness-[.97]"
          >
            <IconPlus size={16} strokeWidth={2.6} />이 날 일정 추가
          </button>
        </div>
      ) : (
        <ul className="mt-1">
          {dayEvents.map((ev, i) => (
            <li key={ev.id} className={i === 0 ? "" : "border-t border-line"}>
              <button
                type="button"
                onClick={() => setDetail(ev)}
                aria-haspopup="dialog"
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <i aria-hidden="true" className="block size-3 shrink-0 rounded-[4px]" style={{ background: memberColor(ev.creator.color) }} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[16px] font-bold tracking-[-0.02em] lg:text-[15px]">{ev.title}</b>
                  <span className="block text-[12px] font-semibold text-ink-2">{formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}</span>
                </span>
                <span className="ml-auto shrink-0 text-[12px] font-semibold text-ink-2">{ev.creator.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <div className="lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* 가운데: 월 헤더 + 달력 */}
      <section className="flex flex-col lg:min-h-0 lg:px-[22px] lg:pb-[22px] lg:pt-[26px]">
        <div className="mt-[22px] flex items-end justify-between px-1.5 lg:mt-0 lg:px-0">
          <h1 aria-label={`${y}년 ${m}월`} className="flex items-end">
            <b className="text-[96px] font-extrabold leading-[.82] tracking-[-0.07em] lg:text-[72px] lg:leading-[.85]">{m}</b>
            <span className="ml-1.5 text-[15px] font-semibold text-ink-2">
              월{y !== thisYear ? ` ${y}` : ""}
              <span className="hidden lg:inline">{y === thisYear ? ` ${y}` : ""}</span>
            </span>
          </h1>
          <div className="mb-1.5 flex items-center gap-1.5 lg:mb-1 lg:gap-2">
            {/* 모바일은 오늘에서 벗어났을 때만, PC 는 목업처럼 항상 */}
            <button
              type="button"
              onClick={goToday}
              className={`h-9 place-items-center rounded-full bg-paper px-3.5 text-[13px] font-bold ${showToday ? "grid" : "hidden lg:grid"}`}
            >
              오늘
            </button>
            <button type="button" onClick={() => go(-1)} aria-label="이전 달" className="grid size-9 place-items-center rounded-full bg-paper">
              <IconChevronLeft size={18} strokeWidth={2.6} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="다음 달" className="grid size-9 place-items-center rounded-full bg-paper">
              <IconChevronRight size={18} strokeWidth={2.6} />
            </button>
            <Link
              href={newHref}
              className="hidden h-9 items-center gap-1 rounded-full bg-pri px-4 text-[13px] font-bold text-on-pri hover:brightness-95 lg:flex"
            >
              <IconPlus size={14} strokeWidth={2.6} />
              일정 추가
            </Link>
          </div>
        </div>

        {/* 모바일 벤토: 오늘 비는 시간 + D-day */}
        <div className="mt-[18px] grid grid-cols-[1.25fr_1fr] gap-2 lg:hidden">
          {freeTile}
          {ddayTile}
        </div>

        {/* 달력 타일 */}
        <div className="mt-2 rounded-xl bg-paper px-2.5 pb-2.5 pt-3.5 lg:mt-[18px] lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:rounded-[24px] lg:px-3">
          <div aria-hidden="true" className="grid grid-cols-7 text-center text-[11px] font-bold text-ink-2 lg:px-2 lg:pb-2 lg:text-left">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={i === 0 || i === 6 ? "text-holiday" : ""}>
                {w}
              </span>
            ))}
          </div>
          <ul
            aria-label={`${y}년 ${m}월 날짜`}
            className="mt-1.5 grid grid-cols-7 gap-y-[2px] lg:mt-0 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:gap-[2px]"
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
        <section aria-live="polite" className="mt-2 rounded-xl bg-paper p-4 lg:hidden">
          {dayList}
        </section>
      </section>

      {/* PC 우측 패널 */}
      <aside className="hidden flex-col gap-2.5 overflow-y-auto pb-[22px] pr-[22px] pt-[26px] lg:flex">
        {freeTile}
        {ddayTile}
        <section aria-live="polite" className="flex-1 rounded-lg bg-paper px-[18px] py-4">
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
              <h2 className="mt-[18px] text-[15px] font-extrabold tracking-[-0.02em]">이번 주 빈 시간</h2>
              {weekFreeQ.error ? (
                <p className="mt-2 text-[13px] font-semibold text-ink-2">빈 시간을 계산하지 못했어요</p>
              ) : weekFree === null ? (
                <div className="mt-2 space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-[12px]" />
                  ))}
                </div>
              ) : weekFree.length === 0 ? (
                <p className="mt-2 text-[13px] font-semibold leading-relaxed text-ink-2">
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
                          className="mt-2 flex items-center justify-between rounded-[12px] bg-surface px-3 py-2.5 text-[13px] font-bold hover:brightness-95"
                        >
                          {WEEKDAYS[dowOf(k)]} {p.m}/{p.d} {timeOf(s.startsAt)}~{timeOf(s.endsAt)}
                          <span className="text-[12px] font-semibold text-ink-2">{formatMinutes(mins)}</span>
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

/* ---------- 오늘 비는 시간 타일 (연한 코랄 면, #46) ---------- */

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
  const cls = "block rounded-lg bg-[var(--hl-tile)] px-4 py-3.5 text-left text-[var(--hl-ink)] hover:brightness-[.98] lg:px-[18px] lg:py-4";
  const sub = "block text-[12px] font-semibold text-[var(--hl-ink)]/80";
  if (onRetry && slot === undefined) {
    return (
      <button type="button" onClick={onRetry} className={`${cls} w-full`}>
        <small className={sub}>{label}</small>
        <b className="mt-1 block text-[15px] font-bold leading-snug">계산하지 못했어요. 눌러서 다시 시도</b>
      </button>
    );
  }
  if (slot === undefined) {
    return (
      <div className={cls} aria-busy="true">
        <small className={sub}>{label}</small>
        <span className="mt-2 block h-6 w-28 animate-pulse rounded-[7px] bg-[var(--hl-ink)]/15" />
      </div>
    );
  }
  if (slot === null) {
    return (
      <Link href={`/g/${groupId}/free`} className={cls}>
        <small className={sub}>{label}</small>
        <b className="mt-1 block text-[15px] font-bold leading-snug tracking-[-0.02em]">오늘은 모두 비는 시간이 없어요</b>
        <small className={`mt-1.5 ${sub}`}>다른 날 찾아보기</small>
      </Link>
    );
  }
  return (
    <Link href={newEventHref(groupId, slot.startsAt, slot.endsAt)} className={cls}>
      <small className={sub}>{label}</small>
      <b className="mt-1 block text-[22px] font-extrabold tracking-[-0.04em] text-[var(--hl-time)]">
        {timeOf(slot.startsAt)}~{timeOf(slot.endsAt)}
      </b>
      <small className={`mt-1.5 ${sub}`}>
        <span className="lg:hidden">탭하면</span>
        <span className="hidden lg:inline">클릭하면</span> 바로 약속으로
      </small>
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
  // 선택 칸 = 옅은 코랄 면 + 코랄 숫자, 선택 안 된 오늘 = 코랄 테두리 + 코랄 숫자 (#46 A안)
  const numColor = isSelected || (isToday && inMonth)
    ? "text-today-ink"
    : !inMonth
      ? red
        ? "text-[var(--holiday-faint)] font-medium"
        : "text-faint font-medium"
      : red
        ? "text-holiday"
        : "";
  const hint = isDesktop ? ", 눌러서 일정 추가" : isSelected ? ", 한 번 더 누르면 일정 추가" : "";
  const label = `${formatDateKo(dateKey, true)}${holiday ? `, ${holiday}` : ""}${events.length ? `, 일정 ${events.length}개` : ""}${isToday ? ", 오늘" : ""}${hint}`;

  // 모바일: 색 바(멤버 색 최대 3개) + 그날 시작하는(또는 주 첫 칸의) 첫 일정 제목
  const colors = Array.from(new Set(events.map((e) => e.creator.color))).slice(0, 3);
  const labelEvent = events.find((e) => dateKeyOf(e.startsAt) === dateKey || dow === 0) ?? null;
  // PC: 칩 최대 3개
  const chips = events.slice(0, 3);
  const more = events.length - chips.length;

  return (
    <li
      data-date={dateKey}
      className={`anim-pick relative h-[52px] overflow-hidden rounded-sm px-[3px] pt-1.5 text-center text-[14px] font-bold lg:h-auto lg:min-h-0 lg:px-2 lg:pb-1 lg:pt-2 lg:text-left lg:text-[13px] ${
        isSelected ? "bg-today" : isToday ? "ring-[1.5px] ring-pri ring-inset" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => onPick(e.currentTarget.parentElement as HTMLElement)}
        aria-pressed={isSelected}
        aria-label={label}
        aria-haspopup={isDesktop || isSelected ? "dialog" : undefined}
        className={`absolute inset-0 rounded-sm ${isSelected ? "" : "hover:bg-surface/60"}`}
      />
      <span className={`pointer-events-none relative block leading-[1.25] ${numColor}`}>{p.d}</span>
      {holiday && (
        <span
          aria-hidden="true"
          className={`pointer-events-none relative block truncate text-[8.5px] font-bold leading-[1.3] lg:inline lg:pl-1.5 lg:text-[11px] ${inMonth ? "text-holiday" : "text-[var(--holiday-faint)]"}`}
        >
          {holiday}
        </span>
      )}

      {/* 모바일 표시 */}
      <span aria-hidden="true" className="pointer-events-none relative block lg:hidden">
        {loading ? null : colors.length > 0 ? (
          <>
            <span className="mx-auto mt-[5px] flex h-1 w-3/5 gap-px overflow-hidden rounded-[2px]">
              {colors.map((c) => (
                <s key={c} className="block h-full flex-1" style={{ background: memberColor(c) }} />
              ))}
            </span>
            {labelEvent && (
              <span className={`mt-0.5 block truncate text-[9px] font-bold ${isSelected ? "text-today-ink" : "text-soft"}`}>{labelEvent.title}</span>
            )}
          </>
        ) : null}
      </span>

      {/* PC 표시: 일정 칩 (색 점 + 제목 + 시간), 여러 날 종일은 색 띠 */}
      <span className="relative hidden lg:block">
        {chips.map((ev) => {
          const band = isMultiDayAllDay(ev);
          const style = band ? { background: memberColor(ev.creator.color), color: onMemberColor(ev.creator.color) } : undefined;
          return (
            <button
              key={ev.id}
              type="button"
              onClick={() => onOpen(ev)}
              aria-label={`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, ${ev.creator.displayName}`}
              className={`mt-[5px] flex w-full items-center gap-[5px] overflow-hidden rounded-xs px-1.5 py-[3px] text-left text-[11px] font-semibold whitespace-nowrap ${
                band ? "" : isSelected ? "bg-paper/80" : "bg-surface"
              }`}
              style={style}
            >
              {!band && <i aria-hidden="true" className="block size-[7px] shrink-0 rounded-[2px]" style={{ background: memberColor(ev.creator.color) }} />}
              <span className="truncate">
                {ev.title}
                {!ev.allDay && dateKeyOf(ev.startsAt) === dateKey ? ` ${timeOf(ev.startsAt)}` : ""}
              </span>
            </button>
          );
        })}
        {more > 0 && (
          <span aria-hidden="true" className={`pointer-events-none mt-1 block text-[11px] font-semibold ${isSelected ? "text-today-ink" : "text-ink-2"}`}>
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
        <span className="inline-flex items-center gap-[7px] rounded-full bg-surface py-1.5 pl-1.5 pr-2.5 text-[13px] font-bold">
          <i aria-hidden="true" className="block size-5 rounded-full" style={{ background: memberColor(ev.creator.color) }} />
          {iGa(ev.creator.displayName)} 등록
        </span>
        {panel && (
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="grid size-8 place-items-center rounded-full bg-surface">
            <IconClose size={16} />
          </button>
        )}
      </div>
      <h3 id={titleId} className={`mt-3.5 font-extrabold leading-[1.1] tracking-[-0.04em] break-words ${panel ? "text-[26px]" : "text-[30px]"}`}>
        {ev.title}
      </h3>
      <div className="mt-3.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2.5 rounded-[18px] bg-surface px-4 py-3.5">
        <div>
          <small className="block text-[12px] font-semibold text-ink-2">{short(startKey)}</small>
          <b className={`block font-extrabold tracking-[-0.03em] ${panel ? "text-[20px]" : "text-[22px]"}`}>
            {ev.allDay ? "종일" : timeOf(ev.startsAt)}
          </b>
        </div>
        <IconArrowRight size={18} className="text-ink-2" />
        <div className="text-right">
          <small className="block text-[12px] font-semibold text-ink-2">{short(endKey)}</small>
          <b className={`block font-extrabold tracking-[-0.03em] ${panel ? "text-[20px]" : "text-[22px]"}`}>
            {ev.allDay ? "종일" : timeOf(ev.endsAt)}
          </b>
        </div>
      </div>
      {ev.memo && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-normal text-soft">{ev.memo}</p>}
      <p className="mt-3.5 text-[12px] font-semibold text-ink-2">
        {stamp(ev.createdAt)} 등록{edited ? ` · ${stamp(ev.updatedAt)} 수정` : ""}
      </p>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/${ev.id}`)}
          className="h-[52px] flex-1 rounded-full bg-btn text-[15px] font-bold text-on-btn"
        >
          수정
        </button>
        <button
          type="button"
          onClick={() => router.push(`/g/${groupId}/events/new?copy=${ev.id}`)}
          className="h-[52px] flex-1 rounded-full bg-surface text-[15px] font-bold"
        >
          복제
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="h-[52px] shrink-0 basis-[52px] rounded-full bg-surface px-3 text-[15px] font-bold text-danger"
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
      <button type="button" aria-label="닫기" tabIndex={-1} onClick={onClose} className="anim-fade absolute inset-0 bg-black/35" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="anim-sheet relative max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-2xl bg-paper px-[22px] pb-[calc(34px+env(safe-area-inset-bottom))] pt-3 outline-none"
      >
        <div aria-hidden="true" className="mx-auto mb-[18px] h-[5px] w-10 rounded-full bg-[var(--grab)]" />
        {children(titleId)}
      </div>
    </div>
  );
}
