"use client";
// 날짜 피커 (#67). 브라우저 기본 input[type=date] 대신 쓴다.
// 월 달력: 일요일 시작, 주말과 공휴일(lib/holidays) 빨강, 오늘은 옅은 코랄 테두리, 선택일은 코랄 면.
// 키보드: 방향키 하루/한 주, PageUp/PageDown 한 달, Home/End 주 처음/끝, Enter 또는 Space 선택, Esc 닫기
import { useEffect, useId, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";
import { PickerShell, triggerClass } from "./PickerShell";
import { addDays, dowOf, formatDateKo, monthGrid, parseKey, shiftMonth, todayKey, WEEKDAYS, type DateKey } from "@/lib/date";
import { holidayOf } from "@/lib/holidays";

type Props = {
  value: DateKey;
  onChange: (v: DateKey) => void;
  /** 접근성 이름 (예: "시작 날짜") */
  label: string;
  id?: string;
  min?: DateKey;
  max?: DateKey;
  className?: string;
  /** 연도를 항상 보일지. 기본은 올해가 아닐 때만 */
  withYear?: boolean;
  "aria-describedby"?: string;
};

export function DatePicker({ value, onChange, label, id, min, max, className = "", withYear, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const showYear = withYear ?? (value ? parseKey(value).y !== parseKey(todayKey()).y : false);
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}, ${value ? formatDateKo(value, true) : "선택 안 함"}`}
        aria-describedby={rest["aria-describedby"]}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerClass} ${className}`}
      >
        <span className="truncate">{value ? formatDateKo(value, showYear) : "날짜 선택"}</span>
      </button>
      <PickerShell open={open} onClose={() => setOpen(false)} trigger={btn} title={label} width={312}>
        <Calendar
          value={value}
          min={min}
          max={max}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PickerShell>
    </>
  );
}

const navBtn = "flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink";

function clamp(key: DateKey, min?: DateKey, max?: DateKey): DateKey {
  if (min && key < min) return min;
  if (max && key > max) return max;
  return key;
}

function Calendar({ value, min, max, onPick }: { value: DateKey; min?: DateKey; max?: DateKey; onPick: (v: DateKey) => void }) {
  const today = todayKey();
  const start = clamp(value || today, min, max);
  const [focus, setFocus] = useState<DateKey>(start);
  const [view, setView] = useState(() => {
    const p = parseKey(start);
    return { y: p.y, m: p.m };
  });
  const grid = useRef<HTMLDivElement>(null);
  const headingId = useId();
  // 방향키로 옮긴 뒤에만 포커스를 따라간다 (월 버튼 클릭 때 포커스를 뺏지 않게)
  const moved = useRef(true);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-key="${focus}"]`)?.focus();
  }, [focus, view]);

  const days = monthGrid(view.y, view.m);
  const disabled = (k: DateKey) => Boolean((min && k < min) || (max && k > max));
  // Tab 으로 들어올 칸. 기준 날짜가 이 화면에 없으면 이 달의 첫 고를 수 있는 날
  const tabKey = days.includes(focus) ? focus : (days.find((k) => parseKey(k).m === view.m && !disabled(k)) ?? focus);

  function moveTo(k: DateKey) {
    const next = clamp(k, min, max);
    const p = parseKey(next);
    moved.current = true;
    setFocus(next);
    if (p.y !== view.y || p.m !== view.m) setView({ y: p.y, m: p.m });
  }

  // 월 버튼: 화면만 넘기고 키보드 기준 날짜도 그 달의 같은 날로 옮긴다 (DOM 포커스는 버튼에 둔다)
  function shiftView(n: number) {
    const next = shiftMonth(view.y, view.m, n);
    const k = sameDay(focus, n);
    setView(next);
    setFocus(disabled(k) ? clamp(k, min, max) : k);
  }

  function onKey(e: React.KeyboardEvent) {
    const b = tabKey;
    const map: Record<string, () => DateKey> = {
      ArrowLeft: () => addDays(b, -1),
      ArrowRight: () => addDays(b, 1),
      ArrowUp: () => addDays(b, -7),
      ArrowDown: () => addDays(b, 7),
      Home: () => addDays(b, -dowOf(b)),
      End: () => addDays(b, 6 - dowOf(b)),
      PageUp: () => sameDay(b, -1),
      PageDown: () => sameDay(b, 1),
    };
    const f = map[e.key];
    if (f) {
      e.preventDefault();
      moveTo(f());
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="flex">
          <button type="button" onClick={() => shiftView(-12)} aria-label="이전 해" className={navBtn}>
            <IconChevronLeft size={16} className="-mr-2.5" />
            <IconChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => shiftView(-1)} aria-label="이전 달" className={navBtn}>
            <IconChevronLeft size={18} />
          </button>
        </span>
        <h3 id={headingId} aria-live="polite" className="text-[15px] font-bold tracking-[-0.02em] tabular-nums">
          {view.y}년 {view.m}월
        </h3>
        <span className="flex">
          <button type="button" onClick={() => shiftView(1)} aria-label="다음 달" className={navBtn}>
            <IconChevronRight size={18} />
          </button>
          <button type="button" onClick={() => shiftView(12)} aria-label="다음 해" className={navBtn}>
            <IconChevronRight size={16} className="-mr-2.5" />
            <IconChevronRight size={16} />
          </button>
        </span>
      </div>
      <div role="grid" aria-labelledby={headingId} ref={grid} onKeyDown={onKey}>
        <div role="row" className="grid h-7 grid-cols-7 items-center text-center text-[11px] font-semibold text-ink-2">
          {WEEKDAYS.map((w, i) => (
            <span key={w} role="columnheader" aria-label={`${w}요일`} className={i === 0 || i === 6 ? "text-holiday" : ""}>
              {w}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div role="row" key={r} className="grid grid-cols-7 gap-y-0.5">
            {days.slice(r * 7, r * 7 + 7).map((k) => {
              const p = parseKey(k);
              const inMonth = p.m === view.m;
              const dow = dowOf(k);
              const holiday = holidayOf(k);
              const red = dow === 0 || dow === 6 || Boolean(holiday);
              const selected = k === value;
              const isToday = k === today;
              const off = disabled(k);
              // 선택 = --sel-fill 원 + 흰 숫자, 오늘 = 숫자만 --today-ink (D-57)
              const tone = selected
                ? "bg-sel-fill font-bold text-on-pri"
                : isToday
                  ? "font-bold text-today-ink hover:bg-hover"
                  : !inMonth
                    ? red
                      ? "font-medium text-holiday-faint"
                      : "font-medium text-faint"
                    : red
                      ? "font-semibold text-holiday hover:bg-hover"
                      : "font-semibold hover:bg-hover";
              return (
                <div role="gridcell" key={k} aria-selected={selected} className="grid place-items-center">
                  <button
                    type="button"
                    data-key={k}
                    tabIndex={k === tabKey ? 0 : -1}
                    disabled={off}
                    onClick={() => onPick(k)}
                    aria-label={`${formatDateKo(k, true)}${holiday ? `, ${holiday}` : ""}${isToday ? ", 오늘" : ""}`}
                    aria-current={isToday ? "date" : undefined}
                    title={holiday ?? undefined}
                    className={`anim-pick relative grid size-9 place-items-center rounded-full text-[13px] tabular-nums disabled:cursor-not-allowed disabled:opacity-30 ${tone}`}
                  >
                    {p.d}
                    {holiday && inMonth && !selected && (
                      <span aria-hidden="true" className="absolute bottom-0.5 size-1 rounded-full bg-holiday" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line px-1 pt-2">
        <span className="min-w-0 truncate text-[12px] text-ink-2">{holidayOf(focus) ?? ""}</span>
        <button
          type="button"
          disabled={disabled(today)}
          onClick={() => onPick(today)}
          className="h-8 shrink-0 rounded-sm bg-hover px-3 text-[13px] font-bold hover:brightness-95 disabled:opacity-40"
        >
          오늘
        </button>
      </div>
    </div>
  );
}

/** 한 달 앞/뒤 같은 날 (31일 → 다음 달 말일) */
function sameDay(key: DateKey, n: number): DateKey {
  const p = parseKey(key);
  const t = shiftMonth(p.y, p.m, n);
  const last = new Date(Date.UTC(t.y, t.m, 0)).getUTCDate();
  const d = Math.min(p.d, last);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
