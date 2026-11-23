"use client";
// (#484) 달력 제목줄: phone "11월" 줄 32, 넓은 화면 "2026년 11월" 줄 44. CalendarScreen 에서 옮김
import Link from "next/link";
import { IconChevronLeft, IconChevronRight, IconPlus, IconSparkle } from "@/components/icons";
import type { CalView } from "@/lib/calendar-view";
import type { DateKey } from "@/lib/date";
import { weekTitle } from "@/lib/week-layout";
import { ViewToggle } from "./ViewToggle";

type Common = {
  week: boolean;
  /** 주 보기 7일 (일~토) */
  days: DateKey[];
  y: number;
  m: number;
  thisYear: number;
  view: CalView;
  onChangeView: (v: CalView) => void;
  onToday: () => void;
  onGo: (n: number) => void;
};

/** phone: "11월" 제목줄 32 (제목 18/700 / 오늘 알약 + ‹ ›) */
export function PhoneTitleBar({ week, days, y, m, thisYear, view, onChangeView, onToday, onGo }: Common) {
  return (
    <div className="mt-1 flex h-8 items-center fold:hidden">
      <h1
        aria-label={week ? weekTitle(days, 0) : `${y}년 ${m}월`}
        className="min-w-0 truncate whitespace-nowrap text-[18px] font-bold leading-6 tracking-[-0.02em]"
      >
        {week ? weekTitle(days, thisYear, true) : y !== thisYear ? `${y}년 ${m}월` : `${m}월`}
      </h1>
      <span className="min-w-2 flex-1" />
      {/* (#192) 월 | 주 전환 (디자인규칙.md 2-5) */}
      <ViewToggle value={view} onChange={onChangeView} className="mr-2" />
      <button type="button" onClick={onToday} className="hit h-8 shrink-0 rounded-full bg-paper px-3 text-[13px] font-bold">
        오늘
      </button>
      <button type="button" onClick={() => onGo(-1)} aria-label={week ? "이전 주" : "이전 달"} className="hit ml-2 grid size-8 shrink-0 place-items-center rounded-full hover:bg-hover">
        <IconChevronLeft size={18} />
      </button>
      <button type="button" onClick={() => onGo(1)} aria-label={week ? "다음 주" : "다음 달"} className="hit ml-2 grid size-8 shrink-0 place-items-center rounded-full hover:bg-hover">
        <IconChevronRight size={18} />
      </button>
    </div>
  );
}

/** 넓은 화면 제목줄 44 (아래 주석) */
export function WideTitleBar({
  week,
  days,
  y,
  m,
  thisYear,
  view,
  onChangeView,
  onToday,
  onGo,
  assistantAvailable,
  aiButton,
  showAi,
  onToggleAi,
  newHref,
  addSecondary,
}: Common & {
  /** (#450) 서버에 AI 키가 있다 */
  assistantAvailable: boolean;
  aiButton: React.RefObject<HTMLButtonElement | null>;
  showAi: boolean;
  onToggleAi: () => void;
  newHref: string;
  /** (#339) 오른쪽 패널(일 상세, AI)이 열려 있어 "일정 추가" 를 보조 버튼으로 낮춘다 */
  addSecondary: boolean;
}) {
  return (
    // 넓은 화면 제목줄 44: "2026년 11월" 28/700, 오늘 알약, ‹ ›, 오른쪽 주 버튼 "일정 추가" (FAB 대신, 디자인규칙.md 2-2).
    // 본문이 좁은 폭(384 미만. 펼친 사이드바면 뷰포트 712 미만: 아이폰 듀오 펼침 세로 669, 폴드 세로) 에서는
    // 한 줄에 다 안 들어가 가로 스크롤이 생겼다. 제목만 첫 줄, 둘째 줄에 오늘 ‹ › 와 "+ 추가".
    // (#323) 뷰포트가 아니라 본문 폭(main-narrow/main-roomy)으로 고른다. 사이드바를 접으면 같은 뷰포트에서 본문이 192 넓다.
    // (#192) 주 보기 제목과 "월 | 주" 가 붙어 패널 옆 좁은 칸에서 "일정 추가" 가 다음 줄로 넘어갈 수 있다. 높이를 고정하지 않고(min-h) 오른쪽에 붙인다
    <div className="hidden shrink-0 flex-wrap items-center gap-2 fold:flex main-roomy:min-h-11">
      <h1 className="mr-2 shrink-0 whitespace-nowrap text-[28px] font-bold leading-9 tracking-[-0.02em] main-narrow:basis-full">
        {week ? weekTitle(days, thisYear) : `${y}년 ${m}월`}
      </h1>
      {/* (#192) 월 | 주 전환: 제목 옆, 오늘 알약 앞 (디자인규칙.md 2-5) */}
      <ViewToggle value={view} onChange={onChangeView} />
      <button type="button" onClick={onToday} className="hit h-8 shrink-0 whitespace-nowrap rounded-full bg-paper px-3.5 text-[13px] font-bold hover:bg-hover">
        오늘
      </button>
      {/* 화살표는 보이는 크기 32, 누르는 칸 44 가 겹치지 않게 중심 간격 44 (#133) */}
      <button type="button" onClick={() => onGo(-1)} aria-label={week ? "이전 주" : "이전 달"} className="hit ml-1 grid size-8 place-items-center rounded-full hover:bg-paper">
        <IconChevronLeft size={20} />
      </button>
      <button type="button" onClick={() => onGo(1)} aria-label={week ? "다음 주" : "다음 달"} className="hit ml-3 grid size-8 place-items-center rounded-full hover:bg-paper">
        <IconChevronRight size={20} />
      </button>
      <span className="flex-1" />
      {/* (#450) AI 볼까: "일정 추가" 왼쪽 보조(테두리) 버튼. 좁은 제목줄(main-narrow)은 아이콘 + "AI". 서버에 키가 없으면 숨긴다 */}
      {assistantAvailable && (
        <button
          ref={aiButton}
          type="button"
          onClick={onToggleAi}
          aria-expanded={showAi}
          className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-paper px-4 text-[14px] font-bold text-ink hover:brightness-95 main-narrow:px-3"
        >
          <IconSparkle size={18} className="text-pri" />
          <span>
            AI<span className="main-narrow:hidden"> 볼까</span>
          </span>
        </button>
      )}
      {/* (#339) 오른쪽 일 상세 패널이 열려 있으면 패널의 "이 날 일정 추가" 가 주 버튼이다. 한 화면 코랄 주 버튼 하나(디자인규칙.md 1-3, 2-4)라
          여기는 보조(테두리) 버튼으로 낮춘다 */}
      <Link
        href={newHref}
        aria-label="일정 추가"
        className={`ml-auto flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-4 text-[14px] font-bold hover:brightness-95 main-narrow:px-3 ${
          addSecondary ? "border border-line bg-paper text-ink" : "bg-btn text-on-btn"
        }`}
      >
        <IconPlus size={18} strokeWidth={2.2} />
        <span>
          <span className="main-narrow:hidden">일정 </span>추가
        </span>
      </Link>
    </div>
  );
}
