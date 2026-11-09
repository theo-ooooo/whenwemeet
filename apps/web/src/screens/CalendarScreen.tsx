"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, MemberDot, Skeleton, SkeletonList } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import {
  addDays,
  dateKeyOf,
  daysBetween,
  dday,
  dowOf,
  formatDateKo,
  formatEventTime,
  kstToIso,
  monthGrid,
  parseKey,
  shiftMonth,
  todayKey,
  WEEKDAYS,
} from "@/lib/date";
import type { Anniversary, Event } from "@/lib/types";

type Props = { groupId: string; initialDate: string | null };

export function CalendarScreen({ groupId, initialDate }: Props) {
  const today = todayKey();
  const [selected, setSelected] = useState(initialDate ?? today);
  const [{ y, m }, setMonth] = useState(() => {
    const p = parseKey(initialDate ?? today);
    return { y: p.y, m: p.m };
  });
  const [events, setEvents] = useState<Event[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [anniversaries, setAnniversaries] = useState<Anniversary[] | null>(null);

  const grid = useMemo(() => monthGrid(y, m), [y, m]);

  const loadEvents = useCallback(async () => {
    try {
      const from = kstToIso(grid[0]);
      const to = kstToIso(addDays(grid[41], 1));
      const list = await api<Event[]>(
        `/groups/${groupId}/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setEventsError(null);
      setEvents(list);
    } catch (e) {
      setEventsError(messageOf(e, "일정을 불러오지 못했어요"));
    }
  }, [groupId, grid]);

  useEffect(() => {
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => void loadEvents());
  }, [loadEvents]);

  useEffect(() => {
    let alive = true;
    api<Anniversary[]>(`/groups/${groupId}/anniversaries`)
      .then((list) => {
        if (alive) setAnniversaries(list);
      })
      .catch(() => {
        if (alive) setAnniversaries([]);
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

  // 선택 날짜를 URL 에 남긴다 (새로고침, 공유용)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") === selected) return;
    url.searchParams.set("date", selected);
    window.history.replaceState(window.history.state, "", url);
  }, [selected]);

  // 날짜별 일정 (겹치는 모든 날에 넣는다)
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
    return map;
  }, [events]);

  const dayEvents = (byDay.get(selected) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // 가장 가까운 기념일 1개
  const nearest = useMemo(() => {
    if (!anniversaries || anniversaries.length === 0) return null;
    return anniversaries
      .map((a) => ({ a, dist: Math.abs(daysBetween(today, a.date)) }))
      .sort((x, y2) => x.dist - y2.dist)[0].a;
  }, [anniversaries, today]);

  function go(n: number) {
    const next = shiftMonth(y, m, n);
    setMonth(next);
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

  const newHref = `/g/${groupId}/events/new?start=${encodeURIComponent(kstToIso(selected, "10:00"))}&end=${encodeURIComponent(kstToIso(selected, "11:00"))}`;

  return (
    <div className="pt-1">
      {/* 기념일 띠 */}
      {nearest ? (
        <Link
          href={`/g/${groupId}/anniversaries`}
          className="flex items-center justify-between rounded-sm bg-brand-soft px-3.5 py-2 text-[13px] font-semibold text-brand"
        >
          <span className="truncate">{nearest.name}</span>
          <span className="ml-3 shrink-0 tabular-nums">{dday(nearest.date, today).label}</span>
        </Link>
      ) : anniversaries === null ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <Link
          href={`/g/${groupId}/anniversaries`}
          className="block rounded-sm px-1 py-2 text-[13px] text-ink-2"
        >
          기념일을 등록하면 여기에 D-day 가 보여요
        </Link>
      )}

      {/* 월 헤더: 큰 월 숫자가 이 화면의 중심 */}
      <div className="mt-5 flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="t-display tabular-nums">{m}월</h1>
          <span className="text-[14px] font-semibold text-ink-2">{y}</span>
        </div>
        <div className="flex items-center gap-1">
          {!(selected === today && parseKey(today).m === m && parseKey(today).y === y) && (
            <button
              type="button"
              onClick={goToday}
              className="mr-1 h-9 rounded-sm px-3 text-[13px] font-semibold text-brand hover:bg-brand-soft"
            >
              오늘
            </button>
          )}
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="이전 달"
            className="flex size-9 items-center justify-center rounded-sm hover:bg-paper"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="다음 달"
            className="flex size-9 items-center justify-center rounded-sm hover:bg-paper"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* 월 그리드 */}
      <div className="mt-3 rounded-lg bg-paper px-2 pb-2 pt-3">
        <div role="row" className="grid grid-cols-7 text-center text-[12px] font-semibold text-ink-2">
          {WEEKDAYS.map((w, i) => (
            <span key={w} role="columnheader" className={i === 0 ? "text-member-2" : ""}>
              {w}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={`${y}년 ${m}월`} className="mt-1 grid grid-cols-7">
          {grid.map((key) => {
            const p = parseKey(key);
            const inMonth = p.m === m;
            const isToday = key === today;
            const isSelected = key === selected;
            const dayList = byDay.get(key) ?? [];
            const allDay = dayList.filter((e) => e.allDay);
            const timed = dayList.filter((e) => !e.allDay);
            const colors = Array.from(new Set(timed.map((e) => e.creator.color)));
            const label = `${formatDateKo(key, true)}${dayList.length ? `, 일정 ${dayList.length}개` : ""}`;
            return (
              <button
                key={key}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-label={label}
                onClick={() => pick(key)}
                className="flex h-[58px] flex-col items-center rounded-sm pt-1 hover:bg-surface"
              >
                <span
                  className={`anim-pick flex size-8 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums ${
                    isSelected
                      ? "bg-brand text-paper"
                      : isToday
                        ? "text-brand ring-[1.5px] ring-brand ring-inset"
                        : inMonth
                          ? dowOf(key) === 0
                            ? "text-member-2"
                            : "text-ink"
                          : "text-ink-2/50"
                  }`}
                >
                  {p.d}
                </span>
                <span className="mt-1 flex h-3 items-center gap-0.5">
                  {events === null ? (
                    <Skeleton className="h-1.5 w-4 rounded-full" />
                  ) : (
                    <>
                      {allDay.slice(0, 1).map((e) => (
                        <span
                          key={e.id}
                          aria-hidden="true"
                          className="h-1.5 w-5 rounded-full"
                          style={{ backgroundColor: e.creator.color }}
                        />
                      ))}
                      {colors.slice(0, allDay.length ? 2 : 3).map((c) => (
                        <MemberDot key={c} color={c} size={6} />
                      ))}
                      {colors.length > (allDay.length ? 2 : 3) && (
                        <span className="text-[9px] font-bold leading-none text-ink-2">
                          +{colors.length - (allDay.length ? 2 : 3)}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 선택 날짜 일정 목록 */}
      <section className="mt-5 pb-16" aria-live="polite">
        <h2 className="flex items-baseline gap-2 px-1">
          <span className="text-[16px] font-bold">{formatDateKo(selected)}</span>
          {selected === today && <span className="text-[13px] font-semibold text-brand">오늘</span>}
        </h2>
        <div className="mt-2.5">
          {eventsError ? (
            <ErrorState message={eventsError} onRetry={loadEvents} />
          ) : events === null ? (
            <SkeletonList rows={2} />
          ) : dayEvents.length === 0 ? (
            <p className="rounded-lg bg-paper px-5 py-7 text-center text-[14px] leading-relaxed text-ink-2">
              이 날은 아직 일정이 없어요.
              <br />+ 를 눌러 첫 일정을 추가해 보세요
            </p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((ev) => (
                <li key={ev.id}>
                  <Link
                    href={`/g/${groupId}/events/${ev.id}`}
                    className="flex items-stretch gap-3 rounded-lg bg-paper px-4 py-3 hover:bg-brand-soft/40"
                  >
                    <span
                      aria-hidden="true"
                      className="w-1 shrink-0 self-stretch rounded-full"
                      style={{ backgroundColor: ev.creator.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{ev.title}</span>
                      <span className="t-sub mt-0.5 block tabular-nums">
                        {formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 self-center text-[13px] text-ink-2">
                      <MemberDot color={ev.creator.color} size={8} />
                      {ev.creator.displayName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 일정 추가 */}
      <Link
        href={newHref}
        aria-label={`${formatDateKo(selected)} 일정 추가`}
        className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-5 z-30 flex size-14 items-center justify-center rounded-full bg-brand text-paper hover:bg-[#5d3df0] md:right-[calc(50%-240px+20px)]"
      >
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </div>
  );
}
