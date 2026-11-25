"use client";
// (#515) 공지 목록 (공개, D-285). 로그인 없이도 열린다. 로그인했으면 새 공지에 코랄 점, 목록을 받은 뒤 본 시각을 기록한다(GET → POST)
import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconMegaphone } from "@/components/icons";
import { NoticeKindBadge, PinnedBadge } from "@/components/NoticeKindBadge";
import { Button, EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { messageOf, useMarkNoticesSeen, useNotices } from "@/hooks";
import { noticeDate } from "@/lib/notice";
import type { NoticeListItem, Page } from "@/lib/types";

export function NoticesScreen({ initial, loggedIn }: { initial: Page<NoticeListItem> | null; loggedIn: boolean }) {
  const q = useNotices({ initialData: initial });
  const { mutate: markSeen } = useMarkNoticesSeen();
  const marked = useRef(false);
  const hasItems = q.items !== null;

  useEffect(() => {
    if (!loggedIn || !hasItems || marked.current) return;
    marked.current = true;
    void markSeen();
  }, [loggedIn, hasItems, markSeen]);

  if (q.error && !q.items) return <ErrorState message={messageOf(q.error, "공지를 불러오지 못했어요")} onRetry={q.refetch} />;
  if (!q.items) return <SkeletonList />;
  if (q.items.length === 0) {
    return (
      <EmptyState icon={<IconMegaphone size={20} />} title="아직 공지가 없어요">
        새 소식이 생기면 여기에 올릴게요
      </EmptyState>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-line rounded-xl bg-paper px-4">
        {q.items.map((n) => (
          <li key={n.id}>
            <Link href={`/notices/${n.id}`} className="flex min-h-[60px] items-start gap-3 py-3.5 hover:brightness-95">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {n.pinned && <PinnedBadge />}
                  <NoticeKindBadge kind={n.kind} />
                  {n.unread && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-acc-ink">
                      <i aria-hidden="true" className="block size-1.5 rounded-full bg-pri" />새 공지
                    </span>
                  )}
                </span>
                <b className="mt-1.5 block break-keep text-[15px] font-semibold leading-[22px]">{n.title}</b>
                <span className="t-sub mt-0.5 block">{noticeDate(n.publishedAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasMore && (
        <div className="mt-3">
          <Button variant="outline" full loading={q.loadingMore} onClick={() => void q.loadMore()}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
