import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { IconChevronLeft } from "@/components/icons";
import { LegalPage } from "@/components/LegalPage";
import { NoticeBody } from "@/components/NoticeBody";
import { NoticeKindBadge, PinnedBadge } from "@/components/NoticeKindBadge";
import { NoticeReadMark } from "@/components/NoticeReadMark";
import { parseId } from "@/lib/id";
import { noticeDate } from "@/lib/notice";
import { serverApi } from "@/lib/server-api";
import type { Notice } from "@/lib/types";

// (#515) 공지 상세. 로그인 없이 열린다. 초안은 관리자만(그 밖은 404 → 찾을 수 없음)
export const dynamic = "force-dynamic";

const loadNotice = cache(async (raw: string) => {
  const id = parseId(raw);
  if (id === null) return null;
  return (await serverApi<Notice>(`/notices/${id}`, { from: `/notices/${id}` })).data;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const notice = await loadNotice((await params).id);
  if (!notice) return { title: "공지사항" };
  return { title: notice.title, description: notice.body.slice(0, 120), robots: notice.publishedAt ? undefined : { index: false, follow: false } };
}

export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const notice = await loadNotice((await params).id);
  if (!notice) notFound();
  return (
    <LegalPage title="공지사항" card={false}>
      <Link href="/notices" className="hit -ml-1 inline-flex h-8 items-center gap-0.5 rounded-sm px-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
        <IconChevronLeft size={16} />
        목록
      </Link>
      {/* (#538) 읽었으니 이 공지의 달력 위 새 공지 띠를 감춘다 */}
      {notice.publishedAt && <NoticeReadMark id={notice.id} />}
      <article className="rounded-xl bg-paper px-4 py-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {notice.pinned && <PinnedBadge />}
          <NoticeKindBadge kind={notice.kind} />
        </div>
        <h2 className="mt-2 break-keep text-[20px] font-bold leading-7 tracking-[-0.02em]">{notice.title}</h2>
        <p className="t-sub mt-1">{noticeDate(notice.publishedAt)}</p>
        <NoticeBody body={notice.body} className="mt-4 border-t border-line pt-4" />
      </article>
    </LegalPage>
  );
}
