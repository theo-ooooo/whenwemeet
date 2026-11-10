"use client";
// 넓은 화면(≥600, fold 와 pc) 왼쪽 사이드바 264 (디자인규칙.md 2-2, 4-2, 4-3, 5, #212, D-69).
// 위에서부터 심볼 34 → 팀 선택 상자 48 → 메뉴(줄 46) → 구분선 → 다가오는 일정 3줄 → 구분선 → 다음 기념일 2줄 → 맨 아래 내 정보.
// D-58 의 레일과 개요 칸(다가오는 일정, D-day) 내용이 여기 아래 묶음으로 옮겨 왔다. 오늘 비는 시간은 달력 요약 카드가 맡는다
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useAnniversaries, useEvents } from "@/hooks";
import { occurrenceTitle } from "@/lib/anniversary";
import { memberColor } from "@/lib/colors";
import { addDays, dateKeyOf, formatDateKo, formatEventTime, kstToIso, todayKey } from "@/lib/date";
import { dayBadge, upcomingEvents } from "@/lib/day-detail";
import { nextOccurrences } from "@/lib/day-view";
import { eventEditHref, eventKey } from "@/lib/recurrence";
import type { GroupDetail } from "@/lib/types";
import { Symbol } from "./Logo";
import { IconBell, IconCalendar, IconChevronDown, IconFree, IconHeart, IconTeam } from "./icons";
import { Avatar, Skeleton } from "./ui";

type Props = {
  groupId: number;
  group: GroupDetail | null;
  /** 주소의 셋째 조각 (calendar, upcoming, free, anniversaries, news, settings, events) */
  section: string;
  unread: number;
  /** 넓은 화면일 때만 아래 묶음 데이터를 받는다 (폰은 이 사이드바가 숨어 있다) */
  enabled: boolean;
  /** 바뀌면 아래 묶음을 다시 받는다 (화면 이동, 달력에서 일정 추가/삭제) */
  refreshKey: string;
  onSwitchTeam: () => void;
};

const nowMs = () => Date.now();

/** 팀 선택 상자의 멤버 점 둘 (겹쳐 그린다). 개인 달력은 먹색 하나 */
function TeamDots({ group }: { group: GroupDetail | null }) {
  if (!group) return <Skeleton className="size-5 rounded-full" />;
  const colors = group.type === "PERSONAL" ? ["var(--ink)"] : group.members.slice(0, 2).map((m) => memberColor(m.color));
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {colors.map((c, i) => (
        <i key={i} className={`block size-3.5 rounded-full ring-2 ring-[var(--bg)] ${i > 0 ? "-ml-1.5" : ""}`} style={{ background: c }} />
      ))}
    </span>
  );
}

function MenuIcon({ name, active, unread }: { name: string; active: boolean; unread: boolean }) {
  switch (name) {
    case "calendar":
      return <IconCalendar size={24} active={active} />;
    case "free":
      return <IconFree size={24} active={active} />;
    case "anniversaries":
      return <IconHeart size={24} active={active} />;
    case "news":
      return <IconBell size={24} unread={unread} />;
    default:
      return <IconTeam size={24} active={active} />;
  }
}

export function Sidebar({ groupId, group, section, unread, enabled, refreshKey, onSwitchTeam }: Props) {
  const today = todayKey();
  const upcomingQ = useEvents(groupId, { from: kstToIso(today), to: kstToIso(addDays(today, 31)) }, { enabled });
  const annQ = useAnniversaries(groupId, { enabled });

  // 화면을 옮기거나 달력에서 일정을 바꾸면 다시 받는다. 처음 한 번은 훅이 이미 받는다
  const refetchUp = upcomingQ.refetch;
  const refetchAnn = annQ.refetch;
  const lastKey = useRef(refreshKey);
  useEffect(() => {
    if (lastKey.current === refreshKey) return;
    lastKey.current = refreshKey;
    if (!enabled) return;
    void refetchUp();
    void refetchAnn();
  }, [refreshKey, enabled, refetchUp, refetchAnn]);

  const upcoming = useMemo(() => (upcomingQ.data ? upcomingEvents(upcomingQ.data, nowMs(), 3) : null), [upcomingQ.data]);
  // 기념일은 못 받아도 빈 목록으로 본다 (안내 한 줄)
  const annData = annQ.data;
  const annFailed = annQ.error !== null;
  const nextAnn = useMemo(() => (annData ? nextOccurrences(annData, today, 2) : annFailed ? [] : null), [annData, annFailed, today]);

  // 다가오는 일정 목록(#222)도 달력에 딸린 화면으로 본다
  const calendarOn = section === "calendar" || section === "events" || section === "upcoming";
  const menu = [
    { key: "calendar", href: `/g/${groupId}/calendar`, label: "달력", on: calendarOn },
    { key: "free", href: `/g/${groupId}/free`, label: "빈 시간", on: section === "free" },
    { key: "anniversaries", href: `/g/${groupId}/anniversaries`, label: "기념일", on: section === "anniversaries" },
    { key: "news", href: `/g/${groupId}/news`, label: "새 소식", on: section === "news", badge: unread },
    { key: "settings", href: `/g/${groupId}/settings`, label: "팀 설정", on: section === "settings" },
  ];

  const head = "flex h-8 items-center px-3 text-[15px] font-bold leading-5 tracking-[-0.01em]";
  const muteLine = "px-3 py-2 text-[13px] leading-[18px] text-ink-2";

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-paper px-4 pb-4 pt-5 fold:flex">
      <Link href={`/g/${groupId}/calendar`} aria-label="언제볼까 달력" className="ml-2 grid size-[34px] shrink-0 place-items-center rounded-sm">
        <Symbol size={34} />
      </Link>

      {/* 팀 선택 상자 48: --bg 면, 모서리 12, 멤버 점 둘 + 팀 이름 16/700 + ⌄. 누르면 지금과 같은 팀 전환 시트 */}
      <button
        type="button"
        onClick={onSwitchTeam}
        aria-haspopup="dialog"
        className="mt-5 flex h-12 w-full shrink-0 items-center gap-2.5 rounded-md bg-surface px-3.5 text-left hover:brightness-[0.98]"
      >
        <TeamDots group={group} />
        {group ? (
          <span className="min-w-0 flex-1 truncate text-[16px] font-bold leading-6">{group.name}</span>
        ) : (
          <Skeleton className="h-4 flex-1" />
        )}
        <IconChevronDown size={18} className="shrink-0 text-ink-2" />
        <span className="sr-only">팀 바꾸기</span>
      </button>

      {/* 메뉴: 줄 46, 모서리 14, 아이콘 24 + 이름 15. 선택 = 먹색 칩 + 흰 글자 700 + 코랄 조각 (다크는 --ink/--on-ink 가 뒤집힌다) */}
      <nav aria-label="주요 화면" className="mt-4 shrink-0">
        <ul className="flex flex-col gap-0.5">
          {menu.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                aria-current={it.on ? "page" : undefined}
                aria-label={it.badge ? `${it.label}, 새 소식 ${it.badge}개` : undefined}
                className={`flex h-[46px] items-center gap-3 rounded-[14px] px-3 text-[15px] leading-5 ${
                  it.on ? "bg-ink font-bold text-on-ink" : "font-medium text-soft hover:bg-hover"
                }`}
              >
                <span className={`shrink-0 ${it.on ? "" : "text-ink-2"}`}>
                  <MenuIcon name={it.key} active={it.on} unread={Boolean(it.badge)} />
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.badge ? (
                  <span aria-hidden="true" className={`text-[12px] font-bold ${it.on ? "" : "text-acc-ink"}`}>
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div aria-hidden="true" className="mx-3 my-4 h-px shrink-0 bg-line" />

      {/* 다가오는 일정 3줄: 3px 멤버 막대 + 제목 14/600 + 날짜와 시각 12 --mute. 누르면 그 일정 (반복은 회차까지) */}
      <section aria-labelledby="side-up" className="shrink-0">
        <div className={head}>
          <h2 id="side-up">다가오는 일정</h2>
          <span className="flex-1" />
          <Link href={`/g/${groupId}/upcoming`} className="hit text-[12px] font-normal text-ink-2 hover:text-ink">
            전체보기
          </Link>
        </div>
        {upcomingQ.error ? (
          <p className={muteLine}>
            일정을 불러오지 못했어요.{" "}
            <button type="button" onClick={() => void refetchUp()} className="font-bold text-btn">
              다시 시도
            </button>
          </p>
        ) : upcoming === null ? (
          <div className="space-y-1 px-1 pt-1" aria-busy="true" aria-label="불러오는 중">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className={muteLine}>한 달 동안 잡힌 일정이 없어요</p>
        ) : (
          <ul className="mt-0.5">
            {upcoming.map((ev) => {
              const k = dateKeyOf(Math.max(Date.parse(ev.startsAt), Date.parse(kstToIso(today))));
              const day = k === today ? "오늘" : formatDateKo(k);
              const time = formatEventTime(ev.startsAt, ev.endsAt, ev.allDay);
              return (
                <li key={eventKey(ev)}>
                  <Link
                    href={eventEditHref(groupId, ev)}
                    aria-label={`${day} ${ev.title}, ${time}, ${ev.creator.displayName}`}
                    className="flex h-12 items-stretch gap-2.5 rounded-sm px-3 py-1.5 hover:bg-hover"
                  >
                    <i aria-hidden="true" className="block w-[3px] shrink-0 rounded-[2px]" style={{ background: memberColor(ev.creator.color) }} />
                    <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col justify-center">
                      <b className="block truncate text-[14px] font-semibold leading-[18px]">{ev.title}</b>
                      <span className="block truncate text-[12px] leading-4 text-ink-2">
                        {day} {time}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div aria-hidden="true" className="mx-3 my-4 h-px shrink-0 bg-line" />

      {/* 다음 기념일 2줄: 이름 14/500 + D-n 14/700 (오늘이면 --acc-ink "오늘") */}
      <section aria-labelledby="side-ann" className="shrink-0">
        <div className={head}>
          <h2 id="side-ann">다음 기념일</h2>
        </div>
        {nextAnn === null ? (
          <div className="space-y-1 px-1 pt-1" aria-busy="true" aria-label="불러오는 중">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : nextAnn.length === 0 ? (
          <p className={muteLine}>
            기념일을 등록하면 D-day 가 보여요.{" "}
            <Link href={`/g/${groupId}/anniversaries`} className="font-bold text-btn">
              기념일 추가
            </Link>
          </p>
        ) : (
          <ul className="mt-0.5">
            {nextAnn.map((o) => {
              const badge = dayBadge(o.date, today);
              const title = occurrenceTitle(o);
              return (
                <li key={`${o.anniversary.id}-${o.date}`}>
                  <Link
                    href={`/g/${groupId}/anniversaries`}
                    aria-label={`${title}, ${formatDateKo(o.date)}, ${badge}`}
                    className="flex h-10 items-center gap-2 rounded-sm px-3 hover:bg-hover"
                  >
                    <span aria-hidden="true" className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      {title}
                    </span>
                    <b aria-hidden="true" className={`shrink-0 text-[14px] font-bold ${badge === "오늘" ? "text-acc-ink" : ""}`}>
                      {badge}
                    </b>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 맨 아래 내 정보: 아바타 32 + 이름 14/600 + "내 정보" 12 --mute */}
      <span aria-hidden="true" className="min-h-4 flex-1" />
      <Link href="/me" className="flex h-12 shrink-0 items-center gap-2.5 rounded-md px-2 hover:bg-hover">
        {group ? <Avatar member={group.me} color={group.me.color} size={32} /> : <Skeleton className="size-8 rounded-full" />}
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{group?.me.displayName ?? ""}</span>
        <span className="shrink-0 text-[12px] text-ink-2">내 정보</span>
      </Link>
    </aside>
  );
}
