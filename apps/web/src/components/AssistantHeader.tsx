"use client";
// (#450) 볼까 머리줄 (승인 시안): [‹ 또는 ✕] 반짝임 "볼까" 17/700 + "AI 비서" 표시(코랄 글자 + 1px 코랄 테두리, 모서리 6) ··· 팀 이름 12 `--mute`.
// 폰 전체 화면은 왼쪽 ‹ (start), 넓은 화면 패널은 오른쪽 ✕ (end)
import { forwardRef } from "react";
import { IconSparkle } from "./icons";

type Props = {
  titleId: string;
  teamName: string | null;
  /** 왼쪽 칸 (폰 ‹) */
  start?: React.ReactNode;
  /** 오른쪽 칸 (패널 ✕) */
  end?: React.ReactNode;
};

export const AssistantHeader = forwardRef<HTMLHeadingElement, Props>(function AssistantHeader({ titleId, teamName, start, end }, ref) {
  return (
    <div className="flex h-12 min-w-0 items-center gap-1.5">
      {start}
      <IconSparkle size={20} className="shrink-0 text-pri" />
      <h1 id={titleId} ref={ref} tabIndex={-1} className="shrink-0 text-[17px] font-bold leading-6 tracking-[-0.01em] outline-none">
        볼까
      </h1>
      <span className="shrink-0 rounded-[6px] border border-acc-ink px-1.5 text-[11px] font-semibold leading-4 text-acc-ink">AI 비서</span>
      <span className="min-w-2 flex-1" />
      {teamName && <span className="min-w-0 truncate text-[12px] leading-4 text-ink-2">{teamName}</span>}
      {end}
    </div>
  );
});
