"use client";

/** 스위치 모양 (40×24, 켬 `--pri`). Toggle, ToggleRow 가 같이 쓴다 */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden="true" className={`anim-pick relative inline-block h-6 w-10 shrink-0 rounded-full ${checked ? "bg-pri" : "bg-faint"}`}>
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-paper transition-transform duration-120 ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </span>
  );
}
