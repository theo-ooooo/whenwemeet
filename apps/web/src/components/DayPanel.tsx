"use client";
// 날짜 상세 내용. 넓은 화면 오른쪽 패널(DayDock, #331) 과 폰 일정 상세, 빠른 추가 바텀 시트(DaySheet) 가 같이 쓴다.
// 단계: 날짜(머리 "11월 14일 토요일" + ‹ 13 [14] 15 ›, 그날 기념일, 일정) → 빠른 추가(QuickAddForm) / 일정 상세(EventDetail)
// 날짜 단계는 넓은 화면에서만 그린다 (폰은 일 상세 화면 DayView, #212).
// (#378 B) 날짜 단계는 폰 일 상세(C안)와 같은 하루 막대(DayBar, 카드 없이)와 일정 줄(DayEventList → EventRow)을 쓴다.
// 비는 시간은 하루 막대가 보여 준다. "이 날 일정 추가" 는 목록과 같이 스크롤되면 바쁜 날 잘리므로 표면의 고정 바닥 바에 둔다: DayAddButton (#175)
// 단계 전환은 같은 표면 안에서 내용만 바꾼다. 주소(?day, &add, /events/<코드>) 는 CalendarScreen 이 맡는다
import Link from "next/link";
import { ANNIVERSARIES_PATH } from "@/lib/routes";
import { useEffect, useMemo, useRef } from "react";
import { DayBar } from "./DayBar";
import { DayEventList } from "./DayEvents";
import { EventDetail } from "./EventDetail";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconHeart, IconPlus } from "./icons";
import { QuickAddForm } from "./QuickAdd";
import { CloseButton, EmptyState, ErrorState, Skeleton } from "./ui";
import { busyByMember, dayWindow } from "@/lib/day-bar";
import { dayBadge } from "@/lib/day-detail";
import { panelDays, panelTitle } from "@/lib/day-panel";
import { dowOf, formatDateKo, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import { lunarLabelOf } from "@/lib/lunar";
import { lastInputWasKeyboard } from "@/lib/input-modality";
import { occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import type { Event, Member } from "@/lib/types";
import { eventKey } from "@/lib/recurrence";

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
  /** 그날 기념일 항목 전부 (lib/day-detail.ts anniversariesOn) */
  anniversaries: Occurrence[];
  /** 일정 상세 단계의 일정. undefined = 아직 못 찾음(불러오는 중) */
  event: Event | undefined;
  onClose: () => void;
  onBack: () => void;
  onOpenEvent: (ev: Event) => void;
  /** 머리 ‹ › 와 앞뒤 날짜로 다른 날 (#331) */
  onPickDay: (date: DateKey) => void;
  onSaved: (ev: Event) => void;
  onDelete: () => void;
  /** (#190) 일정 상세에서 참석 여부를 바꿨을 때 */
  onResponded?: () => void;
  /** (#192) 빠른 추가의 처음 시작 시각 'HH:mm' (주 보기 빈 칸). 없으면 폼 기본값 */
  addStart?: string | null;
  /** (#378 B) 팀 멤버 (하루 막대의 멤버별 바쁜 시간) */
  members?: Member[];
  /** 지금 (ms). 지난 일정 흐리게, 오늘이면 "지금" 선과 줄. 없으면 하루 막대와 흐림 없이 */
  now?: number;
  /** 하루 막대의 빈 구간을 눌렀을 때: 그 시각(ms)으로 빠른 추가 */
  onAddAt?: (start: number) => void;
  /** (#566) 머리 아래 "음력 10월 6일", 일정 상세 날짜 옆 음력 (내 정보 "달력에 음력 표시") */
  showLunar?: boolean;
};

/** "10일 화요일" */
export function dayTitle(date: DateKey): string {
  return `${parseKey(date).d}일 ${WEEKDAYS[dowOf(date)]}요일`;
}

export function DayPanel(props: Props) {
  const { step } = props;
  const box = useRef<HTMLDivElement>(null);
  const evKey = props.event ? eventKey(props.event) : null;
  // 단계가 바뀌면 그 단계 제목으로 포커스 (빠른 추가는 제목 입력이 autoFocus)
  useEffect(() => {
    if (step === "add") return;
    const el = box.current?.querySelector<HTMLElement>("[data-autofocus]");
    if (!el) return;
    // (#339) 마우스, 터치로 열었거나 주소로 바로 열었으면 테두리 없이 (globals.css [data-quiet-focus]). 키보드로 열었으면 보인다
    if (lastInputWasKeyboard()) delete el.dataset.quietFocus;
    else el.dataset.quietFocus = "";
    el.focus({ preventScroll: true });
  }, [step, evKey]);

  return (
    <div ref={box} key={step} className="anim-swap">
      {step === "add" ? (
        <QuickAddForm
          key={props.addStart ?? ""}
          initialStart={props.addStart ?? undefined}
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
            onResponded={props.onResponded}
            showLunar={props.showLunar}
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

function DayBody({
  date,
  today,
  titleId,
  events,
  eventsError,
  onRetry,
  anniversaries,
  onClose,
  onOpenEvent,
  onPickDay,
  members,
  now,
  onAddAt,
  showLunar = false,
}: Props) {
  const bar = useMemo(() => (events && members ? busyByMember(events, members, dayWindow(date)) : null), [events, members, date]);
  const holiday = holidayOf(date);
  const [prev, , next] = panelDays(date);
  const empty = events !== null && !eventsError && events.length === 0 && anniversaries.length === 0;
  const navBtn = "hit grid size-8 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-hover hover:text-ink";

  return (
    <div className="flex flex-col">
      {/* 머리: "11월 14일 토요일" + 오늘 + 공휴일 + 닫기 */}
      <div className="flex min-h-11 items-center gap-1.5">
        <h2 id={titleId} tabIndex={-1} data-autofocus className="min-w-0 truncate text-[18px] font-bold leading-6 tracking-[-0.02em] outline-none">
          {panelTitle(date)}
        </h2>
        {date === today && <em className="shrink-0 text-[12px] font-bold not-italic text-today-ink">오늘</em>}
        {holiday && <span className="min-w-0 truncate text-[12px] font-medium text-holiday">{holiday}</span>}
        <span className="flex-1" />
        <CloseButton onClick={onClose} className="-mr-1.5 shrink-0" />
      </div>
      {/* (#566) 음력 표시를 켰으면 제목 아래 한 줄 13 --mute */}
      {showLunar && lunarLabelOf(date) && <p className="-mt-1 text-[13px] leading-[18px] font-medium text-ink-2 tabular-nums">{lunarLabelOf(date)}</p>}

      {/* 앞뒤 날짜 ‹ 13 [14] 15 › (#331). 패널만 바뀌고 기록은 쌓지 않는다 (CalendarScreen changeDay) */}
      <nav aria-label="날짜 이동" className="-ml-1.5 flex h-10 items-center gap-1">
        <button type="button" onClick={() => onPickDay(prev)} aria-label="전날" className={navBtn}>
          <IconChevronLeft size={18} />
        </button>
        {panelDays(date).map((k) => {
          const sel = k === date;
          const dow = dowOf(k);
          const red = dow === 0 || dow === 6 || Boolean(holidayOf(k));
          return (
            <button
              key={k}
              type="button"
              onClick={() => onPickDay(k)}
              aria-pressed={sel}
              aria-label={`${formatDateKo(k)}${k === today ? ", 오늘" : ""}`}
              className={`anim-pick grid h-8 min-w-10 shrink-0 place-items-center rounded-full px-2 text-[14px] font-bold ${
                sel ? "bg-sel-fill text-on-pri" : `hover:bg-hover ${k === today ? "text-today-ink" : red ? "text-holiday" : "text-ink-2"}`
              }`}
            >
              <span aria-hidden="true">
                {parseKey(k).d}
                <small className="ml-0.5 text-[11px] font-medium">{WEEKDAYS[dow]}</small>
              </span>
            </button>
          );
        })}
        <button type="button" onClick={() => onPickDay(next)} aria-label="다음 날" className={navBtn}>
          <IconChevronRight size={18} />
        </button>
      </nav>

      {/* 기념일 줄: 그날 항목 전부 "처음 만난 날 300일" + 오늘 / D-3 / D+5. 누르면 기념일 화면 (#107, 기획 4장) */}
      {anniversaries.length > 0 && (
        <ul className="mt-1">
          {anniversaries.map((o) => (
            <li key={`${o.anniversary.id}-${o.type}`}>
              <Link href={ANNIVERSARIES_PATH} className="-mx-1.5 flex h-9 items-center gap-2 rounded-sm px-1.5 text-[14px] hover:bg-hover">
                <IconHeart size={16} className="shrink-0 text-acc-ink" />
                <span className="min-w-0 flex-1 truncate">{occurrenceTitle(o)}</span>
                <b className="shrink-0 text-[12px] font-bold text-acc-ink">{dayBadge(date, today)}</b>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* (#378 B) 하루 막대 (폰 일 상세와 같은 것, 패널 흰 면 위라 카드 없이). 빈 구간을 누르면 그 시각으로 빠른 추가 */}
      {bar && now !== undefined && !eventsError && (
        <DayBar
          bare
          className="mb-1 mt-2"
          date={date}
          members={bar}
          title={date === today ? "오늘 하루" : "이날 하루"}
          now={date === today ? now : undefined}
          onSelect={onAddAt}
        />
      )}

      {/* 그날 일정: 공통 일정 줄 (EventRow). 패널 흰 면 위라 줄 막대가 제목 선에 맞게 안쪽 여백만큼 내민다 */}
      {eventsError ? (
        <div className="mt-1">
          <ErrorState message={eventsError} onRetry={onRetry} />
        </div>
      ) : events === null ? (
        <div className="mt-1 space-y-2 py-1" aria-busy="true" aria-label="불러오는 중">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-12 items-center gap-2.5">
              <Skeleton className="h-8 w-1" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length > 0 ? (
        <DayEventList
          className="-mx-3.5 mt-1 rounded-none!"
          events={events}
          date={date}
          today={today}
          now={now ?? 0}
          onOpen={onOpenEvent}
          label={`${formatDateKo(date)} 일정`}
        />
      ) : null}

      {/* 빈 날: 공통 빈 상태(원 40, 제목 14/600, 보조 12) 와 같은 모양 (#174 L5) */}
      {empty && (
        <EmptyState className="py-5" icon={<IconCalendar size={20} />} title="아직 일정이 없어요">
          이날 함께할 일을 바로 적어 보세요
        </EmptyState>
      )}
    </div>
  );
}

/** 날짜 단계의 주 버튼. 표면(DayDock)의 footer 로 넘겨 스크롤 밖 바닥에 고정한다 (#175) */
export function DayAddButton({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-btn text-[13.5px] font-bold text-on-btn hover:brightness-95"
    >
      <IconPlus size={16} strokeWidth={2.2} />
      이날 일정 추가
    </button>
  );
}
