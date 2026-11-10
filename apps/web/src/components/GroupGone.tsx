"use client";
// /g/[groupId]/* 공통: 팀 API 가 403/404 를 주면 스피너 대신 보여주는 안내 (#18)
// 달력, 빈 시간, 기념일, 새 소식, 팀 설정, 일정 작성 모두 AppShell 을 거치므로 여기 한 곳에서 처리한다
// 모양은 404, 점검 화면과 같은 전체 화면 뼈대 (#140 L15)
import Link from "next/link";
import { Symbol } from "./Logo";
import { Button } from "./ui";

const TITLE = "이 팀에 더 이상 접근할 수 없어요";

export function GroupGone() {
  return (
    <div className="min-h-dvh bg-[var(--login-bg)]">
      {/* 없는 팀 ID(/g/99999)도 여기로 온다. 탭 제목이 하위 페이지 metadata("달력" 등)로 남지 않게 화면 제목으로 덮는다 (#82) */}
      <title>{`${TITLE} | 언제볼까`}</title>
      <main
        role="alert"
        className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-[calc(34px+env(safe-area-inset-bottom))] pt-[max(60px,env(safe-area-inset-top))]"
      >
        <Symbol size={40} />
        <div className="mt-auto pt-16">
          <h1 className="text-[32px] font-bold leading-[1.15] tracking-[-0.03em]">{TITLE}</h1>
          <p className="mt-3 text-[15px] leading-[22px] text-soft">
            팀을 나갔거나 팀이 삭제됐을 수 있어요.
            <br />내 팀 목록에서 다른 달력을 열어 보세요
          </p>
        </div>
        <Link href="/" className="mt-8 block">
          <Button size="lg" full tabIndex={-1}>
            내 팀 보기
          </Button>
        </Link>
      </main>
    </div>
  );
}
