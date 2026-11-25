"use client";
// (#538) 달력 위 정보 카드의 "새 공지: 제목" 한 줄 (D-291). 공지 목록을 본 시각(noticesSeenAt)보다 늦게 게시된 공지 중 가장 최근 것.
// 같이 쓰기 입구(TogetherHint)와 같은 줄 모양(아이콘 16 + 13/500 + --acc-ink, 오른쪽 ×). 크게 튀지 않게 코랄 면은 쓰지 않는다.
// 누르면 상세, × 는 이 공지만 감춘다(이 기기). 더 새 공지가 오면 다시 보이고, 공지 목록을 보면 서버 쪽에서 사라진다
import Link from "next/link";
import { useNoticeAttention } from "@/hooks";
import { dismissHint, useHintDismissed } from "@/lib/hint";
import { noticeBannerKey } from "@/lib/notice";
import { IconChevronRight, IconClose, IconMegaphone } from "./icons";

export function NoticeBannerRow() {
  const banner = useNoticeAttention().data?.banner ?? null;
  const key = banner ? noticeBannerKey(banner.id) : "";
  const dismissed = useHintDismissed(key);
  if (!banner || dismissed) return null;
  return (
    <>
      <div className="flex h-10 items-center gap-2 text-[13px]">
        <IconMegaphone size={16} className="shrink-0 text-acc-ink" />
        <Link href={`/notices/${banner.id}`} onClick={() => dismissHint(key)} className="group flex h-10 min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 font-semibold text-acc-ink">새 공지</span>
          <span className="min-w-0 truncate text-soft group-hover:underline group-hover:underline-offset-2">{banner.title}</span>
          <IconChevronRight size={14} className="shrink-0 text-ink-2" />
        </Link>
        <button
          type="button"
          onClick={() => dismissHint(key)}
          aria-label="새 공지 닫기"
          className="hit -mr-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
        >
          <IconClose size={14} />
        </button>
      </div>
      <div aria-hidden="true" className="h-px bg-line" />
    </>
  );
}
