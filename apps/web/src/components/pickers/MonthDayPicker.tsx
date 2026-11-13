"use client";
// (#378) 월, 일 고르기 (연도 없음, 내 생일). 날짜 피커(DatePicker)와 같은 틀(PickerShell: 폰 바텀 시트, 넓은 화면 팝오버)과 같은 칸 모양.
// 위 12달 칸(4열), 아래 그 달의 날(7열 원, 고른 날은 --sel-fill 면). 날을 누르면 정하고 닫는다. 2월은 29일까지 (lib/birthday MONTH_DAYS).
// 키보드: 달 칸과 날 칸은 각각 하나만 Tab 으로 들어오고 방향키, Home, End 로 옮긴다. Enter, Space 로 고른다. Esc 닫기
import { useEffect, useRef, useState } from "react";
import { IconChevronRight } from "../icons";
import { RowIcon } from "../ui";
import { PickerShell, triggerClassOf } from "./PickerShell";
import { MONTH_DAYS, clampDay } from "@/lib/birthday";

export type MonthDay = { m: number; d: number };

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
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function MonthDayPicker({ value, onChange, label, icon, id, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const shown = value ? `${value.m}월 ${value.d}일` : "고르기";
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
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PickerShell>
    </>
  );
}

/** 방향키 이동 (cols 열 격자, 처음과 끝에서 돈다) */
function nextIndex(key: string, i: number, n: number, cols: number): number | null {
  const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: n - 1 };
  const to = map[key];
  if (to === undefined) return null;
  return Math.min(n - 1, Math.max(0, to));
}

function Grid({ value, onPick }: { value: MonthDay | null; onPick: (v: MonthDay) => void }) {
  const [month, setMonth] = useState(value?.m ?? 1);
  // 날 칸 중 Tab 으로 들어올 날. 달을 바꾸면 그 달 안으로 줄인다
  const [focusDay, setFocusDay] = useState(value?.d ?? 1);
  const day = clampDay(month, focusDay);
  const monthRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const moved = useRef<"month" | "day" | null>(null);

  useEffect(() => {
    if (moved.current === "month") monthRefs.current[month - 1]?.focus();
    if (moved.current === "day") dayRefs.current[day - 1]?.focus();
    moved.current = null;
  }, [month, day]);

  const days = MONTH_DAYS[month - 1];

  return (
    <div className="pb-1">
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
          const selected = value !== null && value.m === month && value.d === d;
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
                onClick={() => onPick({ m: month, d })}
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
