"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGroupContext } from "@/components/AppShell";
import { IconBell } from "@/components/icons";
import { EmptyState, ErrorState, MemberDot, SkeletonList } from "@/components/ui";
import { messageOf, useMarkNewsSeen, useNews } from "@/hooks";
import { dateKeyOf, formatDateKo, formatEventTime, formatRelative } from "@/lib/date";
import { newsHref, newsPhrase } from "@/lib/news-copy";

export function NewsScreen({ groupId }: { groupId: number }) {
  const router = useRouter();
  const { clearUnread } = useGroupContext();
  const newsQ = useNews(groupId);
  const news = newsQ.data;
  const error = newsQ.error ? messageOf(newsQ.error, "새 소식을 불러오지 못했어요") : null;
  const load = newsQ.refetch;

  // 목록을 받은 뒤에만 seen (순서 고정: GET → POST). 실패해도 조용히 넘어간다
  const { mutate: markSeen } = useMarkNewsSeen(groupId);
  useEffect(() => {
    if (!news) return;
    void markSeen().then((r) => {
      if (r.ok) clearUnread();
    });
  }, [news, markSeen, clearUnread]);

  return (
    <div className="pt-1">
      <div className="flex h-10 items-center justify-between">
        <h1 className="t-title">새 소식</h1>
        <button
          type="button"
          onClick={() => router.back()}
          className="hit h-8 rounded-sm bg-paper px-3 text-[13px] font-bold hover:brightness-95 fold:hidden"
        >
          뒤로
        </button>
      </div>

      <div className="mt-3">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : news === null ? (
          <SkeletonList rows={3} />
        ) : news.items.length === 0 ? (
          <EmptyState icon={<IconBell size={20} />} title="아직 새 소식이 없어요">
            팀원이 일정을 바꾸면 여기에 모여요
          </EmptyState>
        ) : (
          <ul className="rounded-xl bg-paper px-1.5 py-1.5">
            {news.items.map((item) => {
              // 문구와 이동 주소는 lib/news-copy.ts (반복 일정 범위 문구, 회차 주소 #187)
              const href = newsHref(groupId, item);
              const body = (
                <>
                  {/* 새 항목은 행 왼쪽 6px 점 하나로 (#174 L14). 배지 글자 반복 대신 */}
                  <i aria-hidden="true" className={`mt-[7px] -mr-1 block size-1.5 shrink-0 rounded-full ${item.isNew ? "bg-pri" : ""}`} />
                  {item.isNew && <span className="sr-only">새 소식,</span>}
                  <MemberDot color={item.actor.color} size={8} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-5">
                      <span className="font-semibold">{item.actor.displayName}</span>님이{" "}
                      <span className={`font-semibold ${item.action === "DELETED" ? "line-through text-ink-2" : ""}`}>
                        &lsquo;{item.title}&rsquo;
                      </span>{" "}
                      {newsPhrase(item)}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-4 text-ink-2 tabular-nums">
                      {formatDateKo(dateKeyOf(item.startsAt))} {formatEventTime(item.startsAt, item.endsAt, item.allDay)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] leading-4 text-ink-2">
                    {formatRelative(item.createdAt)}
                  </span>
                </>
              );
              const cls = `flex min-h-11 w-full items-start gap-2.5 rounded-sm px-2 py-2.5 text-left ${href ? "hover:bg-hover" : ""}`;
              return (
                <li key={item.id}>
                  {href ? (
                    <Link href={href} className={cls}>
                      {body}
                    </Link>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
