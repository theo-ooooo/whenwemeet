"use client";
// 폰(<600) 일 상세. 날짜 바텀 시트(DaySheet) 의 날짜 단계를 대신한다 (#212).
// (#378 B, 일 상세 C안 "하루 막대 + 목록") 제목 "11월 17일 화요일" + "월 보기" 알약 → 주간 줄 7칸 → (기념일이 있는 날만) 기념일 한 줄
// → 하루 막대(DayBar: 모두 비는 시간 코랄, 멤버 둘 이상이면 멤버별 얇은 줄, 오늘이면 "지금", 빈 구간을 누르면 그 시각으로 빠른 추가)
// → 이날 일정 목록(DayEventList: 공통 일정 줄 EventRow, 지난 일정 흐리게, 오늘이면 "지금" 줄).
// 비는 시간은 하루 막대가 보여 주므로 예전 위 요약 카드(비는 시간, 기념일)는 없앴다.
// 주소와 기록(?day=1, pushState, 뒤로가기 = 월 보기) 은 CalendarScreen 이 맡는다. 일정 상세, 빠른 추가는 그 위에 DaySheet 로 뜬다
import Link from "next/link";
import { ANNIVERSARIES_PATH } from "@/lib/routes";
import { useEffect, useMemo, useRef, useState } from "react";
import { DayBar } from "./DayBar";
import { DayEventList } from "./DayEvents";
import { IconCalendar, IconChevronRight, IconHeart, IconPlus } from "./icons";
import { ErrorState, Skeleton } from "./ui";
import { occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import { cellDensity } from "@/lib/calendar-cell";
import { dayCellSelector, weekRowTarget } from "@/lib/calendar-keys";
import { busyByMember, dayWindow } from "@/lib/day-bar";
import { dayBadge } from "@/lib/day-detail";
import { panelTitle } from "@/lib/day-panel";
import { weekStrip } from "@/lib/day-view";
import { dowOf, formatDateKo, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import { lunarLabelOf } from "@/lib/lunar";
import { lastInputWasKeyboard } from "@/lib/input-modality";
import type { Event, Member } from "@/lib/types";

type Props = {
  date: DateKey;
  today: DateKey;
  titleId: string;
  /** 날짜별 일정 (보는 달 그리드 범위). null = 불러오는 중 */
  byDay: Map<DateKey, Event[]> | null;
  eventsError: string | null;
  onRetry: () => void;
  /** 그날 기념일 항목 전부 */
  anniversaries: Occurrence[];
  /** 팀 멤버 (하루 막대의 멤버별 바쁜 시간). 개인 달력은 나 하나 */
  members: Member[];
  /** 지금 (ms). 지난 일정 흐리게, 오늘이면 "지금" 선과 줄 */
  now: number;
  /** 주간 줄 스와이프 (useMonthSwipe 의 ref) */
  stripRef: React.Ref<HTMLDivElement>;
  onPickDay: (date: DateKey) => void;
  onMonth: () => void;
  /** (#201) Esc 로 월(주) 보기로 닫는다. 위에 일정 상세, 빠른 추가 시트나 확인 창이 떠 있으면 false (그쪽이 Esc 를 받는다) */
  escapeCloses?: boolean;
  /** (#192) 돌아갈 달력 보기 이름. 주 보기에서 열었으면 "주 보기" */
  backLabel?: string;
  onOpenEvent: (ev: Event) => void;
  onAdd: () => void;
  /** 하루 막대의 빈 구간을 눌렀을 때: 그 시각(ms)으로 빠른 추가 */
  onAddAt: (start: number) => void;
  /** (#566) 제목 아래 "음력 10월 6일" (내 정보 "달력에 음력 표시") */
  showLunar?: boolean;
};

export function DayView({
  date,
  today,
  titleId,
  byDay,
  eventsError,
  onRetry,
  anniversaries,
  members,
  now,
  stripRef,
  onPickDay,
  onMonth,
  escapeCloses = false,
  backLabel = "월 보기",
  onOpenEvent,
  onAdd,
  onAddAt,
  showLunar = false,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  // 열면 맨 위로, 닫으면 달력을 보던 자리로 (본문 흐름 안에 그리므로 스크롤을 직접 맞춘다).
  // 제목으로 옮기는 포커스는 키보드로 열었을 때만 테두리를 그린다. 주소, 터치, 마우스로 열면 [data-quiet-focus] (#339, D-214)
  useEffect(() => {
    const y = window.scrollY;
    window.scrollTo(0, 0);
    const el = heading.current;
    if (el) {
      if (lastInputWasKeyboard()) delete el.dataset.quietFocus;
      else el.dataset.quietFocus = "";
      el.focus({ preventScroll: true });
    }
    return () => window.scrollTo(0, y);
  }, []);

  // (#201) 닫히면(월 보기 알약, 뒤로가기, Esc) 그때 날짜의 달력 칸으로 포커스. 다른 곳(사이드바, 독)으로 옮긴 포커스는 건드리지 않는다
  const root = useRef<HTMLDivElement>(null);
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  useEffect(() => {
    const el = root.current;
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body && !el?.contains(active)) return;
      document.querySelector<HTMLElement>(dayCellSelector(dateRef.current))?.focus({ preventScroll: true });
    };
  }, []);

  // (#201) Esc = "월 보기" (안쪽이 먼저 처리한 Esc 는 넘긴다, DayDock 과 같은 규칙)
  useEffect(() => {
    if (!escapeCloses) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Escape") return;
      e.stopPropagation();
      onMonth();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [escapeCloses, onMonth]);

  const week = weekStrip(date);
  // (#201) 주간 줄 roving tabindex. ← → Home End 는 포커스만 옮기고(누르면 그날로), 주 밖으로 나가거나 PageUp/PageDown 이면 그날로 바꾼다
  const [stripFocus, setStripFocus] = useState<DateKey | null>(null);
  const stripKey = stripFocus && week.includes(stripFocus) ? stripFocus : date;
  const stripMoved = useRef(false);
  useEffect(() => {
    if (!stripMoved.current) return;
    stripMoved.current = false;
    root.current?.querySelector<HTMLButtonElement>(`[data-strip="${stripKey}"]`)?.focus();
  }, [stripKey]);
  function onStripKey(e: React.KeyboardEvent) {
    const from = (e.target as HTMLElement).dataset.strip;
    if (!from) return;
    const next = weekRowTarget(from, e);
    if (!next) return;
    e.preventDefault();
    stripMoved.current = true;
    setStripFocus(next);
    if (!week.includes(next)) onPickDay(next);
  }
  const events = useMemo(() => (byDay ? (byDay.get(date) ?? []) : null), [byDay, date]);
  const holiday = holidayOf(date);
  const ann = anniversaries[0] ?? null;
  // 하루 막대: 멤버별 바쁜 시간 (그날 8~23시, 참여자만, 종일 일정 제외)
  const bar = useMemo(() => (events ? busyByMember(events, members, dayWindow(date)) : null), [events, members, date]);

  return (
    <div ref={root} className="pt-1">
      {/* 제목줄 40: "11월 17일 화요일" 18/700 + 오른쪽 "월 보기" 알약 */}
      <div className="flex h-10 items-center gap-2">
        <h1 id={titleId} ref={heading} tabIndex={-1} className="min-w-0 truncate text-[18px] font-bold leading-6 tracking-[-0.02em] outline-none">
          {panelTitle(date)}
        </h1>
        {date === today && <em className="shrink-0 text-[12px] font-semibold not-italic text-today-ink">오늘</em>}
        {holiday && <span className="min-w-0 truncate text-[12px] font-medium text-holiday">{holiday}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onMonth}
          className="hit flex h-8 shrink-0 items-center gap-1 rounded-full bg-paper px-3 text-[13px] font-bold"
        >
          <IconCalendar size={16} />
          {backLabel}
        </button>
      </div>
      {/* (#566) 음력 표시를 켰으면 제목 아래 한 줄 13 --mute */}
      {showLunar && lunarLabelOf(date) && <p className="-mt-1 text-[13px] leading-[18px] font-medium text-ink-2 tabular-nums">{lunarLabelOf(date)}</p>}

      {/* 주간 줄 7칸 (높이 70, 모서리 14). 누르면 그날로, 옆으로 넘기면 지난주/다음 주 같은 요일로 */}
      {/* (#201) 격자 한 줄: role=grid > row(display:contents) > gridcell aria-selected > 버튼 (월 달력, DatePicker 와 같은 짜임) */}
      <div
        ref={stripRef}
        role="grid"
        aria-label="이번 주"
        onKeyDown={onStripKey}
        className="mt-2 grid touch-pan-y grid-cols-7 gap-1.5"
      >
        <div role="row" className="contents">
        {week.map((k) => {
          const sel = k === date;
          const p = parseKey(k);
          const dow = dowOf(k);
          const red = dow === 0 || dow === 6 || Boolean(holidayOf(k));
          const dayEvents = byDay?.get(k) ?? [];
          const density = cellDensity(dayEvents);
          const tone = sel ? "text-on-strip-sel" : k === today ? "text-today-ink" : red ? "text-holiday" : "";
          return (
            <div key={k} role="gridcell" aria-selected={sel}>
              <button
                type="button"
                data-strip={k}
                onClick={() => onPickDay(k)}
                onFocus={() => setStripFocus(k)}
                tabIndex={k === stripKey ? 0 : -1}
                aria-current={k === today ? "date" : undefined}
                aria-label={`${formatDateKo(k)}${dayEvents.length ? `, 일정 ${dayEvents.length}개` : ""}`}
                className={`anim-pick flex h-[70px] w-full flex-col items-center justify-center gap-1 rounded-[14px] ${sel ? "bg-strip-sel" : "bg-paper hover:bg-hover"}`}
              >
                <span aria-hidden="true" className={`text-[11px] font-medium leading-4 ${sel ? "text-on-strip-sel" : red ? "text-holiday" : "text-ink-2"}`}>
                  {WEEKDAYS[dow]}
                </span>
                <span aria-hidden="true" className={`text-[16px] font-bold leading-5 ${tone}`}>
                  {p.d}
                </span>
                <span aria-hidden="true" className="flex h-[5px] items-center gap-[3px]">
                  {density.dots.map((c, i) => (
                    <i key={i} className="block size-[6px] rounded-full" style={{ background: c }} />
                  ))}
                  {/* 달력 칸과 같은 규칙: +N = 점을 못 그린 일정 수, + = 참여자 점만 잘림 (#248 D-140) */}
                  {(density.more > 0 || density.cut) && (
                    <b className={`text-[9px] font-bold leading-[5px] ${sel ? "text-on-strip-sel" : "text-ink-2"}`}>+{density.more || ""}</b>
                  )}
                </span>
              </button>
            </div>
          );
        })}
        </div>
      </div>

      {/* (#378 B) 기념일 한 줄: 기념일이 있는 날만. 하트 + "처음 만난 날 100일" (+ 외 N개) + D-n. 누르면 기념일 화면 */}
      {ann && (
        <Link
          href={ANNIVERSARIES_PATH}
          className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-paper px-3.5 text-[14px] hover:bg-hover"
        >
          <IconHeart size={18} className="shrink-0 text-acc-ink" />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {occurrenceTitle(ann)}
            {anniversaries.length > 1 ? ` 외 ${anniversaries.length - 1}개` : ""}
          </span>
          <b className="shrink-0 text-[12px] font-bold text-acc-ink">{dayBadge(date, today)}</b>
          <IconChevronRight size={16} className="shrink-0 text-ink-2" />
        </Link>
      )}

      {/* (#378 B) 하루 막대: 언제 비는지. 빈 구간(코랄)을 누르면 그 시각으로 빠른 추가 */}
      {eventsError ? null : bar === null ? (
        <Skeleton className="mt-3 h-[76px] rounded-xl" />
      ) : (
        <DayBar
          className="mt-3"
          date={date}
          members={bar}
          title={date === today ? "오늘 하루" : "이날 하루"}
          now={date === today ? now : undefined}
          onSelect={onAddAt}
        />
      )}

      {/* 이날 일정 */}
      <section aria-labelledby={`${titleId}-list`} className="mt-[22px]">
        <div className="flex h-8 items-center">
          <h2 id={`${titleId}-list`} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
            이날 일정{events ? ` ${events.length}개` : ""}
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={onAdd} className="hit flex h-8 items-center gap-0.5 text-[13px] font-bold text-btn">
            <IconPlus size={14} strokeWidth={2.2} />이날 추가
          </button>
        </div>
        <div className="mt-2">
          {eventsError ? (
            <ErrorState message={eventsError} onRetry={onRetry} />
          ) : events === null ? (
            <div className="space-y-px overflow-hidden rounded-xl" aria-busy="true" aria-label="불러오는 중">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-[60px] rounded-none" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="flex h-11 items-center gap-1.5 text-[14px] text-ink-2">
              이날은 일정이 없어요.
              <button type="button" onClick={onAdd} className="font-bold text-btn">
                일정 추가
              </button>
            </p>
          ) : (
            <DayEventList events={events} date={date} today={today} now={now} onOpen={onOpenEvent} label={`${formatDateKo(date)} 일정`} />
          )}
        </div>
      </section>
    </div>
  );
}
