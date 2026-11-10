"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGroupContext } from "@/components/AppShell";
import { ErrorState, MemberDot, SkeletonList } from "@/components/ui";
import { messageOf, useMarkNewsSeen, useNews } from "@/hooks";
import { dateKeyOf, formatDateKo, formatEventTime, formatRelative } from "@/lib/date";
import type { NewsItem } from "@/lib/types";

const ACTION_LABEL: Record<NewsItem["action"], string> = {
  CREATED: "추가했어요",
  UPDATED: "수정했어요",
  DELETED: "삭제했어요",
};

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
      <div className="mt-4 flex items-center justify-between lg:mt-0">
        <h1 className="t-title">새 소식</h1>
        <button
          type="button"
          onClick={() => router.back()}
          className="h-9 rounded-full bg-paper px-4 text-[13px] font-bold hover:brightness-95 lg:hidden"
        >
          뒤로
        </button>
      </div>

      <div className="mt-5">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : news === null ? (
          <SkeletonList rows={3} />
        ) : news.items.length === 0 ? (
          <p className="rounded-xl bg-paper px-5 py-8 text-center text-[14px] font-semibold leading-relaxed text-ink-2">
            아직 새 소식이 없어요.
            <br />
            팀원이 일정을 바꾸면 여기에 모여요
          </p>
        ) : (
          <ul className="space-y-1 rounded-xl bg-paper p-2">
            {news.items.map((item) => {
              const clickable = item.eventId && item.action !== "DELETED";
              const body = (
                <>
                  <MemberDot color={item.actor.color} size={12} className="mt-[5px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug">
                      <span className="font-bold">{item.actor.displayName}</span>님이{" "}
                      <span className={`font-bold ${item.action === "DELETED" ? "line-through text-ink-2" : ""}`}>
                        &lsquo;{item.title}&rsquo;
                      </span>{" "}
                      일정을 {ACTION_LABEL[item.action]}
                    </span>
                    <span className="mt-1 block text-[12px] font-semibold text-ink-2 tabular-nums">
                      {formatDateKo(dateKeyOf(item.startsAt))} {formatEventTime(item.startsAt, item.endsAt, item.allDay)}
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-right text-[12px] font-semibold text-ink-2">
                    {item.isNew && <span className="mb-0.5 block font-bold text-ink">새 소식</span>}
                    {formatRelative(item.createdAt)}
                  </span>
                </>
              );
              const cls = `flex w-full items-start gap-3 rounded-[18px] px-3.5 py-3.5 text-left ${
                item.isNew ? "bg-surface" : ""
              } ${clickable ? "hover:bg-surface" : ""}`;
              return (
                <li key={item.id}>
                  {clickable ? (
                    <Link href={`/g/${groupId}/events/${item.eventId}`} className={cls}>
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
