"use client";
// 폰(<600) 일 상세 (디자인규칙.md 2-3 시안 B, #212). 날짜 바텀 시트(DaySheet) 의 날짜 단계를 대신한다.
// 제목 "11월 10일 (화)" + "월 보기" 알약 → 주간 줄 7칸 → 그날 요약 카드(비는 시간, 기념일) → 이날 일정 목록.
// 주소와 기록(?day=1, pushState, 뒤로가기 = 월 보기) 은 CalendarScreen 이 맡는다. 일정 상세, 빠른 추가는 그 위에 DaySheet 로 뜬다
import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconCalendar, IconFree, IconHeart, IconPlus } from "./icons";
import type { FreeHint } from "./DayPanel";
import { ErrorState, Skeleton } from "./ui";
import { occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import { cellDensity } from "@/lib/calendar-cell";
import { memberColor } from "@/lib/colors";
import { dayBadge } from "@/lib/day-detail";
import { timeColumn, weekStrip } from "@/lib/day-view";
import { dowOf, formatDateKo, formatEventTime, parseKey, timeOf, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import type { Event } from "@/lib/types";

type Props = {
  groupId: number;
  date: DateKey;
  today: DateKey;
  titleId: string;
  /** 날짜별 일정 (보는 달 그리드 범위). null = 불러오는 중 */
  byDay: Map<DateKey, Event[]> | null;
  eventsError: string | null;
  onRetry: () => void;
  /** 그날 기념일 항목 전부 */
  anniversaries: Occurrence[];
  /** 비는 시간 한 줄. null 이면 지난 날 또는 계산 실패 */
  free: FreeHint;
  /** 주간 줄 스와이프 (useMonthSwipe 의 ref) */
  stripRef: React.Ref<HTMLUListElement>;
  onPickDay: (date: DateKey) => void;
  onMonth: () => void;
  onOpenEvent: (ev: Event) => void;
  onAdd: () => void;
  newEventHref: (start: string, end: string) => string;
};

export function DayView({
  groupId,
  date,
  today,
  titleId,
  byDay,
  eventsError,
  onRetry,
  anniversaries,
  free,
  stripRef,
  onPickDay,
  onMonth,
  onOpenEvent,
  onAdd,
  newEventHref,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  // 열면 맨 위로, 닫으면 달력을 보던 자리로 (본문 흐름 안에 그리므로 스크롤을 직접 맞춘다)
  useEffect(() => {
    const y = window.scrollY;
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
    return () => window.scrollTo(0, y);
  }, []);

  const week = weekStrip(date);
  const events = byDay ? (byDay.get(date) ?? []) : null;
  const holiday = holidayOf(date);
  const ann = anniversaries[0] ?? null;

  return (
    <div className="pt-1">
      {/* 제목줄 32: "11월 10일 (화)" 18/700 + 오른쪽 "월 보기" 알약 */}
      <div className="flex h-10 items-center gap-2">
        <h1 id={titleId} ref={heading} tabIndex={-1} className="min-w-0 truncate text-[18px] font-bold leading-6 tracking-[-0.02em] outline-none">
          {formatDateKo(date)}
        </h1>
        {date === today && <em className="shrink-0 text-[12px] font-semibold not-italic text-today-ink">오늘</em>}
        {holiday && <span className="min-w-0 truncate text-[12px] font-medium text-holiday">{holiday}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onMonth}
          className="hit flex h-8 shrink-0 items-center gap-1 rounded-full bg-paper px-3 text-[13px] font-bold"
        >
          <IconCalendar size={16} />월 보기
        </button>
      </div>

      {/* 주간 줄 7칸 (높이 70, 모서리 14). 누르면 그날로, 옆으로 넘기면 지난주/다음 주 같은 요일로 */}
      <ul ref={stripRef} aria-label="이번 주" className="mt-2 grid touch-pan-y grid-cols-7 gap-1.5">
        {week.map((k) => {
          const sel = k === date;
          const p = parseKey(k);
          const dow = dowOf(k);
          const red = dow === 0 || dow === 6 || Boolean(holidayOf(k));
          const dayEvents = byDay?.get(k) ?? [];
          const dots = cellDensity(dayEvents).dots;
          const tone = sel ? "text-on-pri" : k === today ? "text-today-ink" : red ? "text-holiday" : "";
          return (
            <li key={k}>
              <button
                type="button"
                onClick={() => onPickDay(k)}
                aria-pressed={sel}
                aria-label={`${formatDateKo(k)}${k === today ? ", 오늘" : ""}${dayEvents.length ? `, 일정 ${dayEvents.length}개` : ""}`}
                className={`anim-pick flex h-[70px] w-full flex-col items-center justify-center gap-1 rounded-[14px] ${sel ? "bg-sel-fill" : "bg-paper hover:bg-hover"}`}
              >
                <span aria-hidden="true" className={`text-[11px] font-medium leading-4 ${sel ? "text-on-pri" : red ? "text-holiday" : "text-ink-2"}`}>
                  {WEEKDAYS[dow]}
                </span>
                <span aria-hidden="true" className={`text-[16px] font-bold leading-5 ${tone}`}>
                  {p.d}
                </span>
                <span aria-hidden="true" className="flex h-[5px] items-center gap-[3px]">
                  {dots.map((c, i) => (
                    <i key={i} className="block size-[5px] rounded-full" style={{ background: memberColor(c) }} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* 그날 요약: 흰 카드 한 장에 두 줄 (겹침 아이콘 20 + 라벨 14 + 값 15/700 --acc-ink) */}
      <div className="mt-[22px] rounded-xl bg-paper px-3.5">
        <SummaryRow icon={<IconFree size={20} />} label={free?.label ?? "비는 시간"}>
          {free === null ? (
            <span className="text-[14px] text-ink-2">{date < today ? "지난 날이에요" : "계산하지 못했어요"}</span>
          ) : free.slot === "loading" ? (
            <Skeleton className="h-4 w-24" />
          ) : free.slot ? (
            <Link
              href={newEventHref(free.slot.startsAt, free.slot.endsAt)}
              aria-label={`${free.label} ${timeOf(free.slot.startsAt)}부터 ${timeOf(free.slot.endsAt)}까지, 눌러서 바로 약속 잡기`}
              className="text-[15px] font-bold text-acc-ink hover:underline underline-offset-2"
            >
              {timeOf(free.slot.startsAt)}~{timeOf(free.slot.endsAt)}
            </Link>
          ) : (
            <Link href={`/g/${groupId}/free`} className="text-[14px] text-ink-2 hover:underline underline-offset-2">
              없어요, 다른 날 찾기
            </Link>
          )}
        </SummaryRow>
        <div aria-hidden="true" className="h-px bg-line" />
        <SummaryRow icon={<IconHeart size={20} />} label="기념일">
          {ann ? (
            <Link href={`/g/${groupId}/anniversaries`} className="min-w-0 truncate text-[15px] font-bold text-acc-ink hover:underline underline-offset-2">
              {occurrenceTitle(ann)}
              {anniversaries.length > 1 ? ` 외 ${anniversaries.length - 1}개` : ""}
              {date !== today ? ` ${dayBadge(date, today)}` : ""}
            </Link>
          ) : (
            <span className="text-[14px] text-ink-2">없어요</span>
          )}
        </SummaryRow>
      </div>

      {/* 이날 일정 */}
      <section aria-labelledby={`${titleId}-list`} className="mt-[22px]">
        <div className="flex h-8 items-center">
          <h2 id={`${titleId}-list`} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
            이날 일정{events ? ` ${events.length}개` : ""}
          </h2>
          <span className="flex-1" />
          <button type="button" onClick={onAdd} className="hit flex h-8 items-center gap-0.5 text-[13px] font-bold text-btn">
            <IconPlus size={14} strokeWidth={2.2} />이 날 추가
          </button>
        </div>
        <div className="mt-2">
          {eventsError ? (
            <ErrorState message={eventsError} onRetry={onRetry} />
          ) : events === null ? (
            <ul className="space-y-2.5" aria-busy="true" aria-label="불러오는 중">
              {[0, 1].map((i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-12 shrink-0 space-y-1 pt-2.5">
                    <Skeleton className="h-2.5 w-6" />
                    <Skeleton className="h-4 w-9" />
                  </span>
                  <Skeleton className="h-[60px] flex-1 rounded-xl" />
                </li>
              ))}
            </ul>
          ) : events.length === 0 ? (
            <p className="flex h-11 items-center gap-1.5 text-[14px] text-ink-2">
              이 날은 일정이 없어요.
              <button type="button" onClick={onAdd} className="font-bold text-btn">
                일정 추가
              </button>
            </p>
          ) : (
            <ul className="space-y-2.5">
              {events.map((ev) => {
                const col = timeColumn(ev, date);
                return (
                  <li key={ev.id} className="flex gap-2">
                    <span aria-hidden="true" className="flex w-12 shrink-0 flex-col pt-2.5">
                      <small className="text-[11px] leading-4 text-ink-2">{col.label}</small>
                      {col.value && <b className="text-[16px] font-bold leading-5 tracking-[-0.02em]">{col.value}</b>}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenEvent(ev)}
                      aria-haspopup="dialog"
                      aria-label={`${ev.title}, ${formatEventTime(ev.startsAt, ev.endsAt, ev.allDay)}, ${ev.creator.displayName}`}
                      className="flex min-h-[60px] min-w-0 flex-1 items-stretch gap-2.5 rounded-xl bg-paper px-3.5 py-2.5 text-left hover:bg-hover"
                    >
                      <i aria-hidden="true" className="block w-[3px] shrink-0 rounded-[2px]" style={{ background: memberColor(ev.creator.color) }} />
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
        </div>
      </section>
    </div>
  );
}

function SummaryRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-2.5">
      <span aria-hidden="true" className="shrink-0 text-ink-2">
        {icon}
      </span>
      <span className="shrink-0 text-[14px]">{label}</span>
      <span className="ml-auto flex min-w-0 items-center justify-end">{children}</span>
    </div>
  );
}
