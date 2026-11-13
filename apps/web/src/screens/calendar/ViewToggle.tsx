"use client";
// (#192) 달력 보기 전환 "월 | 주" (디자인규칙.md 2-5). 높이 32, 모서리 10, 흰 면(--tile) 안에 두 칸.
// 선택 칸은 메뉴 선택과 같은 먹색 칩(--ink 면 + --on-ink 글자, 4-1). 제목줄이 --bg 위라 Segmented 의 --seg-on 흰 칸은 라이트에서 흰 면에 묻힌다
import type { CalView } from "@/lib/calendar-view";

const OPTIONS: { value: CalView; label: string; name: string }[] = [
  { value: "month", label: "월", name: "월 보기" },
  { value: "week", label: "주", name: "주 보기" },
];

export function ViewToggle({ value, onChange, className = "" }: { value: CalView; onChange: (v: CalView) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="달력 보기" className={`flex h-8 shrink-0 gap-0.5 rounded-sm bg-paper p-0.5 ${className}`}>
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.name}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const next = OPTIONS.find((x) => x.value !== value);
              if (!next) return;
              onChange(next.value);
              (e.currentTarget.parentElement?.querySelector(`[data-view="${next.value}"]`) as HTMLElement | null)?.focus();
            }}
            data-view={o.value}
            className={`anim-pick grid w-9 place-items-center rounded-[8px] text-[13px] whitespace-nowrap ${
              on ? "bg-ink font-bold text-on-ink" : "font-medium text-soft hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
