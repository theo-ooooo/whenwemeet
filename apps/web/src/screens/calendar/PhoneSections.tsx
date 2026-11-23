"use client";
// (#484) phone 구역 (디자인규칙.md 2-1, 5, #212): "다가오는 일정", "기념일". CalendarScreen 에서 옮김
import Link from "next/link";
import { EventList, EventRow } from "@/components/EventRow";
import { useWho } from "@/components/Participants";
import { IconChevronRight } from "@/components/icons";
import { Skeleton } from "@/components/ui";
import { occurrenceTitle, type Occurrence } from "@/lib/anniversary";
import { dayBadge } from "@/lib/day-detail";
import { addDays, dateKeyOf, formatDateKo, kstToIso, type DateKey } from "@/lib/date";
import { ANNIVERSARIES_PATH, UPCOMING_PATH } from "@/lib/routes";
import { eventKey } from "@/lib/recurrence";
import type { Event } from "@/lib/types";

/** (#378 B) 폰 홈 "다가오는 일정" 줄 수 */
const HOME_UPCOMING = 3;
/** 홈 다가오는 일정 줄의 날짜 글자: "오늘", "내일", "11월 17일 (화)" */
const upcomingDateText = (k: DateKey, today: DateKey) => (k === today ? "오늘" : k === addDays(today, 1) ? "내일" : formatDateKo(k));

// 구역 제목줄 32: 제목 18/700 -0.02em + 오른쪽 "전체보기 ›" 13/400 --mute. 내용과 8px
const sectionHead = (id: string, title: string, more: React.ReactNode) => (
  <div className="mb-2 flex h-8 items-center">
    <h2 id={id} className="text-[18px] font-bold leading-6 tracking-[-0.02em]">
      {title}
    </h2>
    <span className="flex-1" />
    {more}
  </div>
);
const moreCls = "hit flex h-8 items-center gap-0.5 text-[13px] text-ink-2 hover:text-ink";
// 가로 카드 줄: 카드 폭 148, 간격 10. 좌우 여백 20 선에서 시작하고 화면 밖으로 다음 카드가 잘려 보인다
const rail = "-mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const cardSkeletons = (h: string) => (
  <div className={rail} aria-busy="true" aria-label="불러오는 중">
    {[0, 1, 2].map((i) => (
      <Skeleton key={i} className={`${h} w-[148px] shrink-0 rounded-xl`} />
    ))}
  </div>
);
// 빈 구역: 카드 대신 한 줄 안내 + 글자 버튼. 구역은 지우지 않는다
const emptyLine = (text: string, action: React.ReactNode) => (
  <p className="flex h-11 items-center gap-1.5 text-[14px] text-ink-2">
    {text}
    {action}
  </p>
);

// (#378 B) "다가오는 일정": 공통 일정 줄(EventRow) 3개를 세로로 (가로 카드였을 때 기념일, 할 일 카드와 생김새가 같아 구역이 안 갈렸다).
// 시각 앞에 날짜("오늘", "내일", "11월 17일 (화)"). 누르면 그날 일 상세 → 일정 상세. "전체보기" 는 다가오는 일정 목록 화면 (#222)
export function PhoneUpcoming({
  titleId,
  today,
  failed,
  onRetry,
  upcomingList,
  newHref,
  onOpenDay,
}: {
  titleId: string;
  today: DateKey;
  /** 다가오는 일정을 받지 못했다 */
  failed: boolean;
  onRetry: () => void;
  upcomingList: Event[] | null;
  newHref: string;
  onOpenDay: (date: DateKey, ev: Event) => void;
}) {
  const who = useWho();
  return (
    <section aria-labelledby={`${titleId}-pup`} className="mt-[22px]">
      {sectionHead(
        `${titleId}-pup`,
        "다가오는 일정",
        <Link href={UPCOMING_PATH} className={moreCls}>
          전체보기
          <IconChevronRight size={14} />
        </Link>,
      )}
      {failed ? (
        emptyLine(
          "일정을 불러오지 못했어요.",
          <button type="button" onClick={onRetry} className="font-bold text-btn">
            다시 시도
          </button>,
        )
      ) : upcomingList === null ? (
        <div className="space-y-px overflow-hidden rounded-xl" aria-busy="true" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[60px] rounded-none" />
          ))}
        </div>
      ) : upcomingList.length === 0 ? (
        emptyLine(
          "한 달 동안 잡힌 일정이 없어요.",
          <Link href={newHref} className="font-bold text-btn">
            일정 추가
          </Link>,
        )
      ) : (
        <EventList>
          {upcomingList.slice(0, HOME_UPCOMING).map((ev) => {
            // 이미 시작해 진행 중인 일정은 오늘 줄로
            const k = dateKeyOf(Math.max(Date.parse(ev.startsAt), Date.parse(kstToIso(today))));
            return (
              <EventRow
                key={eventKey(ev)}
                event={ev}
                who={who}
                day={k}
                dateText={upcomingDateText(k, today)}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onOpenDay(k, ev);
                }}
              />
            );
          })}
        </EventList>
      )}
    </section>
  );
}

// "기념일" 카드 148×84: D-n 22/700 (오늘이면 --acc-ink "오늘") / 이름 13/500 한 줄. 누르면 그날 일 상세
export function PhoneAnniversaries({
  titleId,
  today,
  annCards,
  onOpenDay,
}: {
  titleId: string;
  today: DateKey;
  annCards: Occurrence[] | null;
  onOpenDay: (date: DateKey) => void;
}) {
  return (
    <section aria-labelledby={`${titleId}-pann`} className="mt-[22px]">
      {sectionHead(
        `${titleId}-pann`,
        "기념일",
        <Link href={ANNIVERSARIES_PATH} className={moreCls}>
          전체보기
          <IconChevronRight size={14} />
        </Link>,
      )}
      {annCards === null ? (
        cardSkeletons("h-[84px]")
      ) : annCards.length === 0 ? (
        emptyLine(
          "기념일을 등록하면 D-day 가 보여요.",
          <Link href={ANNIVERSARIES_PATH} className="font-bold text-btn">
            기념일 추가
          </Link>,
        )
      ) : (
        <ul className={rail}>
          {annCards.map((o) => {
            const badge = dayBadge(o.date, today);
            const title = occurrenceTitle(o);
            return (
              <li key={`${o.anniversary.id}-${o.date}`} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => onOpenDay(o.date)}
                  aria-label={`${title}, ${formatDateKo(o.date)}, ${badge}`}
                  className="flex h-[84px] w-[148px] flex-col justify-between rounded-xl bg-paper px-3.5 py-3 text-left hover:bg-hover"
                >
                  <b aria-hidden="true" className={`text-[22px] font-bold leading-7 tracking-[-0.02em] ${badge === "오늘" ? "text-acc-ink" : ""}`}>
                    {badge}
                  </b>
                  <span aria-hidden="true" className="truncate text-[13px] font-medium leading-[18px]">
                    {title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
