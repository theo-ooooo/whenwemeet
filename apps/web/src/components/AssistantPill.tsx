"use client";
import Link from "next/link";
import { useAssistant } from "./AssistantProvider";
import { IconSparkle } from "./icons";
import { ASSISTANT_PATH } from "@/lib/routes";

/**
 * (#450) 폰 "AI 볼까" 알약 (AI-비서.md 7-1, 승인 시안): 높이 40, 타일 면 + 1.5px 코랄(--pri) 안쪽 테두리 + 독과 같은 그림자,
 * 반짝임 18 코랄 + "AI 볼까" 14/700. 서버에 키가 없으면(available false) 그리지 않는다. + 가 보이는 화면에서만(부모가 숨긴다)
 */
export function AssistantPill() {
  const { available } = useAssistant();
  if (!available) return null;
  return (
    <Link
      href={ASSISTANT_PATH}
      className="pointer-events-auto absolute bottom-[calc(100%+12px)] right-0 flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-paper pl-3 pr-4 text-[14px] font-bold text-ink shadow-[inset_0_0_0_1.5px_var(--pri),var(--fab-shadow)]"
    >
      <IconSparkle size={18} className="text-pri" />
      AI 볼까
    </Link>
  );
}

