"use client";
// (#189) 진행 중 약속 투표 입구 (설계 약속-투표.md 5-2, Q5).
//   PollHomeSection: 폰 홈 "다가오는 일정" 위 구역 "정하는 중". 가로 카드 148(제목 15/600 두 줄 / 응답 수 12 --mute / 마감 12 --acc-ink).
//   PollSideLine:    넓은 화면 사이드바 "다가오는 일정" 묶음 위 한 줄 (가장 급한 투표 + 나머지 수).
//                    폰 홈 달력 위에도 같은 한 줄을 카드로 둔다. 아래 "정하는 중" 구역은 달력 밑이라 스크롤해야 보였다
// 투표가 있을 때만 그린다. 빈 구역 규칙(디자인규칙.md 5장)의 예외: 상시 기능이 아니라 없을 때는 자리도 두지 않는다
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePolls, useRefetchOnVisible } from "@/hooks";
import { deadlineText, responseText } from "@/lib/poll";
import { pollHref } from "@/lib/routes";
import type { PollSummary } from "@/lib/types";
import { IconPoll } from "./icons";

/** 카드에 쓸 둘째, 셋째 줄 */
function lines(p: PollSummary): { sub: string; due: string | null } {
  if (p.allPast) return { sub: "후보 시간이 모두 지났어요", due: "지난 투표" };
  return { sub: responseText(p), due: deadlineText(p) };
}

export function PollHomeSection({ groupId, enabled, titleId }: { groupId: number; enabled: boolean; titleId: string }) {
  const q = usePolls(groupId, { enabled });
  useRefetchOnVisible(q.refetch, enabled);
  const polls = q.data;
  if (!enabled || !polls || polls.length === 0) return null;
  const rail = "-mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  return (
    <section aria-labelledby={titleId} className="mt-[22px]">
      <div className="mb-2 flex h-8 items-center">
        <h2 id={titleId} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
          정하는 중
        </h2>
      </div>
      <ul className={rail}>
        {polls.map((p) => {
          const { sub, due } = lines(p);
          return (
            <li key={p.id} className="shrink-0 snap-start">
              <Link
                href={pollHref(p)}
                aria-label={`${p.title} 투표, ${sub}${due ? `, ${due}` : ""}`}
                className={`flex h-[108px] w-[148px] flex-col rounded-xl bg-paper px-3.5 py-3 text-left hover:bg-hover ${p.allPast ? "opacity-60" : ""}`}
              >
                <b aria-hidden="true" className="line-clamp-2 text-[15px] font-semibold leading-5">
                  {p.title}
                </b>
                <span className="flex-1" />
                <span aria-hidden="true" className="truncate text-[12px] leading-4 text-ink-2">
                  {sub}
                </span>
                {due && (
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 truncate text-[12px] font-semibold leading-4 ${p.expired || p.allPast ? "text-ink-2" : "text-acc-ink"}`}
                  >
                    {due}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SIDE_LINE = "mb-2 flex h-12 shrink-0 items-center gap-2.5 rounded-sm px-3 py-1.5 hover:bg-hover";

export function PollSideLine({
  groupId,
  enabled,
  refreshKey,
  className = SIDE_LINE,
}: {
  groupId: number;
  enabled: boolean;
  refreshKey: unknown;
  /** 바깥 모양. 기본은 사이드바 한 줄, 폰 홈은 카드 */
  className?: string;
}) {
  const q = usePolls(groupId, { enabled });
  useRefetchOnVisible(q.refetch, enabled);
  // 화면을 옮기면(투표를 열거나 정한 뒤 포함) 다시 받는다. 처음 한 번은 훅이 이미 받는다
  const refetch = q.refetch;
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    if (enabled) void refetch();
  }, [refreshKey, enabled, refetch]);
  const polls = q.data;
  if (!enabled || !polls || polls.length === 0) return null;
  const [first] = polls;
  const more = polls.length - 1;
  const { sub, due } = lines(first);
  return (
    <Link href={pollHref(first)} aria-label={`정하는 중: ${first.title}, ${sub}${more > 0 ? `, 외 ${more}개` : ""}`} className={className}>
      <IconPoll size={18} className="shrink-0 text-acc-ink" />
      <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col justify-center">
        <b className="block truncate text-[14px] font-semibold leading-[18px]">
          {first.title}
          {more > 0 && <span className="font-normal text-ink-2"> 외 {more}개</span>}
        </b>
        <span className="block truncate text-[12px] leading-4 text-ink-2">{due ?? sub}</span>
      </span>
    </Link>
  );
}
