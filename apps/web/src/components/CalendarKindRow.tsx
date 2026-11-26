"use client";
// (#562, D-297) 기념일 폼, 내 생일 시트의 "양력 / 음력" 세그먼트와 음력일 때만 보이는 "윤달" 체크 한 칸.
// 줄 모양은 기념일 폼의 "종류" 칸과 같다 (이름 위, 세그먼트 아래). 그 해에 윤달이 없는지 같은 검사는 부르는 쪽이 폼 아래 한 줄로
import { useId } from "react";
import { Segmented } from "./ui";
import type { CalendarKind } from "@/lib/lunar";

const OPTIONS: { value: CalendarKind; label: string }[] = [
  { value: "SOLAR", label: "양력" },
  { value: "LUNAR", label: "음력" },
];

export function CalendarKindRow({
  calendar,
  onCalendar,
  leap,
  onLeap,
}: {
  calendar: CalendarKind;
  onCalendar: (v: CalendarKind) => void;
  leap: boolean;
  onLeap: (v: boolean) => void;
}) {
  const labelId = useId();
  const leapId = useId();
  return (
    <div className="pb-3 pt-2.5">
      <span id={labelId} className="mb-2 block text-[14px] font-semibold">
        달력
      </span>
      <Segmented labelledBy={labelId} value={calendar} options={OPTIONS} onChange={onCalendar} />
      {calendar === "LUNAR" && (
        <div className="mt-2.5 flex min-h-8 items-center gap-2">
          <input id={leapId} type="checkbox" checked={leap} onChange={(e) => onLeap(e.target.checked)} className="size-[18px] shrink-0 accent-[var(--pri)]" />
          <label htmlFor={leapId} className="text-[14px] font-semibold">
            윤달
          </label>
          <span className="t-sub min-w-0 truncate">없는 해에는 평달에 보여요</span>
        </div>
      )}
    </div>
  );
}
