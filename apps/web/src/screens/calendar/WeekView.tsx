"use client";
// 달력 주 보기 (#192, 디자인규칙.md 2-5). 7일 × 24시간 격자에 시간 일정을 시각 위치대로 막대로 그린다.
// - 위에서부터: 상태 줄(오류, 빈 주 안내 + "빈 시간" 토글) → 날짜 머리(요일, 날짜, 기념일 또는 공휴일 한 줄) →
//   종일 줄(여러 날 종일 포함, month-lanes packWeek 레인 재사용, 최대 3줄 + "+N개 더") → 세로 스크롤 시간 격자
// - 막대 배치(겹침 열, 자정 넘김 자르기)는 lib/week-layout.ts. 이 파일은 그리기와 누르기만
// - 날짜 머리, 막대, "+N" 을 누르면 월 보기와 같은 경로(날짜 상세 → 일정 상세). 빈 칸을 누르면 그 시각(30분 단위)으로 빠른 추가
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DotCluster, useWho } from "@/components/Participants";
import { IconHeart } from "@/components/icons";
import { Skeleton } from "@/components/ui";
import { occurrenceCellText, occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import { groupByDay } from "@/lib/day-detail";
import { dowOf, formatDateKo, formatEventTime, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import { fitWeek, packWeek, type BarPiece } from "@/lib/month-lanes";
import { barColors, chipColor, eventColors, splitBackground, withWho } from "@/lib/participants";
import type { Event } from "@/lib/types";
import {
  ALL_DAY_CAPACITY,
  DAY_MINUTES,
  daySegments,
  freeBands,
  hhmm,
  hourLabel,
  initialTopMinute,
  layoutDay,
  nowMarker,
  segmentLabel,
  slotMinuteAt,
  visualEnd,
  type PlacedSegment,
} from "@/lib/week-layout";

export type WeekFree = {
  on: boolean;
  onToggle: () => void;
  /** 토글 글자 ("빈 시간", "둘 다 비는 시간", "모두 비는 시간") */
  label: string;
  /** 켰을 때 그 주 빈 시간. null = 불러오는 중 */
  slots: { startsAt: string; endsAt: string }[] | null;
  error: boolean;
};

type Props = {
  days: DateKey[];
  today: DateKey;
  /** 넓은 화면(≥600) 이면 true. 폰은 축약 격자 (Q1) */
  wide: boolean;
  /** 받아 둔 일정 (주 앞뒤 1주 포함). null = 불러오는 중 */
  events: Event[] | null;
  eventsError: string | null;
  onRetry: () => void;
  annByDay: ReadonlyMap<DateKey, Occurrence[]>;
  /** 날짜 상세가 보여 주는 날 (머리에 선택 원) */
  anchor: DateKey | null;
  free: WeekFree;
  newHref: string;
  swipeRef: React.Ref<HTMLDivElement>;
  onOpenDay: (date: DateKey) => void;
  onOpenEvent: (date: DateKey, ev: Event) => void;
  onAdd: (date: DateKey, time: string) => void;
};

/** 종일 줄 한 줄 = 위 여백 2 + 막대 18 (폰 16) */
const ALL_DAY_ROW = { wide: 20, phone: 18 };
/** 시간 줄 높이 */
const HOUR_PX = { wide: 48, phone: 40 };
const GUTTER = 44;

export function WeekView(props: Props) {
  const { days, today, wide, events, eventsError, onRetry, annByDay, anchor, free, newHref, swipeRef, onOpenDay, onOpenEvent, onAdd } = props;
  const hourPx = wide ? HOUR_PX.wide : HOUR_PX.phone;
  const rowPx = wide ? ALL_DAY_ROW.wide : ALL_DAY_ROW.phone;
  const who = useWho();

  // 지금 시각 선. 1분마다 다시 그린다
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const now = nowMarker(days, nowMs);

  const list = useMemo(() => events ?? [], [events]);
  const layouts = useMemo(() => days.map((d) => layoutDay(daySegments(list, d))), [days, list]);
  // 종일 줄: 종일 일정만 막대로 (시간 일정은 격자에). 레인과 "+N개 더" 는 월 달력과 같은 함수
  const allDay = useMemo(() => {
    const packed = packWeek(days, groupByDay(list.filter((e) => e.allDay)), () => true);
    const fit = fitWeek(packed, ALL_DAY_CAPACITY);
    const rows = Math.max(1, ...fit.pieces.map((p) => p.lane + 1), ...fit.days.map((d) => (d.more > 0 ? ALL_DAY_CAPACITY : 0)));
    return { fit, rows };
  }, [days, list]);
  const emptyWeek = events !== null && layouts.every((l) => l.placed.length === 0 && l.more.length === 0) && allDay.fit.pieces.length === 0 && allDay.fit.days.every((d) => d.more === 0);
  const bands = useMemo(() => (free.on && free.slots ? days.map((d) => freeBands(free.slots ?? [], d)) : null), [free.on, free.slots, days]);

  // 처음 열 때, 주를 넘길 때 맨 위 시각: 이번 주면 지금 - 1시간, 아니면 그 주 첫 일정 (일정을 받은 뒤 한 번)
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);
  const weekKey = days[0];
  const ready = events !== null || now !== null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || scrolledFor.current === weekKey) return;
    el.scrollTop = (initialTopMinute(days, events, nowMs) / 60) * hourPx;
    if (ready) scrolledFor.current = weekKey;
    // nowMs 가 바뀔 때마다 다시 맞추지 않는다 (scrolledFor 가 막는다)
  }, [weekKey, ready, days, events, nowMs, hourPx]);

  function addAt(day: DateKey, e: React.MouseEvent<HTMLButtonElement>) {
    // 키보드(Enter, Space)로 누르면 지금 보이는 맨 위 칸 시각
    if (e.detail === 0) {
      const top = scroller.current?.scrollTop ?? 0;
      onAdd(day, hhmm(slotMinuteAt(top + hourPx / 2, hourPx)));
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    onAdd(day, hhmm(slotMinuteAt(e.clientY - rect.top, hourPx)));
  }

  const cols = `${GUTTER}px repeat(7, minmax(0, 1fr))`;

  return (
    <div
      ref={swipeRef}
      className="mt-2 flex touch-pan-y flex-col overflow-hidden rounded-xl bg-paper fold:mt-3 fold:min-h-0 fold:flex-1"
      aria-busy={events === null ? true : undefined}
    >
      {/* 상태 줄: 왼쪽 오류 또는 빈 주 안내, 오른쪽 빈 시간 겹쳐 보기 토글 */}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[13px]">
        {eventsError ? (
          <p role="alert" className="flex min-w-0 items-center gap-1.5 text-ink-2">
            <span className="truncate">일정을 불러오지 못했어요.</span>
            <button type="button" onClick={onRetry} className="hit shrink-0 font-bold text-btn">
              다시 시도
            </button>
          </p>
        ) : emptyWeek ? (
          <p className="flex min-w-0 items-center gap-1.5 text-ink-2">
            <span className="truncate">이번 주 일정이 없어요.</span>
            <Link href={newHref} className="hit shrink-0 font-bold text-btn">
              일정 추가
            </Link>
          </p>
        ) : null}
        <span className="flex-1" />
        {free.on && free.error && <span className="text-[12px] text-ink-2">빈 시간을 못 불러왔어요</span>}
        <button
          type="button"
          aria-pressed={free.on}
          onClick={free.onToggle}
          className={`hit flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-bold ${
            free.on ? "border-acc-ink bg-[color-mix(in_srgb,var(--acc-ink)_10%,transparent)] text-acc-ink" : "border-line text-ink-2 hover:text-ink"
          }`}
        >
          <i aria-hidden="true" className="block size-2.5 rounded-[3px]" style={{ background: "color-mix(in srgb, var(--acc-ink) 35%, transparent)" }} />
          {free.label}
        </button>
      </div>

      {/* 날짜 머리 */}
      <div className="grid shrink-0 border-b border-line" style={{ gridTemplateColumns: cols }}>
        <span aria-hidden="true" />
        {days.map((d) => (
          <DayHead key={d} date={d} today={today} anchor={anchor === d} ann={annByDay.get(d) ?? []} wide={wide} onOpen={() => onOpenDay(d)} />
        ))}
      </div>

      {/* 종일 줄 */}
      <div className="relative grid shrink-0 border-b border-line" style={{ gridTemplateColumns: cols, minHeight: allDay.rows * rowPx + 4 }}>
        <span className="pt-1 pr-1.5 text-right text-[11px] leading-4 text-ink-2">종일</span>
        <div className="relative col-span-7">
          {events === null ? (
            <Skeleton className="absolute top-1 left-1 h-4 w-1/3 rounded-[5px]" />
          ) : (
            <>
              {allDay.fit.pieces.map((p) => (
                <AllDayBar key={`${p.key}@${p.col}`} piece={p} rowPx={rowPx} wide={wide} onOpen={() => onOpenEvent(days[p.col], p.event)} />
              ))}
              {allDay.fit.days.map((d, col) =>
                d.more > 0 ? (
                  <button
                    key={`more${col}`}
                    type="button"
                    onClick={() => onOpenDay(days[col])}
                    aria-label={`${formatDateKo(days[col])} 종일 일정 ${d.more}개 더 보기`}
                    className="absolute truncate rounded-[5px] px-1 text-left text-[11px] font-medium leading-4 text-ink-2 hover:bg-hover"
                    style={{ top: 2 + (ALL_DAY_CAPACITY - 1) * rowPx, left: `calc(${col} * 100% / 7 + 2px)`, width: "calc(100% / 7 - 4px)" }}
                  >
                    +{d.more}
                    <span className="max-fold:hidden">개 더</span>
                  </button>
                ) : null,
              )}
            </>
          )}
        </div>
      </div>

      {/* 시간 격자 (세로 스크롤). 폰은 높이를 정하고, 넓은 화면은 남은 높이를 채운다 */}
      <div ref={scroller} className="relative h-[min(60dvh,520px)] overflow-y-auto overscroll-contain fold:h-auto fold:min-h-0 fold:flex-1">
        <div className="relative flex" style={{ height: 24 * hourPx }}>
          {/* 시각 열 */}
          <div aria-hidden="true" className="relative shrink-0" style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, h) =>
              h === 0 ? null : (
                <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[11px] leading-none text-ink-2" style={{ top: h * hourPx }}>
                  {hourLabel(h)}
                </span>
              ),
            )}
          </div>
          <div className="relative grid min-w-0 flex-1 grid-cols-7">
            {/* 시간 줄(실선) + 30분 점선 */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="relative border-t border-line" style={{ height: hourPx }}>
                  <i className="absolute inset-x-0 block border-t border-dashed border-line" style={{ top: hourPx / 2 - 1 }} />
                </div>
              ))}
            </div>
            {days.map((d, col) => (
              <div key={d} className="relative border-l border-line">
                {/* 빈 칸 누르기 = 그 시각으로 빠른 추가 */}
                <button
                  type="button"
                  onClick={(e) => addAt(d, e)}
                  aria-label={`${formatDateKo(d)}에 일정 추가`}
                  className="absolute inset-0 hover:bg-hover/40 focus-visible:outline-offset-[-2px]"
                />
                {bands?.[col].map((b) => (
                  <i
                    key={`${b.start}-${b.end}`}
                    aria-hidden="true"
                    data-free-band=""
                    className="pointer-events-none absolute inset-x-0 block"
                    style={{ top: (b.start / 60) * hourPx, height: ((b.end - b.start) / 60) * hourPx, background: "color-mix(in srgb, var(--acc-ink) 10%, transparent)" }}
                  />
                ))}
                {events === null
                  ? [9, 14].map((h) => (
                      <i key={h} aria-hidden="true" className="skeleton pointer-events-none absolute inset-x-1 block rounded-[5px]" style={{ top: h * hourPx, height: hourPx }} />
                    ))
                  : layouts[col].placed.map((s) => (
                      <TimedBar key={s.key} seg={s} day={d} hourPx={hourPx} wide={wide} label={withWho(segmentLabel(s.event), s.event, who)} onOpen={() => onOpenEvent(d, s.event)} />
                    ))}
                {events !== null &&
                  layouts[col].more.map((m) => (
                    <button
                      key={`more${m.start}`}
                      type="button"
                      onClick={() => onOpenDay(d)}
                      aria-label={`${formatDateKo(d)} 겹친 일정 ${m.events.length}개 더 보기`}
                      className="absolute grid h-[18px] place-items-center overflow-hidden rounded-[5px] bg-surface text-[11px] leading-none font-bold whitespace-nowrap text-ink-2 hover:text-ink max-fold:text-[10px]"
                      style={{ top: (m.start / 60) * hourPx + 1, left: `calc(${m.col} * 100% / ${m.cols} + 1px)`, width: `calc(100% / ${m.cols} - 3px)` }}
                    >
                      +{m.events.length}
                    </button>
                  ))}
                {now?.col === col && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[1] block h-px bg-pri" style={{ top: (now.minute / 60) * hourPx }}>
                    <i className="absolute -top-[3px] -left-[3px] block size-[7px] rounded-full bg-pri" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 날짜 머리 칸: 요일 11 + 날짜 숫자, 아래 기념일(하트) 또는 공휴일 이름 한 줄 (월 칸과 같은 우선순위, D-61) */
function DayHead({ date, today, anchor, ann, wide, onOpen }: { date: DateKey; today: DateKey; anchor: boolean; ann: Occurrence[]; wide: boolean; onOpen: () => void }) {
  const dow = dowOf(date);
  const holiday = holidayOf(date);
  const red = dow === 0 || dow === 6 || Boolean(holiday);
  const isToday = date === today;
  const first = ann[0] ?? null;
  const annText = first ? occurrenceCellText(first) : null;
  const holidayText = first ? null : holiday;
  const label = `${formatDateKo(date, true)}${holiday ? `, ${holiday}` : ""}${ann.length ? `, 기념일 ${ann.map(occurrenceTitle).join(", ")}` : ""}${isToday ? ", 오늘" : ""}`;
  const num = anchor ? "bg-sel-fill text-on-pri" : isToday ? "text-today-ink" : red ? "text-holiday" : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      aria-haspopup="dialog"
      aria-current={isToday ? "date" : undefined}
      className="flex min-w-0 flex-col items-center gap-px border-l border-line px-0.5 pt-1.5 pb-1 hover:bg-hover/50"
    >
      <span aria-hidden="true" className={`text-[11px] leading-4 font-semibold ${isToday ? "text-today-ink" : red ? "text-holiday" : "text-ink-2"}`}>
        {WEEKDAYS[dow]}
      </span>
      <span aria-hidden="true" className={`anim-pick grid size-[26px] place-items-center rounded-full text-[14px] leading-none font-bold ${num}`}>
        {parseKey(date).d}
      </span>
      <span aria-hidden="true" className={`flex h-3.5 max-w-full min-w-0 items-center gap-0.5 text-[10px] leading-3.5 font-semibold ${annText ? "text-acc-ink" : "text-holiday"}`}>
        {annText && <IconHeart size={wide ? 10 : 8} className="shrink-0" />}
        <span className="truncate">{annText ?? holidayText ?? ""}</span>
      </span>
    </button>
  );
}

/** 종일 줄 막대. 월 달력 여러 날 막대(WeekBar)와 같은 모양 (11/500, 높이 18, 모서리 5, 옅은 멤버 색 면 + 진한 글자) */
function AllDayBar({ piece, rowPx, wide, onOpen }: { piece: BarPiece<Event>; rowPx: number; wide: boolean; onOpen: () => void }) {
  const ev = piece.event;
  const who = useWho();
  const l = piece.roundStart ? 2 : 0;
  const r = piece.roundEnd ? 2 : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={withWho(`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}`, ev, who)}
      className={`@container absolute flex items-center gap-1 overflow-hidden px-1.5 text-left font-medium whitespace-nowrap text-ink hover:brightness-95 ${
        wide ? "h-[18px] text-[11px] leading-[18px]" : "h-4 px-1 text-[10px] leading-4"
      } ${piece.roundStart ? "rounded-l-[5px]" : ""} ${piece.roundEnd ? "rounded-r-[5px]" : ""}`}
      style={{
        top: 2 + piece.lane * rowPx,
        left: `calc(${piece.col} * 100% / 7 + ${l}px)`,
        width: `calc(${piece.span} * 100% / 7 - ${l + r}px)`,
        background: `color-mix(in srgb, ${chipColor(ev)} 18%, transparent)`,
      }}
    >
      {wide && eventColors(ev).length >= 2 && (
        <span className="contents @max-[72px]:hidden">
          <DotCluster event={ev} />
        </span>
      )}
      <span className="truncate">{ev.title}</span>
    </button>
  );
}

/**
 * 시간 일정 막대. 옅은 색 면(일정 색, 자동이면 첫 참여자 색) + 왼쪽 3px 세로 막대(참여자 색을 위에서 아래로 나눔, D-141).
 * 넓은 화면: 제목 11/600 + 길이가 되면 시각 한 줄. 폰(축약, Q1): 1시간 이상이고 혼자 선 막대만 제목(10, 글자 단위 줄바꿈)
 */
function TimedBar({ seg, day, hourPx, wide, label, onOpen }: { seg: PlacedSegment<Event>; day: DateKey; hourPx: number; wide: boolean; label: string; onOpen: () => void }) {
  const ev = seg.event;
  const top = (seg.start / 60) * hourPx;
  const height = Math.max(((visualEnd(seg) - seg.start) / 60) * hourPx - 2, 12);
  // 폰은 열 폭이 40 남짓이라 나란히 선 막대(cols > 1)에는 제목을 넣지 않는다 (글자가 세로로 한 자씩 쌓인다)
  const showTitle = wide || (seg.cols === 1 && seg.end - seg.start >= 60);
  const showTime = wide && height >= 34;
  const time = `${hhmm(seg.start)}~${seg.end >= DAY_MINUTES ? "24:00" : hhmm(seg.end)}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={label}
      data-day={day}
      className={`@container absolute flex flex-col overflow-hidden text-left text-ink hover:brightness-95 ${seg.isStart ? "rounded-t-[5px]" : ""} ${seg.isEnd ? "rounded-b-[5px]" : ""} ${
        wide ? "py-0.5 pr-1 pl-[7px]" : "py-px pr-px pl-[5px]"
      }`}
      style={{
        top: top + 1,
        height,
        left: `calc(${seg.col} * 100% / ${seg.cols} + 1px)`,
        width: `calc(100% / ${seg.cols} - 3px)`,
        background: `color-mix(in srgb, ${chipColor(ev)} 18%, var(--tile))`,
      }}
    >
      <i aria-hidden="true" className="absolute inset-y-0 left-0 block w-[3px]" style={{ background: splitBackground(barColors(ev), "to bottom") }} />
      {showTitle && (
        <span
          aria-hidden="true"
          className={
            wide ? "line-clamp-2 text-[11px] leading-[14px] font-semibold break-all @max-[26px]:hidden" : "text-[10px] leading-3 font-medium break-all"
          }
        >
          {ev.title}
        </span>
      )}
      {showTime && (
        <span aria-hidden="true" className="truncate text-[10px] leading-3 text-ink-2 @max-[56px]:hidden">
          {time}
        </span>
      )}
    </button>
  );
}
