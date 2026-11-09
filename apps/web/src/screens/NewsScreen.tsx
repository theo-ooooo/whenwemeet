"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useGroup } from "@/components/AppShell";
import { ErrorState, MemberDot, SkeletonList } from "@/components/ui";
import { api, messageOf } from "@/lib/api";
import { dateKeyOf, formatDateKo, formatEventTime, formatRelative } from "@/lib/date";
import type { News, NewsItem } from "@/lib/types";

const ACTION_LABEL: Record<NewsItem["action"], string> = {
  CREATED: "추가했어요",
  UPDATED: "수정했어요",
  DELETED: "삭제했어요",
};

export function NewsScreen({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { clearUnread } = useGroup();
  const [news, setNews] = useState<News | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<News>(`/groups/${groupId}/news`);
      setError(null);
      setNews(data);
      // 목록을 받은 뒤에만 seen (순서 고정: GET → POST)
      try {
        await api(`/groups/${groupId}/news/seen`, { method: "POST" });
        clearUnread();
      } catch {}
    } catch (e) {
      setError(messageOf(e, "새 소식을 불러오지 못했어요"));
    }
  }, [groupId, clearUnread]);

  useEffect(() => {
    // 효과 본문에서 직접 setState 하지 않도록 마이크로태스크로 미룬다
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="pt-1">
      <div className="flex h-11 items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="-ml-2 rounded-sm px-2 py-1 text-[14px] text-ink-2 hover:bg-paper"
        >
          뒤로
        </button>
        <h1 className="text-[16px] font-bold">새 소식</h1>
        <span className="w-10" aria-hidden="true" />
      </div>

      <div className="mt-3">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : news === null ? (
          <SkeletonList rows={3} />
        ) : news.items.length === 0 ? (
          <p className="rounded-lg bg-paper px-5 py-8 text-center text-[14px] leading-relaxed text-ink-2">
            아직 새 소식이 없어요.
            <br />
            팀원이 일정을 바꾸면 여기에 모여요
          </p>
        ) : (
          <ul className="space-y-2">
            {news.items.map((item) => {
              const clickable = item.eventId && item.action !== "DELETED";
              const body = (
                <>
                  <MemberDot color={item.actor.color} size={10} className="mt-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-snug">
                      <span className="font-semibold">{item.actor.displayName}</span>님이{" "}
                      <span className={`font-semibold ${item.action === "DELETED" ? "line-through text-ink-2" : ""}`}>
                        &lsquo;{item.title}&rsquo;
                      </span>{" "}
                      일정을 {ACTION_LABEL[item.action]}
                    </span>
                    <span className="t-sub mt-1 block tabular-nums">
                      {formatDateKo(dateKeyOf(item.startsAt))} {formatEventTime(item.startsAt, item.endsAt, item.allDay)}
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-[12px] text-ink-2">{formatRelative(item.createdAt)}</span>
                </>
              );
              const cls = `flex w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left ${
                item.isNew ? "bg-brand-soft/70" : "bg-paper"
              } ${clickable ? "hover:bg-brand-soft" : ""}`;
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
