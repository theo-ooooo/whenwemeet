"use client";
// (#378) 월, 일 고르기 (연도 없음, 내 생일). 날짜 피커(DatePicker)와 같은 틀(PickerShell: 폰 바텀 시트, 넓은 화면 팝오버)과 같은 칸 모양.
// 위 12달 칸(4열), 아래 그 달의 날(7열 원, 고른 날은 --sel-fill 면). 날을 누르면 정하고 닫는다. 2월은 29일까지 (lib/birthday MONTH_DAYS).
// 키보드: 달 칸과 날 칸은 각각 하나만 Tab 으로 들어오고 방향키, Home, End 로 옮긴다. Enter, Space 로 고른다. Esc 닫기
// (#562) lunar 면 음력 월일(달마다 30일까지, 29일인 해에는 마지막 날), withYear 면 위에 해 넘기기(‹ 2000년 ›)를 두어 음력 기념일 연월일을 고른다
import { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";
import { RowIcon } from "../ui";
import { PickerShell, triggerClassOf } from "./PickerShell";
import { MONTH_DAYS } from "@/lib/birthday";
import { formatLunar, LUNAR_MAX_YEAR } from "@/lib/lunar";

/** y 는 withYear 일 때만 */
export type MonthDay = { m: number; d: number; y?: number };

/** (#562) 음력 해 넘기기 범위. 1900년 앞은 쓰일 일이 없어 막는다 (변환표는 1000년부터) */
const LUNAR_MIN_PICK_YEAR = 1900;
const LUNAR_DAYS = 30;

type Props = {
  /** null = 아직 안 고름 */
  value: MonthDay | null;
  onChange: (v: MonthDay) => void;
  /** 읽기 이름, 시트 제목 (예: "생일") */
  label: string;
  /** 줄 왼쪽 아이콘 */
  icon?: React.ReactNode;
  id?: string;
  disabled?: boolean;
  /** (#562) 음력 월일 (달마다 30일까지). 줄 값은 "음력 3월 15일" */
  lunar?: boolean;
  /** (#562) 음력 윤달 (줄 값 "음력 윤4월 15일"에만 쓴다) */
  leap?: boolean;
  /** (#562) 해도 고른다 (음력 기념일). 값이 없을 때 처음 보일 해 */
  withYear?: boolean;
  defaultYear?: number;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function MonthDayPicker({ value, onChange, label, icon, id, disabled = false, lunar = false, leap = false, withYear = false, defaultYear }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = value
    ? lunar
      ? formatLunar(value.m, value.d, leap, withYear ? value.y : undefined)
      : `${withYear && value.y ? `${value.y}년 ` : ""}${value.m}월 ${value.d}일`
    : "고르기";
  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}, ${value ? shown : "선택 안 함"}`}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassOf("row")}
      >
        {icon && <RowIcon>{icon}</RowIcon>}
        <span className="shrink-0 text-[14px] font-semibold">{label}</span>
        <span className="ml-auto min-w-0 truncate text-[14px] text-ink-2 tabular-nums">{shown}</span>
        <IconChevronRight size={16} className="-mr-1 shrink-0 text-ink-2" />
      </button>
      <PickerShell open={open} onClose={() => setOpen(false)} trigger={btn} title={label} width={312}>
        <Grid
          value={value}
          lunar={lunar}
          year={withYear ? (value?.y ?? defaultYear ?? new Date().getFullYear()) : undefined}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PickerShell>
    </>
  );
}

const yearBtn = "hit flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40";

/** 방향키 이동 (cols 열 격자, 처음과 끝에서 돈다) */
function nextIndex(key: string, i: number, n: number, cols: number): number | null {
  const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: n - 1 };
  const to = map[key];
  if (to === undefined) return null;
  return Math.min(n - 1, Math.max(0, to));
}

function Grid({ value, onPick, lunar, year: initialYear }: { value: MonthDay | null; onPick: (v: MonthDay) => void; lunar: boolean; year?: number }) {
  const [month, setMonth] = useState(value?.m ?? 1);
  // (#562) 해 넘기기 (withYear 일 때만)
  const [year, setYear] = useState(initialYear);
  // 날 칸 중 Tab 으로 들어올 날. 달을 바꾸면 그 달 안으로 줄인다
  const [focusDay, setFocusDay] = useState(value?.d ?? 1);
  const days = lunar ? LUNAR_DAYS : MONTH_DAYS[month - 1];
  const day = Math.min(focusDay, days);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moved = useRef<"month" | "day" | null>(null);

  useEffect(() => {
    if (moved.current === "month") monthRefs.current[month - 1]?.focus();
    if (moved.current === "day") dayRefs.current[day - 1]?.focus();
    moved.current = null;
  }, [month, day]);

  const minYear = LUNAR_MIN_PICK_YEAR;
  const maxYear = LUNAR_MAX_YEAR;

  return (
    <div className="pb-1">
      {year !== undefined && (
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label="이전 해" disabled={year <= minYear} onClick={() => setYear(year - 1)} className={yearBtn}>
            <IconChevronLeft size={18} />
          </button>
          <b className="text-[15px] font-bold tabular-nums" aria-live="polite">
            {lunar ? `음력 ${year}년` : `${year}년`}
          </b>
          <button type="button" aria-label="다음 해" disabled={year >= maxYear} onClick={() => setYear(year + 1)} className={yearBtn}>
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
      <div role="radiogroup" aria-label="달" className="grid grid-cols-4 gap-1.5">
        {MONTHS.map((m) => {
          const on = m === month;
          return (
            <button
              key={m}
              ref={(el) => {
                monthRefs.current[m - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setMonth(m)}
              onKeyDown={(e) => {
                const to = nextIndex(e.key, m - 1, 12, 4);
                if (to === null) return;
                e.preventDefault();
                moved.current = "month";
                setMonth(to + 1);
              }}
              className={`anim-pick h-9 rounded-[8px] text-[13px] tabular-nums ${on ? "bg-ink font-bold text-on-ink" : "bg-surface font-semibold text-ink hover:brightness-95"}`}
            >
              {m}월
            </button>
          );
        })}
      </div>
      <div role="group" aria-label={`${month}월 날짜`} className="mt-3 grid grid-cols-7 gap-y-0.5 border-t border-line pt-3">
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const selected = value !== null && value.m === month && value.d === d && (year === undefined || value.y === year);
          return (
            <div key={d} className="grid place-items-center">
              <button
                ref={(el) => {
                  dayRefs.current[d - 1] = el;
                }}
                type="button"
                tabIndex={d === day ? 0 : -1}
                aria-label={`${month}월 ${d}일`}
                aria-pressed={selected}
                onClick={() => onPick(year === undefined ? { m: month, d } : { y: year, m: month, d })}
                onKeyDown={(e) => {
                  const to = nextIndex(e.key, d - 1, days, 7);
                  if (to === null) return;
                  e.preventDefault();
                  moved.current = "day";
                  setFocusDay(to + 1);
                }}
                className={`anim-pick grid size-9 place-items-center rounded-full text-[13px] tabular-nums ${
                  selected ? "bg-sel-fill font-bold text-on-pri" : "font-semibold hover:bg-hover"
                }`}
              >
                {d}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
