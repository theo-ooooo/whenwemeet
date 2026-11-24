"use client";
// (#484) 월 달력 타일: 요일 머리 + 날짜 칸 격자 + 겹쳐 그리는 여러 날 막대(넓은 화면), 이름 칩(폰). CalendarScreen 에서 옮김
import type { Occurrence } from "@/lib/anniversary";
import { parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import type { PhoneWeek } from "@/lib/month-lanes";
import type { Event } from "@/lib/types";
import { DayCell, WeekBar } from "./DayCell";
import { PhoneWeekChips } from "./PhoneMonthChips";
import type { MonthWeek } from "./useCalendarData";

type Props = {
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** 달력 좌우 스와이프 (#162) */
  swipeRef: React.RefObject<HTMLDivElement | null>;
  y: number;
  m: number;
  today: DateKey;
  selected: DateKey;
  wide: boolean;
  /** 떠 있는 날짜 상세의 날짜 */
  surfaceDate: DateKey | null;
  /** (#201) 격자의 Tab 정지점 */
  tabKey: DateKey;
  grid: DateKey[];
  weeks: MonthWeek[];
  phoneWeeks: PhoneWeek<Event>[];
  byDay: Map<DateKey, Event[]>;
  annByDay: Map<DateKey, Occurrence[]>;
  events: Event[] | null;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCell: (date: DateKey) => void;
  onFocusDay: (date: DateKey) => void;
  onOpenEvent: (date: DateKey, ev: Event) => void;
};

export function MonthGrid({
  gridRef,
  swipeRef,
  y,
  m,
  today,
  selected,
  wide,
  surfaceDate,
  tabKey,
  grid,
  weeks,
  phoneWeeks,
  byDay,
  annByDay,
  events,
  onKeyDown,
  onCell,
  onFocusDay,
  onOpenEvent,
}: Props) {
  return (
    // (#201) 격자: role=grid > row(요일 머리) + rowgroup > row(주, display:contents 라 모양은 그대로 7열 한 격자) > gridcell > 칸 버튼.
    // 겹쳐 그리는 막대, 이름 칩 층은 칸 내용의 시각 사본이라 읽지 않는다(aria-hidden). 키는 lib/calendar-keys.ts
    <div
      ref={gridRef}
      role="grid"
      aria-label={`${y}년 ${m}월`}
      onKeyDown={onKeyDown}
      className="mt-2 overflow-x-clip rounded-xl bg-paper px-1.5 pb-1 fold:mt-3 fold:flex fold:min-h-0 fold:flex-1 fold:flex-col fold:px-2"
    >
      <div role="row" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
        {WEEKDAYS.map((w, i) => (
          <span key={w} role="columnheader" aria-label={`${w}요일`} className={i === 0 || i === 6 ? "text-holiday" : ""}>
            {w}
          </span>
        ))}
      </div>
      {/* 날짜 칸 격자 위에 같은 줄 격자로 주마다 여러 날 일정 막대를 겹쳐 그린다 (#202, 넓은 화면) */}
      <div role="presentation" className="relative fold:flex fold:min-h-0 fold:flex-1 fold:flex-col">
        {/* touch-pan-y: 세로 스크롤은 브라우저가, 가로는 스와이프가 (#162) */}
        <div
          ref={swipeRef}
          role="rowgroup"
          className="grid touch-pan-y grid-cols-7 fold:min-h-0 fold:flex-1 fold:auto-rows-fr"
        >
          {weeks.map((w, r) => (
            <div key={w.packed.days[0]} role="row" className="contents">
              {grid.slice(r * 7, r * 7 + 7).map((key, col) => (
                <DayCell
                  key={key}
                  dateKey={key}
                  inMonth={parseKey(key).m === m}
                  isToday={key === today}
                  isSelected={key === selected}
                  isAnchor={wide && surfaceDate === key}
                  tabbable={key === tabKey}
                  events={byDay.get(key) ?? []}
                  anniversaries={annByDay.get(key) ?? []}
                  week={w.packed}
                  col={col}
                  fit2={w.fit2.days[col]}
                  fit3={w.fit3.days[col]}
                  phoneMore={phoneWeeks[r].more[col]}
                  loading={events === null}
                  onPick={() => onCell(key)}
                  onFocus={() => onFocusDay(key)}
                  onOpen={(ev) => onOpenEvent(key, ev)}
                />
              ))}
            </div>
          ))}
        </div>
        {events !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden grid-cols-7 fold:grid"
            style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
          >
            {weeks.map((w, r) => (
              // 칸(li) 과 같은 높이, 같은 위 1px 테두리라야 tall/taller 가 칸과 똑같이 갈린다
              <div key={w.packed.days[0]} className="relative border-t border-transparent [container-type:size]" style={{ gridRow: r + 1, gridColumn: "1 / -1" }}>
                {w.fit2.pieces.map((p) => (
                  <WeekBar key={`2@${p.key}@${p.col}`} piece={p} className="hidden tall:flex taller:hidden" onOpen={() => onOpenEvent(w.packed.days[p.col], p.event)} />
                ))}
                {w.fit3.pieces.map((p) => (
                  <WeekBar key={`3@${p.key}@${p.col}`} piece={p} className="hidden taller:flex" onOpen={() => onOpenEvent(w.packed.days[p.col], p.event)} />
                ))}
              </div>
            ))}
          </div>
        )}
        {/* (#355) 폰: 주마다 이름 칩을 칸 위에 겹쳐 그린다. 누르기는 아래 칸 버튼이 받는다(칸 = 일 상세) */}
        {events !== null && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid fold:hidden" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
            {phoneWeeks.map((pw, r) => (
              <PhoneWeekChips key={weeks[r].packed.days[0]} chips={pw.chips} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
