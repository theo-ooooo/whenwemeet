"use client";
// 날짜 상세 내용 (docs/설계/폴더블.md 5-2). 폰 바텀 시트(DaySheet) 와 넓은 화면 팝오버(DayPopover) 가 같이 쓴다.
// 단계: 날짜(그날 일정, 기념일, 비는 시간 한 줄, "이 날 일정 추가") → 빠른 추가(QuickAddForm) / 일정 상세(EventDetail)
// 단계 전환은 같은 표면 안에서 내용만 바꾼다. 주소(?day, &event, &add) 는 CalendarScreen 이 맡는다
import { useEffect, useRef } from "react";
import { EventDetail } from "./EventDetail";
import { IconCalendar, IconClock, IconClose, IconHeart, IconPlus } from "./icons";
import { QuickAddForm } from "./QuickAdd";
import { ErrorState, Skeleton } from "./ui";
import { memberColor } from "@/lib/colors";
import { dayBadge } from "@/lib/day-detail";
import { dowOf, formatEventTime, parseKey, timeOf, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import type { Anniversary, Event } from "@/lib/types";

/** 비는 시간 한 줄. null 이면 줄을 숨긴다 (멤버 1명, 지난 날, 계산 실패) */
export type FreeHint = { label: string; slot: { startsAt: string; endsAt: string } | null | "loading" } | null;

export type DayPanelStep = "day" | "event" | "add";

type Props = {
  groupId: number;
  date: DateKey;
  today: DateKey;
  step: DayPanelStep;
  titleId: string;
  /** 그날 일정. null = 불러오는 중 */
  events: Event[] | null;
  eventsError: string | null;
  onRetry: () => void;
  anniversaries: Anniversary[];
  free: FreeHint;
  /** 일정 상세 단계의 일정. undefined = 아직 못 찾음(불러오는 중) */
  event: Event | undefined;
  onClose: () => void;
  onBack: () => void;
  onAdd: () => void;
  onOpenEvent: (ev: Event) => void;
  onSaved: (ev: Event) => void;
  onDelete: () => void;
};

/** "10일 화요일" */
export function dayTitle(date: DateKey): string {
  return `${parseKey(date).d}일 ${WEEKDAYS[dowOf(date)]}요일`;
}

export function DayPanel(props: Props) {
  const { step } = props;
  const box = useRef<HTMLDivElement>(null);
  // 단계가 바뀌면 그 단계 제목으로 포커스 (빠른 추가는 제목 입력이 autoFocus)
  useEffect(() => {
    if (step === "add") return;
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [step, props.event?.id]);

  return (
    <div ref={box} key={step} className="anim-swap">
      {step === "add" ? (
        <QuickAddForm
          groupId={props.groupId}
          date={props.date}
          titleId={props.titleId}
          onClose={props.onClose}
          onBack={props.onBack}
          onSaved={props.onSaved}
        />
      ) : step === "event" ? (
        props.event ? (
          <EventDetail
            event={props.event}
            groupId={props.groupId}
            titleId={props.titleId}
            backLabel={dayTitle(props.date)}
            onBack={props.onBack}
            onClose={props.onClose}
            onDelete={props.onDelete}
          />
        ) : (
          <div aria-busy="true" className="space-y-2.5 py-2">
            <h2 id={props.titleId} className="sr-only">
              일정 불러오는 중
            </h2>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-14 w-full" />
          </div>
        )
      ) : (
        <DayBody {...props} />
      )}
    </div>
  );
}

function DayBody({ date, today, titleId, events, eventsError, onRetry, anniversaries, free, onClose, onAdd, onOpenEvent }: Props) {
  const holiday = holidayOf(date);
  const empty = events !== null && !eventsError && events.length === 0 && anniversaries.length === 0;

  return (
    <div className="flex flex-col">
      {/* 머리: "10일 화요일" + 오늘 + 공휴일 + 닫기 */}
      <div data-drag className="flex h-10 touch-none items-center gap-1.5">
        <h2 id={titleId} tabIndex={-1} data-autofocus className="text-[18px] font-bold leading-6 tracking-[-0.02em] outline-none">
          {dayTitle(date)}
        </h2>
        {date === today && <em className="text-[12px] font-bold not-italic text-today-ink">오늘</em>}
        {holiday && <span className="truncate text-[12px] font-medium text-holiday">{holiday}</span>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label="닫기" className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink">
          <IconClose size={18} />
        </button>
      </div>

      {/* 기념일 줄. #107(자동 표시) 은 lib/day-detail.ts anniversariesOn 이 돌려주는 목록만 늘린다 */}
      {anniversaries.length > 0 && (
        <ul className="mt-1">
          {anniversaries.map((a) => (
            <li key={a.id} className="flex h-9 items-center gap-2 text-[14px]">
              <IconHeart size={16} className="shrink-0 text-acc-ink" />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <b className="shrink-0 text-[12px] font-bold text-acc-ink">{dayBadge(date, today)}</b>
            </li>
          ))}
        </ul>
      )}

      {/* 그날 일정 */}
      {eventsError ? (
        <div className="mt-1">
          <ErrorState message={eventsError} onRetry={onRetry} />
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
      ) : events.length > 0 ? (
        <ul className="mt-0.5">
          {events.map((ev) => (
            <li key={ev.id}>
              <button
                type="button"
                onClick={() => onOpenEvent(ev)}
                className="-mx-1.5 flex min-h-11 w-[calc(100%+12px)] items-stretch gap-2.5 rounded-sm px-1.5 py-1 text-left hover:bg-hover"
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
      ) : null}

      {/* 비는 시간 한 줄 (멤버 2명 이상, 실패하면 숨김) */}
      {free && (
        <div className="flex h-9 items-center gap-2 text-[13px]">
          <IconClock size={16} className="shrink-0 text-acc-ink" />
          <span className="shrink-0">{free.label}</span>
          {free.slot === "loading" ? (
            <Skeleton className="h-3.5 w-24" />
          ) : free.slot ? (
            <b className="font-bold text-acc-ink">
              {timeOf(free.slot.startsAt)}~{timeOf(free.slot.endsAt)}
            </b>
          ) : (
            <span className="text-ink-2">없어요</span>
          )}
        </div>
      )}

      {/* 빈 날 */}
      {empty && (
        <div className="flex flex-col items-center py-5 text-center">
          <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-hover text-acc-ink">
            <IconCalendar size={20} />
          </span>
          <b className="mt-2.5 text-[15px] font-semibold leading-5">아직 일정이 없어요</b>
          <span className="mt-0.5 text-[13px] text-ink-2">이 날 함께할 일을 바로 적어 보세요</span>
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="mt-2.5 flex h-11 items-center justify-center gap-1.5 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
      >
        <IconPlus size={16} strokeWidth={2.2} />이 날 일정 추가
      </button>
    </div>
  );
}
