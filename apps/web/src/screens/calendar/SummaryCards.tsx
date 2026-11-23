"use client";
// (#484) 넓은 화면 요약 카드 (디자인규칙.md 2-2, 5: 3열 × 84, 라벨 13 --mute / 값 20/700). CalendarScreen 에서 옮김
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import type { nearestAnniversary } from "@/lib/day-detail";
import { timeOf } from "@/lib/date";
import type { upcomingSlots } from "@/lib/free-time";
import { ANNIVERSARIES_PATH, FREE_PATH, newEventHref } from "@/lib/routes";

const newEventLink = (start: string, end: string) => newEventHref({ start, end });

const sumCard =
  "flex h-[84px] min-w-0 flex-col justify-between rounded-xl bg-paper px-4 py-3.5 text-left main-cardstack:h-12 main-cardstack:flex-row main-cardstack:items-center main-cardstack:gap-3 main-cardstack:py-0";
const sumLabel = "block truncate text-[13px] leading-[18px] text-ink-2 main-cardstack:shrink-0";
const sumValue = "block truncate text-[20px] font-bold leading-7 tracking-[-0.02em] main-cardstack:text-[17px]";

type Props = {
  freeLabel: string;
  /** 오늘 비는 첫 구간. undefined 면 아직 받는 중, null 이면 없음 */
  todayFree: ReturnType<typeof upcomingSlots>[number] | null | undefined;
  todayFreeFailed: boolean;
  onRetryFree: () => void;
  /** 기념일 목록을 아직 못 받았다 */
  anniversariesLoading: boolean;
  nearest: ReturnType<typeof nearestAnniversary>;
  week: boolean;
  weekCardLabel: string;
  weekCount: number | null;
  weekFailed: boolean;
  onRetryWeek: () => void;
};

export function SummaryCards({
  freeLabel,
  todayFree,
  todayFreeFailed,
  onRetryFree,
  anniversariesLoading,
  nearest,
  week,
  weekCardLabel,
  weekCount,
  weekFailed,
  onRetryWeek,
}: Props) {
  const freeCard =
    todayFreeFailed && todayFree === undefined ? (
      <button type="button" onClick={onRetryFree} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-[15px] text-ink-2`}>계산 실패, 다시 시도</span>
      </button>
    ) : todayFree === undefined ? (
      <div className={sumCard} aria-busy="true">
        <span className={sumLabel}>{freeLabel}</span>
        <Skeleton className="h-6 w-28" />
      </div>
    ) : todayFree === null ? (
      <Link href={FREE_PATH} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-ink-2`}>없어요</span>
      </Link>
    ) : (
      <Link
        href={newEventLink(todayFree.startsAt, todayFree.endsAt)}
        aria-label={`${freeLabel} ${timeOf(todayFree.startsAt)}부터 ${timeOf(todayFree.endsAt)}까지, 눌러서 바로 약속 잡기`}
        className={`${sumCard} hover:bg-hover`}
      >
        <span className={sumLabel}>{freeLabel}</span>
        <span className={`${sumValue} text-acc-ink`}>
          {timeOf(todayFree.startsAt)}~{timeOf(todayFree.endsAt)}
        </span>
      </Link>
    );
  const annToday = nearest?.value === "오늘";
  const annCard =
    anniversariesLoading ? (
      <div className={sumCard} aria-busy="true">
        <span className={sumLabel}>오늘 기념일</span>
        <Skeleton className="h-6 w-24" />
      </div>
    ) : (
      <Link href={ANNIVERSARIES_PATH} className={`${sumCard} hover:bg-hover`}>
        <span className={sumLabel}>{annToday ? "오늘 기념일" : "다음 기념일"}</span>
        {nearest === null ? (
          <span className={`${sumValue} text-ink-2`}>없어요</span>
        ) : annToday ? (
          // 좁은 폭(884)에서 이름만 줄이고 "1000일" 은 남긴다 (QA3-L4)
          <span className="flex min-w-0 items-baseline gap-1 text-acc-ink">
            <span className={`${sumValue} min-w-0`}>{nearest.name}</span>
            {nearest.label && <span className={`${sumValue} shrink-0`}>{nearest.label}</span>}
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-2">
            <b className={`${sumValue} shrink-0`}>{nearest.value}</b>
            <span className="min-w-0 truncate text-[13px] font-medium text-soft">{nearest.name}</span>
            {nearest.label && <span className="-ml-1 shrink-0 text-[13px] font-medium text-soft">{nearest.label}</span>}
          </span>
        )}
      </Link>
    );
  const weekCard = (
    <div className={sumCard} aria-busy={weekCount === null && !weekFailed ? true : undefined}>
      <span className={sumLabel}>{weekCardLabel}</span>
      {!week && weekFailed ? (
        <button type="button" onClick={onRetryWeek} className={`${sumValue} text-left text-[15px] text-ink-2`}>
          불러오기 실패, 다시 시도
        </button>
      ) : weekCount === null ? (
        <Skeleton className="h-6 w-14" />
      ) : (
        <span className={sumValue}>{weekCount}개</span>
      )}
    </div>
  );

  return (
    // 넓은 화면 요약 카드 3열, 간격 12. 본문이 좁으면(main-cardstack, <640, #325) 3열이면 카드가 85px 남짓이라 값이 잘린다 →
    // 한 줄 카드(높이 48, 왼쪽 라벨, 오른쪽 값) 3장을 세로로
    <div className="mt-4 hidden shrink-0 grid-cols-3 gap-3 fold:grid main-cardstack:mt-3 main-cardstack:grid-cols-1 main-cardstack:gap-2">
      {freeCard}
      {annCard}
      {weekCard}
    </div>
  );
}
