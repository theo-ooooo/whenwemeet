"use client";
// /g/[groupId]/* 공통: 팀 API 가 403/404 를 주면 스피너 대신 보여주는 안내 (#18)
// 달력, 빈 시간, 기념일, 새 소식, 팀 설정, 일정 작성 모두 AppShell 을 거치므로 여기 한 곳에서 처리한다
import Link from "next/link";
import { Button } from "./ui";

const TITLE = "이 팀에 더 이상 접근할 수 없어요";

export function GroupGone() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] text-center">
      {/* 없는 팀 ID(/g/99999)도 여기로 온다. 탭 제목이 하위 페이지 metadata("달력" 등)로 남지 않게 화면 제목으로 덮는다 (#82) */}
      <title>{`${TITLE} | 언제볼까`}</title>
      <div role="alert" className="w-full rounded-xl bg-paper px-6 py-9">
        <h1 className="text-[24px] font-extrabold leading-snug tracking-[-0.04em]">{TITLE}</h1>
        <p className="mt-2 text-[14px] font-semibold leading-relaxed text-soft">
          팀을 나갔거나 팀이 삭제됐을 수 있어요.
          <br />내 팀 목록에서 다른 달력을 열어 보세요
        </p>
        <Link href="/" className="mt-6 block">
          <Button size="lg" full tabIndex={-1}>
            내 팀 보기
          </Button>
        </Link>
      </div>
    </main>
  );
}
