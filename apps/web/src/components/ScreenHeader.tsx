"use client";
// (#378) 하위 화면 머리줄 하나: "‹ 제목 ········ ⋯". 디자인규칙.md 8-1.
// 예전 "뒤로" 알약(새 소식, 내 정보, 알림), "‹ 달력" 알약(다가오는 일정, 검색), "‹" 아이콘(할 일 상세)을 이 모양 하나로 바꾼다.
// - ‹ 는 링크(fallbackHref). 이 앱 안에서 넘어왔으면 눌렀을 때 브라우저 뒤로(lib/back-nav.ts), 아니면 링크 그대로 이동
// - 제목은 화면의 h1 (20/700, 한 줄 말줄임). 오른쪽 칸(right)에는 그 화면의 OverflowMenu 하나만 둔다
// - ‹ 와 오른쪽 칸은 누르는 영역 44×44. 칸 안쪽 아이콘이 본문 왼쪽 선(좌우 여백)에 맞게 -10 씩 내민다
// (#552, D-295) 폰(<600)에서는 이 머리줄이 있으면 앱 위쪽 바(심볼, 팀 이름, 검색, 종, 아바타)를 숨기고 이 줄 하나만 둔다.
//   판단은 data-screen-header 하나로 CSS 가 한다(globals.css `[data-app-shell]:has(main [data-screen-header])`). 화면 목록을 따로 두지 않고,
//   서버가 그린 첫 화면부터 적용돼 위쪽 바가 잠깐 비치지 않는다. 그래서 폰에서는 이 줄이 안전 영역(노치) 여백을 갖고,
//   본문을 올려도 위에 붙어 있게 sticky + 화면 바탕색(--bg). 위 4 + 줄 44 + 아래 4 = 52 로 앱 위쪽 바와 높이가 같다.
//   넓은 화면(≥600)은 사이드바 구조라 예전 그대로(붙지 않고 위 4)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconChevronLeft } from "./icons";
import { canGoBack } from "@/lib/back-nav";

type Props = {
  title: string;
  /** 앱 안 기록이 없을 때(알림, 외부 링크로 바로 연 경우) 갈 화면 */
  fallbackHref: string;
  /** ‹ 의 읽기 이름. 기본 "뒤로" */
  backLabel?: string;
  /** 오른쪽 칸. OverflowMenu 하나 (없으면 비운다) */
  right?: React.ReactNode;
  /** 제목 아래 작은 한 줄 (예: "남은 3개"). 12 `--mute` */
  subtitle?: React.ReactNode;
  /** "phone" 이면 넓은 화면(≥600, 사이드바가 있는 곳)에서 ‹ 를 숨긴다 */
  back?: "always" | "phone";
  /** (#378) 주면 ‹ 를 누를 때 이동하지 않고 이걸 부른다 (작성 중 이탈 확인이 있는 입력 화면). 새 탭, 가운데 클릭은 링크 그대로 */
  onBack?: () => void;
  className?: string;
};

export function ScreenHeader({ title, fallbackHref, backLabel = "뒤로", right, subtitle, back = "always", onBack, className = "" }: Props) {
  const router = useRouter();
  return (
    <div
      data-screen-header=""
      className={`sticky top-0 z-20 -mx-5 bg-surface px-5 pb-1 pt-[calc(4px+env(safe-area-inset-top))] fold:static fold:mx-0 fold:bg-transparent fold:px-0 fold:pb-0 fold:pt-1 ${className}`}
    >
      <div className="flex h-11 items-center gap-1">
        <Link
          href={fallbackHref}
          aria-label={backLabel}
          onClick={(e) => {
            // 새 탭, 가운데 클릭은 링크 그대로
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if (onBack) {
              e.preventDefault();
              onBack();
              return;
            }
            if (!canGoBack()) return;
            e.preventDefault();
            router.back();
          }}
          className={`-ml-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover ${back === "phone" ? "fold:hidden" : ""}`}
        >
          <IconChevronLeft size={22} />
        </Link>
        <h1 className="t-title min-w-0 flex-1 truncate">{title}</h1>
        {right && <div className="-mr-2.5 flex shrink-0 items-center">{right}</div>}
      </div>
      {subtitle && <p className="t-sub mt-0.5">{subtitle}</p>}
    </div>
  );
}
