"use client";
// (#314) 일정 가져오기 미리보기 달력 (설계 `일정-가져오기.md` 5장, D-195). 달 격자(일요일 시작, KST, 주말과 공휴일 빨강)에
// 넣을 일정을 실제 달력처럼 보이고 골라서 넣는다. 날짜를 누르면 그날 일정 시트(줄마다 체크 + 이날 전체).
// 이동은 일정이 있는 달만 ◀ ▶ 와 달 고르기. 선택은 일정 단위("뺀 key" 집합, 부모가 가진다)
import { memo, useMemo, useState } from "react";
import { IconCheck, IconChevronLeft, IconChevronRight } from "./icons";
import { Sheet } from "./ui";
import { dowOf, formatDateKo, monthGrid, parseKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";
import { groupState, importMonths, itemsByDay, itemWhen, repeatBadge, selectedCount, selectionLabel, type SelectAction } from "@/lib/import-select";
import { eventDays, packWeek, phoneDayLanes, type PackedWeek } from "@/lib/month-lanes";
import type { ImportItem } from "@/lib/types";

type Dispatch = (action: SelectAction) => void;
/** month-lanes 는 숫자 id 로 일정을 가른다. key 대신 미리보기 순번을 쓴다 */
type CalItem = ImportItem & { id: number };

const EMPTY: readonly CalItem[] = [];

export function ImportCalendar({ items, excluded, dispatch }: { items: readonly ImportItem[]; excluded: ReadonlySet<string>; dispatch: Dispatch }) {
  const calItems = useMemo<CalItem[]>(() => items.map((item, id) => ({ ...item, id })), [items]);
  const months = useMemo(() => importMonths(calItems), [calItems]);
  const byDay = useMemo(() => itemsByDay(calItems) as Map<DateKey, CalItem[]>, [calItems]);
  const allKeys = useMemo(() => items.map((item) => item.key), [items]);
  // 미리보기를 새로 받으면 부모가 key 를 바꿔 다시 만든다 → 첫 달부터
  const [index, setIndex] = useState(0);
  const [openDay, setOpenDay] = useState<DateKey | null>(null);
  const month = months[Math.min(index, months.length - 1)];
  const all = groupState(items, excluded);
  if (!month) return null;
  const monthOn = groupState(month.items, excluded);

  return (
    <div>
      <div className="flex min-h-12 items-center gap-3 border-b border-line">
        <button
          type="button"
          role="checkbox"
          aria-checked={all}
          onClick={() => dispatch({ type: "set", keys: allKeys, on: all !== true })}
          className="hit flex min-h-11 items-center gap-2.5 rounded-sm text-[14px] font-bold"
        >
          <Check state={all} />
          전체
        </button>
        <span className="ml-auto text-[13px] font-semibold text-ink-2 tabular-nums" aria-live="polite">
          {selectionLabel(items.length, selectedCount(items, excluded))}
        </span>
      </div>

      {/* 달 이동: 일정이 있는 달만. 몇 년 치 파일도 고르기로 바로 간다 */}
      <div className="flex h-12 items-center gap-1 pt-1">
        <button
          type="button"
          aria-label="이전 달"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="hit grid size-9 place-items-center rounded-sm text-ink hover:bg-hover disabled:text-faint"
        >
          <IconChevronLeft size={20} />
        </button>
        <select
          aria-label="달 고르기"
          value={month.key}
          onChange={(e) => setIndex(months.findIndex((m) => m.key === e.target.value))}
          className="h-9 min-w-0 appearance-none rounded-sm bg-transparent px-1 text-center text-[17px] font-bold tracking-[-0.02em] hover:bg-hover"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.items.length.toLocaleString("en-US")})
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="다음 달"
          disabled={index >= months.length - 1}
          onClick={() => setIndex((i) => Math.min(months.length - 1, i + 1))}
          className="hit grid size-9 place-items-center rounded-sm text-ink hover:bg-hover disabled:text-faint"
        >
          <IconChevronRight size={20} />
        </button>
        <button
          type="button"
          role="checkbox"
          aria-checked={monthOn}
          aria-label={`${month.label} 전체`}
          onClick={() =>
            dispatch({
              type: "set",
              keys: month.items.map((item) => item.key),
              on: monthOn !== true,
            })
          }
          className="hit ml-auto flex min-h-9 items-center gap-1.5 rounded-sm text-[13px] font-semibold"
        >
          <Check state={monthOn} small />
          <span aria-hidden="true">이 달 전체</span>
          <span aria-hidden="true" className="text-[12px] font-medium text-ink-2 tabular-nums">
            {selectedCount(month.items, excluded)}/{month.items.length}
          </span>
        </button>
      </div>

      <MonthGrid y={month.y} m={month.m} byDay={byDay} excluded={excluded} onOpen={setOpenDay} />

      <DaySheet
        day={openDay}
        items={openDay ? (byDay.get(openDay) ?? EMPTY) : EMPTY}
        excluded={excluded}
        dispatch={dispatch}
        onClose={() => setOpenDay(null)}
      />
    </div>
  );
}

/** 6주 격자. 주마다 여러 날 일정의 레인을 실제 달력과 같은 규칙(month-lanes)으로 잡는다 */
function MonthGrid({
  y,
  m,
  byDay,
  excluded,
  onOpen,
}: {
  y: number;
  m: number;
  byDay: Map<DateKey, CalItem[]>;
  excluded: ReadonlySet<string>;
  onOpen: (day: DateKey) => void;
}) {
  const grid = useMemo(() => monthGrid(y, m), [y, m]);
  const weeks = useMemo(() => {
    const out: PackedWeek<CalItem>[] = [];
    for (let w = 0; w < 6; w++) {
      const days = grid.slice(w * 7, w * 7 + 7);
      // 달 밖 칸은 비운다 (그 일정은 자기 달에서 고른다)
      const inMonth = new Map(days.filter((d) => parseKey(d).m === m).map((d) => [d, byDay.get(d) ?? EMPTY] as const));
      out.push(packWeek(days, inMonth, multiDay));
    }
    return out;
  }, [grid, byDay, m]);

  return (
    <div>
      <div aria-hidden="true" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={i === 0 || i === 6 ? "text-holiday" : ""}>
            {w}
          </span>
        ))}
      </div>
      <ul aria-label={`${y}년 ${m}월 날짜`} className="grid grid-cols-7">
        {grid.map((day, i) => (
          <DayCell
            key={day}
            day={day}
            inMonth={parseKey(day).m === m}
            items={parseKey(day).m === m ? (byDay.get(day) ?? EMPTY) : EMPTY}
            week={weeks[Math.floor(i / 7)]}
            col={i % 7}
            excluded={excluded}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  );
}

/** 여러 날 일정은 막대로 (실제 달력과 같다) */
function multiDay(item: CalItem): boolean {
  const { first, last } = eventDays(item);
  return first !== last;
}

/**
 * 날짜 칸. 폰(52)은 실제 달력처럼 여러 날 4px 막대(2줄) + 점(최대 3 + "+N"), 폴드(76)는 제목 두 줄, lg(92)는 세 줄 + "+N개 더".
 * 고른 일정은 먹색, 뺀 일정은 테두리만 남은 점, 옅은 막대, 취소선 제목
 */
const DayCell = memo(function DayCell({
  day,
  inMonth,
  items,
  week,
  col,
  excluded,
  onOpen,
}: {
  day: DateKey;
  inMonth: boolean;
  items: readonly CalItem[];
  week: PackedWeek<CalItem>;
  col: number;
  excluded: ReadonlySet<string>;
  onOpen: (day: DateKey) => void;
}) {
  const dow = dowOf(day);
  const holiday = holidayOf(day);
  const red = dow === 0 || dow === 6 || Boolean(holiday);
  const numClass = !inMonth ? (red ? "text-holiday-faint" : "text-faint") : red ? "text-holiday" : "";
  const state = items.length ? groupState(items, excluded) : null;
  const picked = items.length ? selectedCount(items, excluded) : 0;
  const lanes = phoneDayLanes(week, col, 2);
  const dots = [...lanes.overflow, ...week.singles[col]];
  const label = `${formatDateKo(day, true)}${holiday ? `, ${holiday}` : ""}${items.length ? `, 일정 ${items.length}개 중 ${picked}개 선택` : ""}`;
  const on = (item: ImportItem) => !excluded.has(item.key);

  return (
    <li className="relative h-[52px] border-t border-line fold:h-[76px] lg:h-[92px]">
      {items.length > 0 ? (
        <button type="button" onClick={() => onOpen(day)} aria-haspopup="dialog" aria-label={label} className="absolute inset-0 hover:bg-hover/50" />
      ) : null}
      <div
        className={`pointer-events-none relative flex h-full flex-col items-center overflow-hidden px-[3px] pt-1 fold:items-stretch fold:px-1 ${state === false ? "opacity-45" : ""}`}
      >
        <span
          className={`grid size-[22px] shrink-0 place-items-center self-center rounded-full text-[13px] leading-none font-semibold fold:self-start ${numClass} ${
            state === false ? "line-through" : ""
          }`}
        >
          {parseKey(day).d}
        </span>
        {/* 폰: 막대 + 점 */}
        <span aria-hidden="true" className="block w-full fold:hidden">
          {lanes.lanes.map((s, i) => {
            const gap = i === 0 ? "mt-[3px]" : "mt-px";
            if (!s) return <span key={`gap${i}`} className={`${gap} block h-1`} />;
            const start = s.isStart && s.col === col;
            const end = s.isEnd && s.col + s.span - 1 === col;
            return (
              <span
                key={s.key}
                className={`${gap} block h-1 ${on(s.event) ? "bg-ink/80" : "bg-ink-2/30"} ${start ? "ml-1 rounded-l-[2px]" : "-ml-[3px]"} ${end ? "mr-1 rounded-r-[2px]" : "-mr-[3px]"}`}
              />
            );
          })}
          {dots.length > 0 && (
            <span className={`${lanes.lanes.length ? "mt-px" : "mt-0.5"} flex h-[7px] items-center justify-center gap-[3px]`}>
              {dots.slice(0, 3).map((ev) => (
                <i key={ev.key} className={`block size-[5px] rounded-full ${on(ev) ? "bg-ink" : "border border-ink-2"}`} />
              ))}
              {dots.length > 3 && <b className="text-[9px] leading-[7px] font-bold text-ink-2">+{dots.length - 3}</b>}
            </span>
          )}
        </span>
        {/* 넓은 화면: 제목 두 줄(폴드), 세 줄(lg) */}
        <span aria-hidden="true" className="mt-0.5 hidden min-w-0 fold:block">
          {items.slice(0, 3).map((ev, i) => (
            <span
              key={ev.key}
              className={`${i < 2 ? "block" : "hidden lg:block"} truncate text-[11px] leading-4 font-medium ${on(ev) ? "text-ink" : "text-ink-2 line-through"}`}
            >
              {ev.title}
            </span>
          ))}
          {items.length > 2 && <span className="block text-[11px] leading-4 font-medium text-ink-2 lg:hidden">+{items.length - 2}개 더</span>}
          {items.length > 3 && <span className="hidden text-[11px] leading-4 font-medium text-ink-2 lg:block">+{items.length - 3}개 더</span>}
        </span>
      </div>
    </li>
  );
});

/** 그날 일정 시트: 이날 전체 + 줄마다 체크. 여러 날 일정은 걸친 날마다 보인다 */
function DaySheet({
  day,
  items,
  excluded,
  dispatch,
  onClose,
}: {
  day: DateKey | null;
  items: readonly ImportItem[];
  excluded: ReadonlySet<string>;
  dispatch: Dispatch;
  onClose: () => void;
}) {
  const state = groupState(items, excluded);
  return (
    <Sheet open={day !== null && items.length > 0} onClose={onClose} title={day ? formatDateKo(day, true) : ""}>
      <button
        type="button"
        role="checkbox"
        aria-checked={state}
        onClick={() =>
          dispatch({
            type: "set",
            keys: items.map((item) => item.key),
            on: state !== true,
          })
        }
        className="flex min-h-12 w-full items-center gap-3 rounded-md border-b border-line text-left"
      >
        <Check state={state} />
        <span className="flex-1 text-[15px] font-bold">{state === true ? "이날 전체 넣기" : state === false ? "이날 전체 빼기" : "이날 일부만 넣기"}</span>
        <span className="text-[13px] font-semibold text-ink-2 tabular-nums">
          {selectedCount(items, excluded)}/{items.length}
        </span>
      </button>
      <ul className="pb-1">
        {items.map((item) => (
          <Row key={item.key} item={item} on={!excluded.has(item.key)} onToggle={() => dispatch({ type: "toggle", key: item.key })} />
        ))}
      </ul>
    </Sheet>
  );
}

function Row({ item, on, onToggle }: { item: ImportItem; on: boolean; onToggle: () => void }) {
  const badge = repeatBadge(item.repeat);
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={onToggle}
        className="flex min-h-[52px] w-full items-center gap-3 rounded-md py-1.5 text-left hover:bg-hover"
      >
        <Check state={on} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] leading-5 font-semibold ${on ? "" : "text-ink-2 line-through"}`}>{item.title}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-2 tabular-nums">{itemWhen(item)}</span>
        </span>
        {badge && <span className="shrink-0 rounded-[5px] bg-hover px-1.5 py-0.5 text-[11px] leading-4 font-medium text-soft">{badge}</span>}
      </button>
    </li>
  );
}

/** 체크 표시. 켜짐은 먹색 면 + 체크(일정이 수백 개라 코랄 면을 쓰지 않는다, 디자인규칙 1-3), 일부는 가로줄, 꺼짐은 테두리만 */
function Check({ state, small = false }: { state: boolean | "mixed"; small?: boolean }) {
  const filled = state !== false;
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[6px] border-[1.5px] ${small ? "size-[18px]" : "size-[22px]"} ${filled ? "border-ink bg-ink text-on-ink" : "border-ink-2/50"}`}
    >
      {state === true && <IconCheck size={small ? 12 : 14} strokeWidth={2.6} />}
      {state === "mixed" && <span className="h-[2px] w-2.5 rounded-full bg-on-ink" />}
    </span>
  );
}
