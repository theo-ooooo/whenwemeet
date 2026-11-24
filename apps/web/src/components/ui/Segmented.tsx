"use client";

/* ---------- 세그먼트 ---------- */

/** 2~4개 중 하나 고르기 (내 정보 테마, 기념일 종류, 빈 시간 기간/최소 길이 #174 L2). 선택 칸은 --seg-on 면 + --seg-edge 테두리 (#135) */
export function Segmented<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid gap-1 rounded-sm bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`anim-pick hit flex h-9 items-center justify-center gap-1.5 rounded-[8px] border px-1 text-[13px] whitespace-nowrap ${
              on
                ? "border-[var(--seg-edge)] bg-[var(--seg-on)] font-bold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "border-transparent font-medium text-soft hover:text-ink"
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
