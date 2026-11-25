"use client";
// (#515) 관리자 공지 목록 (초안 포함, 최근 만든 것 먼저). 줄을 누르면 수정 화면
import Link from "next/link";
import { AdminTitle } from "@/components/admin/AdminShell";
import { IconMegaphone, IconPlus } from "@/components/icons";
import { NoticeKindBadge, PinnedBadge } from "@/components/NoticeKindBadge";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui";
import { messageOf, useAdminNotices } from "@/hooks";
import { noticeDate } from "@/lib/notice";
import { AdminMore, StatusBadge } from "./AdminMore";

export function AdminNoticesScreen() {
  const q = useAdminNotices();
  return (
    <div>
      <AdminTitle
        title="공지사항"
        right={
          <Link href="/admin/notices/new" className="inline-flex h-9 items-center gap-1 rounded-sm bg-btn px-3 text-[13px] font-bold text-on-btn hover:brightness-95">
            <IconPlus size={14} strokeWidth={2.4} />새 공지
          </Link>
        }
      />
      {q.error && !q.items ? (
        <ErrorState message={messageOf(q.error, "공지를 불러오지 못했어요")} onRetry={q.refetch} />
      ) : !q.items ? (
        <SkeletonList />
      ) : q.items.length === 0 ? (
        <EmptyState icon={<IconMegaphone size={20} />} title="공지가 없어요">
          새 공지를 눌러 첫 공지를 써 보세요
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl bg-paper px-4">
          {q.items.map((n) => (
            <li key={n.id}>
              <Link href={`/admin/notices/${n.id}`} className="flex min-h-14 flex-col gap-1 py-3 hover:brightness-95 fold:flex-row fold:items-center fold:gap-3">
                <span className="flex shrink-0 items-center gap-1.5 fold:w-[184px]">
                  {n.publishedAt ? <StatusBadge tone="on">게시</StatusBadge> : <StatusBadge tone="off">초안</StatusBadge>}
                  <NoticeKindBadge kind={n.kind} />
                  {n.pinned && <PinnedBadge />}
                  {/* (#528) 푸시로도 보낸 공지 */}
                  {n.pushedAt && <StatusBadge tone="on">푸시</StatusBadge>}
                </span>
                <b className="min-w-0 flex-1 truncate text-[14px] font-semibold">{n.title}</b>
                <span className="t-sub shrink-0 fold:w-[150px] fold:text-right">{noticeDate(n.publishedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminMore q={q} />
    </div>
  );
}
