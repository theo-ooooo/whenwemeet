"use client";
// (#515) 공지 목록 (공개, D-285). 로그인 없이도 열린다. 로그인했으면 새 공지에 코랄 점, 목록을 받은 뒤 본 시각을 기록한다(GET → POST).
// 본 시각을 기록하면 뒤에서 다시 받은 목록은 모두 읽음이라, 이 화면에 있는 동안은 처음 받은 새 공지 표시를 그대로 둔다
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IconMegaphone } from "@/components/icons";
import { NoticeKindBadge, PinnedBadge } from "@/components/NoticeKindBadge";
import { Button, EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { messageOf, useMarkNoticesSeen, useNotices } from "@/hooks";
import { noticeDate, noticeHref } from "@/lib/notice";
import type { NoticeListItem, Page } from "@/lib/types";

export function NoticesScreen({ initial, loggedIn }: { initial: Page<NoticeListItem> | null; loggedIn: boolean }) {
  const q = useNotices({ initialData: initial });
  const { mutate: markSeen } = useMarkNoticesSeen();
  const marked = useRef(false);
  const hasItems = q.items !== null;
  // 처음 받은 목록에서 새 공지였던 번호 (seen 뒤 다시 받아도 이 방문 동안 점을 유지)
  const [firstUnread, setFirstUnread] = useState<Set<number> | null>(() => (initial ? unreadIds(initial.items) : null));
  if (firstUnread === null && q.items) setFirstUnread(unreadIds(q.items));

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
            <Link href={noticeHref(n.id, "list")} className="flex min-h-[60px] items-start gap-3 py-3.5 hover:brightness-95">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {n.pinned && <PinnedBadge />}
                  <NoticeKindBadge kind={n.kind} />
                  {(n.unread || firstUnread?.has(n.id)) && (
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

function unreadIds(items: NoticeListItem[]): Set<number> {
  return new Set(items.filter((n) => n.unread).map((n) => n.id));
}
