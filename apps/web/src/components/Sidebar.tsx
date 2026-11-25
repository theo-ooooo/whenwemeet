"use client";
// 넓은 화면(≥600, fold 와 pc) 왼쪽 사이드바 264 (디자인규칙.md 2-2, 4-2, 4-3, 5, #212, D-69).
// 위에서부터 심볼 34 → 팀 선택 상자 48 → 메뉴(줄 46) → 구분선 → 다가오는 일정 3줄 → 구분선 → 다음 기념일 2줄 → 맨 아래 내 정보.
// D-58 의 레일과 개요 칸(다가오는 일정, D-day) 내용이 여기 아래 묶음으로 옮겨 왔다. 오늘 비는 시간은 달력 요약 카드가 맡는다.
// (#315, D-200) 접으면 72 아이콘 레일: 심볼 → 팀 아바타(팀 바꾸기) → 메뉴 아이콘 6개(#276 할 일 포함)(누르는 칸 44, 지금 화면은 먹색 칩) → 내 정보 아바타 → 펼치기.
// 접힌 아이콘은 마우스를 올리거나 키보드로 포커스하면 오른쪽에 이름 툴팁. 아래 묶음(다가오는 일정, 기념일)은 접힌 동안 받지 않는다
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { useAnniversaryItems, useEvents } from "@/hooks";
import { occurrenceTitle } from "@/lib/anniversary";
import { memberColor } from "@/lib/colors";
import { addDays, dateKeyOf, formatDateKo, formatEventTime, kstToIso, todayKey } from "@/lib/date";
import { dayBadge, upcomingEvents } from "@/lib/day-detail";
import { nextOccurrences } from "@/lib/day-view";
import { barColors, splitBackground, withWho } from "@/lib/participants";
import { eventKey } from "@/lib/recurrence";
import { ANNIVERSARIES_PATH, CALENDAR_PATH, eventEditHref, FREE_PATH, NEWS_PATH, SEARCH_PATH, TEAM_PATH, TODOS_PATH, UPCOMING_PATH } from "@/lib/routes";
import type { GroupDetail } from "@/lib/types";
import { Symbol } from "./Logo";
import { PollSideLine } from "./PollHomeSection";
import { AvatarDot, IconBell, IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight, IconFree, IconHeart, IconSearch, IconTeam, IconTodo } from "./icons";
import { Avatar, Skeleton } from "./ui";

type Props = {
  /** (#311) 아직 팀이 정해지지 않았으면 null (아래 묶음을 받지 않는다) */
  groupId: number | null;
  group: GroupDetail | null;
  /** 켤 메뉴 (lib/routes.ts activeTab). 일정 화면은 calendar 로 온다 */
  tab: string | null;
  unread: number;
  /** (#515) 안 본 공지가 있으면 내 정보 아바타에 코랄 점 */
  noticeDot?: boolean;
  /** 넓은 화면일 때만 아래 묶음 데이터를 받는다 (폰은 이 사이드바가 숨어 있다) */
  enabled: boolean;
  /** 바뀌면 아래 묶음을 다시 받는다 (화면 이동, 달력에서 일정 추가/삭제) */
  refreshKey: string;
  onSwitchTeam: () => void;
  /** (#315) 72 아이콘 레일로 접혔는가 */
  collapsed: boolean;
  /** (#315) 접기/펼치기 */
  onToggle: () => void;
  /** (#339) 메뉴를 눌러 이동이 시작될 때(Link onNavigate). AppShell 이 선택 칩을 바로 옮긴다 */
  onNavigate?: (href: string) => void;
};

const nowMs = () => Date.now();

/** 팀 선택 상자의 멤버 점 둘 (겹쳐 그린다). 개인 달력은 먹색 하나 */
function TeamDots({ group, small = false }: { group: GroupDetail | null; small?: boolean }) {
  if (!group) return small ? null : <Skeleton className="size-5 rounded-full" />;
  const colors = group.type === "PERSONAL" ? ["var(--ink)"] : group.members.slice(0, 2).map((m) => memberColor(m.color));
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {colors.map((c, i) => (
        <i key={i} className={`block ${small ? "size-2.5" : "size-3.5"} rounded-full ring-2 ring-[var(--bg)] ${i > 0 ? (small ? "-ml-1" : "-ml-1.5") : ""}`} style={{ background: c }} />
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
    case "todos":
      return <IconTodo size={24} active={active} />;
    case "news":
      return <IconBell size={24} unread={unread} />;
    default:
      return <IconTeam size={24} active={active} />;
  }
}

/** (#315) 접힌 레일 칸의 툴팁. 마우스를 올리거나 키보드 포커스에서 오른쪽에 화면 이름 (스크린 리더는 칸의 aria-label 을 읽는다) */
function RailTip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 z-40 ml-2.5 hidden -translate-y-1/2 whitespace-nowrap rounded-sm bg-ink px-2.5 py-1.5 text-[12px] font-bold leading-4 text-on-ink shadow-[var(--fab-shadow)] group-hover:block group-focus-within:block"
      data-tooltip
    >
      {label}
    </span>
  );
}

export function Sidebar(props: Props) {
  return props.collapsed ? <SidebarRail {...props} /> : <SidebarFull {...props} />;
}

/** (#315) 접힌 72 레일. 칸 44, 먹색 칩은 폰 독과 같은 규칙 (디자인규칙.md 4-1, 4-3) */
function SidebarRail({ group, tab, unread, noticeDot = false, onSwitchTeam, onToggle, onNavigate }: Props) {
  const calendarOn = tab === "calendar" || tab === "upcoming";
  const menu = [
    { key: "calendar", href: CALENDAR_PATH, label: "달력", on: calendarOn },
    { key: "free", href: FREE_PATH, label: "빈 시간", on: tab === "free" },
    { key: "anniversaries", href: ANNIVERSARIES_PATH, label: "기념일", on: tab === "anniversaries" },
    // (#276) 할 일은 기념일과 새 소식 사이 (디자인규칙.md 4-2). 폰 독은 빈 시간과 기념일 사이 (#332, 4-1)
    { key: "todos", href: TODOS_PATH, label: "할 일", on: tab === "todos" },
    { key: "news", href: NEWS_PATH, label: "새 소식", on: tab === "news", badge: unread },
    { key: "settings", href: TEAM_PATH, label: "팀 설정", on: tab === "team" },
  ];
  const cell = "group relative grid size-11 place-items-center rounded-[14px]";
  return (
    <aside
      data-collapsed="true"
      // (#323) sticky 는 쌓임 맥락을 만든다. z 없이 두면 DOM 에서 뒤에 오는 본문의 위치 지정 요소(카드, 칩)가 레일 밖으로 나간 툴팁을 덮는다.
      // 레일을 본문 위 층(z-30)에 둬 툴팁이 본문 위에 온전히 보이게 한다. 시트, 팝오버(z-40 이상, 본문 밖 fixed) 보다는 아래
      className="sticky top-0 z-30 hidden h-dvh flex-col items-center border-r border-line bg-paper pb-4 pt-5 fold:flex"
    >
      <div className={cell}>
        <Link href={CALENDAR_PATH} aria-label="언제볼까 달력" className="grid size-[34px] place-items-center rounded-sm">
          <Symbol size={34} />
        </Link>
      </div>

      {/* 팀 아바타: 팀 이름 첫 글자 + 멤버 점. 누르면 펼친 상자와 같은 팀 전환 시트 */}
      <div className={`${cell} mt-4`}>
        <button
          type="button"
          onClick={onSwitchTeam}
          aria-haspopup="dialog"
          aria-label={group ? `${group.name}, 팀 바꾸기` : "팀 바꾸기"}
          className="relative grid size-11 place-items-center rounded-md bg-surface hover:brightness-[0.98]"
        >
          {group ? (
            <span aria-hidden="true" className="text-[16px] font-bold leading-none">
              {Array.from(group.name)[0] ?? ""}
            </span>
          ) : (
            <Skeleton className="size-5 rounded-full" />
          )}
          <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5">
            <TeamDots group={group} small />
          </span>
        </button>
        <RailTip label={group ? group.name : "팀 바꾸기"} />
      </div>

      {/* (#199) 일정 검색 */}
      <div className={`${cell} mt-2`}>
        <Link
          href={SEARCH_PATH}
          onNavigate={onNavigate ? () => onNavigate(SEARCH_PATH) : undefined}
          aria-label="일정 검색"
          className="grid size-11 place-items-center rounded-[14px] text-ink-2 hover:bg-hover"
        >
          <IconSearch size={22} />
        </Link>
        <RailTip label="일정 검색" />
      </div>

      <nav aria-label="주요 화면" className="mt-4">
        <ul className="flex flex-col items-center gap-1">
          {menu.map((it) => (
            <li key={it.key} className={cell}>
              <Link
                href={it.href}
                onNavigate={onNavigate ? () => onNavigate(it.href) : undefined}
                aria-current={it.on ? "page" : undefined}
                aria-label={it.badge ? `${it.label}, 새 소식 ${it.badge}개` : it.label}
                className={`relative grid size-11 place-items-center rounded-[14px] ${it.on ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-hover"}`}
              >
                <MenuIcon name={it.key} active={it.on} unread={Boolean(it.badge)} />
              </Link>
              <RailTip label={it.label} />
            </li>
          ))}
        </ul>
      </nav>

      <span aria-hidden="true" className="flex-1" />
      <div className={cell}>
        <Link href="/me" aria-label={noticeDot ? "내 정보, 새 공지" : "내 정보"} className="relative grid size-11 place-items-center rounded-full">
          {noticeDot && <AvatarDot />}
          {group ? <Avatar member={group.me} color={group.me.color} size={32} /> : <Skeleton className="size-8 rounded-full" />}
        </Link>
        <RailTip label="내 정보" />
      </div>
      <div className={`${cell} mt-2`}>
        <button type="button" onClick={onToggle} aria-label="사이드바 펼치기" aria-expanded={false} className="grid size-11 place-items-center rounded-[14px] text-ink-2 hover:bg-hover">
          <IconChevronRight size={20} />
        </button>
        <RailTip label="펼치기" />
      </div>
    </aside>
  );
}

function SidebarFull({ groupId, group, tab, unread, noticeDot = false, enabled, refreshKey, onSwitchTeam, onToggle, onNavigate }: Props) {
  const today = todayKey();
  const upcomingQ = useEvents(groupId ?? 0, { from: kstToIso(today), to: kstToIso(addDays(today, 31)) }, { enabled });
  const annQ = useAnniversaryItems(groupId ?? 0, { enabled });
  const meId = group?.me.userId ?? null;
  const personal = group?.type === "PERSONAL";

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
  const calendarOn = tab === "calendar" || tab === "upcoming";
  const menu = [
    { key: "calendar", href: CALENDAR_PATH, label: "달력", on: calendarOn },
    { key: "free", href: FREE_PATH, label: "빈 시간", on: tab === "free" },
    { key: "anniversaries", href: ANNIVERSARIES_PATH, label: "기념일", on: tab === "anniversaries" },
    // (#276) 할 일은 기념일과 새 소식 사이 (디자인규칙.md 4-2). 폰 독은 빈 시간과 기념일 사이 (#332, 4-1)
    { key: "todos", href: TODOS_PATH, label: "할 일", on: tab === "todos" },
    { key: "news", href: NEWS_PATH, label: "새 소식", on: tab === "news", badge: unread },
    { key: "settings", href: TEAM_PATH, label: "팀 설정", on: tab === "team" },
  ];

  const head = "flex h-8 items-center px-3 text-[15px] font-bold leading-5 tracking-[-0.01em]";
  const muteLine = "px-3 py-2 text-[13px] leading-[18px] text-ink-2";

  return (
    // (#429) 아래 내 정보 줄과 접기 ◀ 는 늘 보여야 한다. 키 작은 창에서 넘치면 가운데 묶음만 스크롤한다.
    // 위 묶음과 아래 줄만으로도 넘칠 만큼 낮은 창(약 530 미만)에서만 사이드바 전체가 스크롤된다
    <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-paper px-4 pb-4 pt-5 fold:flex">
      <Link href={CALENDAR_PATH} aria-label="언제볼까 달력" className="ml-2 grid size-[34px] shrink-0 place-items-center rounded-sm">
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

      {/* (#199) 일정 검색: 팀 상자 아래 검색칸 모양 링크 (높이 40, --bg 면). 누르면 검색 화면 */}
      <Link
        href={SEARCH_PATH}
        onNavigate={onNavigate ? () => onNavigate(SEARCH_PATH) : undefined}
        className="mt-2 flex h-10 w-full shrink-0 items-center gap-2 rounded-md bg-surface px-3.5 text-[14px] text-ink-2 hover:text-ink"
      >
        <IconSearch size={18} className="shrink-0" />
        일정 검색
      </Link>

      {/* 메뉴: 줄 46, 모서리 14, 아이콘 24 + 이름 15. 선택 = 먹색 칩 + 흰 글자 700 + 코랄 조각 (다크는 --ink/--on-ink 가 뒤집힌다) */}
      <nav aria-label="주요 화면" className="mt-4 shrink-0">
        <ul className="flex flex-col gap-0.5">
          {menu.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                onNavigate={onNavigate ? () => onNavigate(it.href) : undefined}
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

      <div aria-hidden="true" className="mx-3 mt-4 h-px shrink-0 bg-line" />

      {/* (#429) 가운데 묶음(투표, 다가오는 일정, 다음 기념일): 남는 높이만 쓰고 넘치면 이 칸만 스크롤.
          스크롤바는 사이드바 끝에 붙게 좌우 여백을 안으로 옮기고, 넘친 내용은 바닥 16 을 흐리게 해 더 있다는 걸 보인다 */}
      <div data-side-scroll className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 [mask-image:linear-gradient(to_bottom,#000_calc(100%-16px),transparent)]">
        {/* (#189) 진행 중 약속 투표가 있으면 다가오는 일정 위에 한 줄 (설계 약속-투표.md 5-2) */}
        {groupId !== null && <PollSideLine groupId={groupId} enabled={enabled && group?.type === "TEAM"} refreshKey={refreshKey} />}

        {/* 다가오는 일정 3줄: 3px 멤버 막대 + 제목 14/600 + 날짜와 시각 12 --mute. 누르면 그 일정 (반복은 회차까지) */}
        <section aria-labelledby="side-up" className="shrink-0">
          <div className={head}>
            <h2 id="side-up">다가오는 일정</h2>
            <span className="flex-1" />
            <Link href={UPCOMING_PATH} className="hit text-[12px] font-normal text-ink-2 hover:text-ink">
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
                      href={eventEditHref(ev)}
                      aria-label={withWho(`${day} ${ev.title}, ${time}`, ev, { meId, personal })}
                      className="flex h-12 items-stretch gap-2.5 rounded-sm px-3 py-1.5 hover:bg-hover"
                    >
                      <i aria-hidden="true" className="block w-[3px] shrink-0 rounded-[2px]" style={{ background: splitBackground(barColors(ev), "to bottom") }} />
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
              <Link href={ANNIVERSARIES_PATH} className="font-bold text-btn">
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
                      href={ANNIVERSARIES_PATH}
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
      </div>

      {/* 맨 아래 내 정보: 아바타 32 + 이름 14/600 + "내 정보" 12 --mute. 오른쪽에 접기 ◀ (#315). 가운데 묶음이 넘쳐도 밀리지 않는다 (#429) */}
      <div data-side-footer className="flex shrink-0 items-center gap-1">
        <Link href="/me" aria-label={noticeDot ? `${group?.me.displayName ?? ""} 내 정보, 새 공지` : undefined} className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 hover:bg-hover">
          <span className="relative shrink-0">
            {noticeDot && <AvatarDot />}
            {group ? <Avatar member={group.me} color={group.me.color} size={32} /> : <Skeleton className="size-8 rounded-full" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{group?.me.displayName ?? ""}</span>
          <span className="shrink-0 text-[12px] text-ink-2">내 정보</span>
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label="사이드바 접기"
          aria-expanded={true}
          className="grid size-11 shrink-0 place-items-center rounded-[14px] text-ink-2 hover:bg-hover"
        >
          <IconChevronLeft size={20} />
        </button>
      </div>
    </aside>
  );
}
