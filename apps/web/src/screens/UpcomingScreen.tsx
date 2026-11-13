"use client";
// 다가오는 일정 목록 (#222). 폰 홈 "다가오는 일정 / 전체보기", 넓은 화면 사이드바 "다가오는 일정 / 전체보기" 가 여기로 온다.
// 지금부터 30일 일정(반복은 API 가 펼친 회차)을 KST 날짜별로 묶어 일 상세(DayView) 와 같은 모양으로 그린다:
//   왼쪽 48px 열(라벨 11 "오늘"/"내일"/요일 + 날짜 16/700) + 흰 카드 한 장에 줄(3px 멤버 막대 + 제목 15/600 + 시각, 등록자 12 --mute).
//   기념일 항목은 그날 카드의 첫 줄(하트 아이콘). 달이 바뀌는 곳에 "12월" 구분 제목.
// "30일 더 보기" 로 다음 30일 창을 하나씩 더 받는다 (api.md 2.3 한 번에 62일까지). 묶음 규칙은 lib/upcoming.ts
// (#192 Q3) 맨 위 "지난 30일 보기" 로 끝난 일정을 30일씩 거슬러 본다 (별도 목록 화면은 만들지 않는다)
import Link from "next/link";
import { useState } from "react";
import { IconChevronLeft, IconHeart, IconPlus } from "@/components/icons";
import { useWho } from "@/components/Participants";
import { ErrorState, Skeleton } from "@/components/ui";
import { messageOf, useAnniversaries, useEvents } from "@/hooks";
import { occurrenceTitle } from "@/lib/anniversary";
import { useGroupContext } from "@/components/AppShell";
import { ANNIVERSARIES_PATH, CALENDAR_PATH, eventHref, newEventHref } from "@/lib/routes";
import { dayBadge } from "@/lib/day-detail";
import { formatDateKo, kstToIso, todayKey, type DateKey } from "@/lib/date";
import { eventKey } from "@/lib/recurrence";
import { barColors, splitBackground, withWho } from "@/lib/participants";
import { needsMyRsvp } from "@/lib/rsvp";
import { NeedsRsvpTag } from "@/components/EventResponses";
import type { Anniversary } from "@/lib/types";
import {
  groupPast,
  groupUpcoming,
  pastWindow,
  monthBreak,
  upcomingTimeText,
  upcomingWindow,
  windowRangeText,
  type UpcomingDay,
} from "@/lib/upcoming";

export function UpcomingScreen() {
  const { groupId } = useGroupContext();
  // 화면을 연 순간 기준으로 고정한다 (창 경계와 끝난 일정 판정이 렌더마다 흔들리지 않게)
  const [today] = useState(todayKey);
  const [nowMs] = useState(Date.now);
  // 받을 창 수. 1 = 오늘부터 30일
  const [count, setCount] = useState(1);
  // 거슬러 받은 지난 창 수. 0 = 지난 일정 안 봄
  const [pastCount, setPastCount] = useState(0);
  const annQ = useAnniversaries(groupId);
  // 기념일은 못 받아도 일정만 보여 준다
  const anniversaries = annQ.data ?? (annQ.error ? [] : null);
  const newHref = newEventHref({ start: kstToIso(today, "10:00"), end: kstToIso(today, "11:00") });

  return (
    <div className="pt-1">
      {/* 제목줄: 다른 하위 화면(새 소식)과 같은 자리의 "뒤로" 알약. 폰에서만 (넓은 화면은 사이드바가 있다) */}
      <div className="flex h-10 items-center justify-between gap-3">
        <h1 className="t-title">다가오는 일정</h1>
        <Link
          href={CALENDAR_PATH}
          className="hit flex h-8 shrink-0 items-center gap-0.5 rounded-sm bg-paper pl-2 pr-3 text-[13px] font-bold hover:brightness-95 fold:hidden"
        >
          <IconChevronLeft size={16} />
          달력
        </Link>
        <Link
          href={newHref}
          className="hit hidden h-8 shrink-0 items-center gap-1.5 rounded-sm bg-btn px-3 text-[13px] font-bold text-on-btn hover:brightness-95 fold:inline-flex"
        >
          <IconPlus size={14} strokeWidth={2.2} />
          일정 추가
        </Link>
      </div>

      {/* 지난 일정: 버튼 → 오래된 창부터 위에서 아래로. 끝나면 "지금부터" 구분 뒤 다가오는 일정 */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setPastCount((c) => c + 1)}
          className="h-10 w-full rounded-md border border-line bg-paper text-[13px] font-bold text-ink-2 hover:text-ink hover:brightness-95"
        >
          {pastCount === 0 ? "지난 30일 보기" : "지난 30일 더 보기"}
        </button>
        {pastCount > 0 && (
          <section aria-label="지난 일정" className="mt-4">
            <PastList groupId={groupId} index={pastCount} prevDate={null} today={today} nowMs={nowMs} />
            <h2 className="mt-6 flex items-center gap-2 text-[13px] font-bold leading-[18px] text-today-ink">
              지금부터
              <i aria-hidden="true" className="block h-px flex-1 bg-line" />
            </h2>
          </section>
        )}
      </div>

      <div className="mt-3">
        {anniversaries === null ? (
          <ListSkeleton />
        ) : (
          <WindowList
            groupId={groupId}
            index={0}
            count={count}
            prevDate={null}
            today={today}
            nowMs={nowMs}
            anniversaries={anniversaries}
            newHref={newHref}
            onMore={() => setCount((c) => c + 1)}
          />
        )}
      </div>
    </div>
  );
}

type WindowProps = {
  groupId: number;
  index: number;
  count: number;
  /** 앞 창의 마지막 묶음 날짜 (달 구분 제목을 이어서 판단). 처음이면 null */
  prevDate: DateKey | null;
  today: DateKey;
  nowMs: number;
  anniversaries: Anniversary[];
  newHref: string;
  onMore: () => void;
};

/**
 * 30일 창 하나. 다 받으면 묶음을 그리고 다음 창(있으면)을 이어서 그린다.
 * 창마다 useEvents 하나라 앞 창이 받는 중이면 뒤 창은 아직 그리지 않는다 (순서가 뒤바뀌지 않게)
 */
function WindowList(props: WindowProps) {
  const { groupId, index, count, prevDate, today, nowMs, anniversaries, newHref, onMore } = props;
  const range = upcomingWindow(today, index);
  const q = useEvents(groupId, { from: kstToIso(range.from), to: kstToIso(range.to) });

  if (q.error && !q.data) {
    return <ErrorState message={messageOf(q.error, "일정을 불러오지 못했어요")} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <ListSkeleton />;

  const days = groupUpcoming(q.data, anniversaries, range, today, nowMs);
  const last = days.length ? days[days.length - 1].date : prevDate;
  const isLast = index === count - 1;

  return (
    <>
      {days.length === 0 ? (
        // 빈 창: 한 줄 안내 + 글자 버튼 (디자인규칙.md 5). 첫 창이 아니면 그 기간만 비었다고
        <p className={`flex min-h-11 flex-wrap items-center gap-x-1.5 text-[14px] text-ink-2 ${index > 0 ? "mt-5" : ""}`}>
          {index === 0 ? "앞으로 30일 동안 잡힌 일정이 없어요." : `${windowRangeText(range)}에는 일정이 없어요.`}
          {index === 0 && (
            <Link href={newHref} className="font-bold text-btn">
              일정 추가
            </Link>
          )}
        </p>
      ) : (
        <DayGroups days={days} prevDate={prevDate} today={today} first={index === 0} />
      )}

      {isLast ? (
        <div className="mt-6 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={onMore}
            className="h-11 w-full rounded-md border border-line bg-paper text-[13.5px] font-bold hover:brightness-95"
          >
            30일 더 보기
          </button>
          <span className="text-[12px] leading-4 text-ink-2">{windowRangeText({ from: today, to: range.to })} 일정이에요</span>
        </div>
      ) : (
        <WindowList {...props} index={index + 1} prevDate={last} />
      )}
    </>
  );
}

/** (#192) 지난 창 하나 (index 가 클수록 오래된 창). 다 받으면 묶음을 그리고 더 최근 창(index - 1)을 이어서 그린다 */
function PastList({ groupId, index, prevDate, today, nowMs }: { groupId: number; index: number; prevDate: DateKey | null; today: DateKey; nowMs: number }) {
  const range = pastWindow(today, index);
  const q = useEvents(groupId, { from: kstToIso(range.from), to: kstToIso(range.to) });
  if (q.error && !q.data) {
    return <ErrorState message={messageOf(q.error, "지난 일정을 불러오지 못했어요")} onRetry={() => void q.refetch()} />;
  }
  if (!q.data) return <ListSkeleton />;
  const days = groupPast(q.data, range, today, nowMs);
  const last = days.length ? days[days.length - 1].date : prevDate;
  return (
    <>
      {days.length === 0 ? (
        <p className="flex min-h-11 items-center text-[14px] text-ink-2">{windowRangeText(range)}에는 지난 일정이 없어요.
        </p>
      ) : (
        <DayGroups days={days} prevDate={prevDate} today={today} first={prevDate === null} />
      )}
      {index > 1 && <PastList groupId={groupId} index={index - 1} prevDate={last} today={today} nowMs={nowMs} />}
    </>
  );
}

function DayGroups({
  days,
  prevDate,
  today,
  first,
}: {
  days: UpcomingDay[];
  prevDate: DateKey | null;
  today: DateKey;
  first: boolean;
}) {
  const who = useWho();
  // (#190) "응답" 표시는 끝나지 않은 일정에만
  const [now] = useState(Date.now);
  return (
    <>
      {days.map((d, i) => {
        const month = monthBreak(i === 0 ? prevDate : days[i - 1].date, d.date, today);
        const tone = d.tone === "today" ? "text-today-ink" : d.tone === "holiday" ? "text-holiday" : "";
        return (
          <section key={d.date} aria-label={`${formatDateKo(d.date)}${d.date === today ? ", 오늘" : ""}`}>
            {month && (
              <h2 className={`mb-2 text-[13px] font-bold leading-[18px] text-ink-2 ${first && i === 0 ? "" : "mt-6"}`}>{month}</h2>
            )}
            <div className={`flex gap-2 ${month ? "" : "mt-2.5"}`}>
              {/* 왼쪽 48px 날짜 열 (일 상세 시각 열과 같은 크기) */}
              <span aria-hidden="true" className="flex w-12 shrink-0 flex-col pt-2.5">
                <small className={`text-[11px] leading-4 ${d.tone === "plain" ? "text-ink-2" : tone}`}>{d.label}</small>
                <b className={`text-[16px] font-bold leading-5 tracking-[-0.02em] ${tone}`}>{d.day}</b>
              </span>
              <ul className="min-w-0 flex-1 overflow-hidden rounded-xl bg-paper">
                {d.anniversaries.map((o, j) => (
                  <Row key={`a${o.anniversary.id}-${o.type}-${o.n ?? ""}`} divider={j > 0}>
                    <Link
                      href={ANNIVERSARIES_PATH}
                      aria-label={`기념일 ${occurrenceTitle(o)}, ${dayBadge(o.date, today)}`}
                      className={rowCls}
                    >
                      <span aria-hidden="true" className="grid w-[18px] shrink-0 place-items-center self-center text-acc-ink">
                        <IconHeart size={18} />
                      </span>
                      <span aria-hidden="true" className={metaCls}>
                        <b className="block truncate text-[15px] font-semibold leading-5 main-lg:min-w-0 main-lg:flex-1">{occurrenceTitle(o)}</b>
                        <span className="block truncate text-[12px] leading-4 text-ink-2 main-lg:shrink-0 main-lg:text-[13px]">기념일, {dayBadge(o.date, today)}</span>
                      </span>
                    </Link>
                  </Row>
                ))}
                {d.events.map((ev, j) => {
                  const time = upcomingTimeText(ev, d.date);
                  return (
                    <Row key={eventKey(ev)} divider={j > 0 || d.anniversaries.length > 0}>
                      <Link
                        href={eventHref(ev)}
                        aria-label={withWho(`${ev.title}, ${time}${needsMyRsvp(ev, who.meId, who.personal, now) ? ", 응답 필요" : ""}`, ev, who)}
                        className={rowCls}
                      >
                        <i aria-hidden="true" className="block w-[3px] shrink-0 rounded-[2px]" style={{ background: splitBackground(barColors(ev), "to bottom") }} />
                        <span aria-hidden="true" className={metaCls}>
                          <b className="block truncate text-[15px] font-semibold leading-5 main-lg:min-w-0 main-lg:flex-1">
                            {needsMyRsvp(ev, who.meId, who.personal, now) && <NeedsRsvpTag />}
                            {ev.title}
                          </b>
                          <span className="block truncate text-[12px] leading-4 text-ink-2 main-lg:max-w-[50%] main-lg:shrink-0 main-lg:text-[13px]">
                            {withWho(time, ev, who)}
                          </span>
                        </span>
                      </Link>
                    </Row>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
    </>
  );
}

// 줄 60 (일 상세 일정 카드와 같은 높이). 줄 사이 1px --line 은 카드 안쪽 여백 선에서.
// 올림 표시는 카드 면(--tile)에 글자색(--ink)을 5% 섞는다 (라이트는 살짝 어둡게, 다크는 살짝 밝게).
// --hover 는 라이트에서 바탕(--bg)과 같은 색이라 카드 안 줄에 쓰면 그 줄만 카드 밖으로 빠진 것처럼 보인다 (#223 리뷰)
// lg(≥1024) 넓은 줄은 제목 왼쪽, 시각과 등록자는 오른쪽 끝 한 줄로 (#244). 그 아래는 두 줄
const metaCls = "min-w-0 flex-1 self-center main-lg:flex main-lg:items-center main-lg:gap-4";
const rowCls = "flex min-h-[60px] items-stretch gap-2.5 px-3.5 py-2.5 hover:bg-[color-mix(in_srgb,var(--tile),var(--ink)_5%)]";

function Row({ divider, children }: { divider: boolean; children: React.ReactNode }) {
  return (
    <li className="relative">
      {children}
      {/* 줄 면 위에 그린다 (올림 표시가 구분선을 덮지 않게) */}
      {divider && <i aria-hidden="true" className="pointer-events-none absolute inset-x-3.5 top-0 h-px bg-line" />}
    </li>
  );
}

/** 불러오는 중: 날짜 열 + 카드 자리 스켈레톤 (일 상세와 같은 모양) */
function ListSkeleton() {
  return (
    <ul className="space-y-2.5" aria-busy="true" aria-label="불러오는 중">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex gap-2">
          <span className="w-12 shrink-0 space-y-1 pt-2.5">
            <Skeleton className="h-2.5 w-6" />
            <Skeleton className="h-4 w-5" />
          </span>
          <Skeleton className="h-[60px] flex-1 rounded-xl" />
        </li>
      ))}
    </ul>
  );
}
