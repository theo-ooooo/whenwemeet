"use client";
// 새 소식 (#378, 나머지 화면 점검 5). 머리줄 "‹ 새 소식"(넓은 화면은 사이드바 메뉴라 ‹ 없음).
// 줄마다 왼쪽 작은 칸에 종류 아이콘(일정, 기념일, 팀, 투표, 참석), "오늘, 어제, 이번 주, 이전" 으로 묶고 "3시간 전" 은 작게.
// 안 읽은 소식은 진하게, 읽은 소식은 흐리게. 누를 수 있는 줄은 오른쪽 › 로 알린다(일정, 기념일, 투표, 팀 설정으로)
import Link from "next/link";
import { Fragment, useEffect } from "react";
import { useGroupContext } from "@/components/AppShell";
import { ScreenHeader } from "@/components/ScreenHeader";
import { IconBell, IconCalendar, IconCheck, IconChevronRight, IconHeart, IconPoll, IconTeam } from "@/components/icons";
import { EmptyState, ErrorState, RowGroup, SkeletonList } from "@/components/ui";
import { messageOf, useMarkNewsSeen, useNews } from "@/hooks";
import { formatEventTime, formatRelative, todayKey } from "@/lib/date";
import {
  activityHref,
  activityPhrase,
  activitySubline,
  groupNewsByDay,
  isActivity,
  knownNewsItems,
  newsDateLabel,
  newsHref,
  newsKey,
  newsKindOf,
  newsPhrase,
  type NewsKind,
} from "@/lib/news-copy";
import { CALENDAR_PATH } from "@/lib/routes";
import type { ActivityNewsItem, NewsEntry, NewsItem } from "@/lib/types";

const KIND_ICON: Record<NewsKind, (p: { size: number }) => React.ReactNode> = {
  event: (p) => <IconCalendar {...p} />,
  anniversary: (p) => <IconHeart {...p} />,
  team: (p) => <IconTeam {...p} />,
  poll: (p) => <IconPoll {...p} />,
  rsvp: (p) => <IconCheck {...p} />,
};

export function NewsScreen() {
  const { groupId, clearUnread } = useGroupContext();
  const newsQ = useNews(groupId);
  const news = newsQ.data;
  const items = news ? knownNewsItems(news.items) : [];
  const error = newsQ.error ? messageOf(newsQ.error, "새 소식을 불러오지 못했어요") : null;
  const load = newsQ.refetch;
  const today = todayKey();

  // 목록을 받은 뒤에만 seen (순서 고정: GET → POST). 실패해도 조용히 넘어간다
  const { mutate: markSeen } = useMarkNewsSeen(groupId);
  useEffect(() => {
    if (!news) return;
    void markSeen().then((r) => {
      if (r.ok) clearUnread();
    });
  }, [news, markSeen, clearUnread]);

  return (
    <div>
      <ScreenHeader title="새 소식" fallbackHref={CALENDAR_PATH} back="phone" />

      <div className="mt-3">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : news === null ? (
          <SkeletonList rows={3} />
        ) : items.length === 0 ? (
          <EmptyState icon={<IconBell size={20} />} title="아직 새 소식이 없어요">
            팀원이 일정을 바꾸면 여기에 모여요
          </EmptyState>
        ) : (
          // 일정 기록과 팀 활동 기록(#191)을 한 목록에. 모르는 종류는 knownNewsItems 가 거른다
          <div className="space-y-5">
            {groupNewsByDay(items, today).map((g) => (
              <RowGroup key={g.day} title={g.day}>
                <ul>
                  {g.items.map((item, i) => (
                    <li key={newsKey(item)} className={i === 0 ? "" : "border-t border-line"}>
                      <NewsRow item={item} today={today} />
                    </li>
                  ))}
                </ul>
              </RowGroup>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 한 줄: [종류 아이콘 칸 28] 문장 + 작은 줄(날짜 시각, "3시간 전") [›] */
function NewsRow({ item, today }: { item: NewsEntry; today: string }) {
  const href = isActivity(item) ? activityHref(item) : newsHref(item);
  const unread = item.isNew;
  const kind = newsKindOf(item);
  const sub = isActivity(item) ? activitySubline(item, today) : `${newsDateLabel(item.startsAt, today)} ${formatEventTime(item.startsAt, item.endsAt, item.allDay)}`;
  const when = formatRelative(item.createdAt);
  const body = (
    <>
      <span
        aria-hidden="true"
        className={`mt-px grid size-7 shrink-0 place-items-center rounded-[8px] bg-surface ${unread ? "text-ink" : "text-ink-2"}`}
      >
        {KIND_ICON[kind]({ size: 16 })}
      </span>
      <span className="min-w-0 flex-1">
        {unread && <span className="sr-only">새 소식,</span>}
        <span className={`block text-[14px] leading-5 ${unread ? "font-medium text-ink" : "text-soft"}`}>
          {isActivity(item) ? <ActivityText item={item} unread={unread} /> : <EventText item={item} unread={unread} />}
        </span>
        <span className={`mt-0.5 block text-[12px] leading-4 tabular-nums ${unread ? "text-ink-2" : "text-ink-2 opacity-80"}`}>
          {sub ? `${sub}, ${when}` : when}
        </span>
      </span>
      {href && <IconChevronRight size={16} className="-mr-1 shrink-0 self-center text-ink-2 group-hover:text-ink" />}
    </>
  );
  const cls = "flex min-h-14 w-full items-start gap-3 py-3 text-left";
  return href ? (
    <Link href={href} className={`${cls} group rounded-sm`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 일정 줄 문장: "{이름}님이 '{제목}' {문구}". 지운 일정의 제목은 줄을 긋는다 */
function EventText({ item, unread }: { item: NewsItem; unread: boolean }) {
  const strong = unread ? "font-bold" : "font-semibold";
  return (
    <>
      <span className={strong}>{item.actor.displayName}</span>님이{" "}
      <span className={`${strong} ${item.action === "DELETED" ? "line-through" : ""}`}>&lsquo;{item.title}&rsquo;</span> {newsPhrase(item)}
    </>
  );
}

/**
 * (#191) 팀 활동 줄 문장: "{이름}님이 {문구}". 문구 안 ‘기념일, 팀, 일정 이름’ 은 일정 줄 제목(EventText)과 같은 따옴표, 같은 굵기로
 * (QA 2026-11-14: 일정은 ‘…’ 굵게, 기념일과 팀은 '…' 보통으로 섞여 있었다)
 */
function ActivityText({ item, unread }: { item: ActivityNewsItem; unread: boolean }) {
  const strong = unread ? "font-bold" : "font-semibold";
  // split 의 잡는 괄호 덕에 홀수 번째 조각이 ‘…’ 이다
  const parts = activityPhrase(item).split(/(‘[^’]*’)/);
  return (
    <>
      <span className={strong}>{item.actor.displayName}</span>님이{" "}
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={strong}>
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
