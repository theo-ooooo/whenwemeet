"use client";
// (#450) AI 비서 "볼까" 폰 전체 화면 `/assistant` (설계 AI-비서.md 7-2, D-272, 승인 시안).
// 독과 + 를 숨기고(AppShell isForm) 아래에 입력 줄을 붙인다. 머리줄 ‹ 로 닫으면 대화를 지운다(7-4).
// 넓은 화면에서 이 주소로 들어오면 본문 가운데(최대 640) 한 화면
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useGroupContext } from "@/components/AppShell";
import { AssistantChat } from "@/components/AssistantChat";
import { AssistantHeader } from "@/components/AssistantHeader";
import { useAssistant } from "@/components/AssistantProvider";
import { IconChevronLeft, IconSparkle } from "@/components/icons";
import { EmptyState, Skeleton } from "@/components/ui";
import { canGoBack } from "@/lib/back-nav";
import { CALENDAR_PATH } from "@/lib/routes";

export function AssistantScreen() {
  const router = useRouter();
  const { group } = useGroupContext();
  const a = useAssistant();
  const titleId = useId();

  const back = (
    <Link
      href={CALENDAR_PATH}
      aria-label="볼까 닫기"
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // 닫으면 대화를 지운다. 앱 안에서 왔으면 뒤로 (lib/back-nav)
        a.clear();
        if (!canGoBack()) return;
        e.preventDefault();
        router.back();
      }}
      className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-sm text-ink hover:bg-hover"
    >
      <IconChevronLeft size={22} />
    </Link>
  );

  return (
    <div className="mx-auto w-full fold:max-w-[640px]">
      <AssistantHeader titleId={titleId} teamName={group?.name ?? null} start={back} />
      {!a.ready ? (
        // /me 를 받는 중
        <div className="space-y-3 pt-4" aria-busy="true" aria-label="불러오는 중">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : !a.available ? (
        <div className="pt-4">
          <EmptyState icon={<IconSparkle size={20} />} title="지금은 볼까를 쓸 수 없어요">
            일정은 달력에서 직접 추가할 수 있어요
          </EmptyState>
        </div>
      ) : (
        <AssistantChat variant="screen" />
      )}
    </div>
  );
}
