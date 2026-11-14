"use client";
// (#378) 일정 줄 하나. 일 상세(C안), 다가오는 일정, 검색, 홈이 같은 줄을 쓴다 (디자인규칙.md 8-4).
//   [4px 일정 색 막대] 제목 15/700 한 줄
//                      시각 한 번 13 `--mute` ("오전 8:00 ~ 9:00", "종일", "종일 ~11월 22일"). 앞에 dateText, 뒤에 extra
//                      (있을 때만) 핀 + 장소 이름, 참여자 아바타(모두가 아닐 때), 내 참석 알약
//                      (있을 때만) note 한 줄 (검색의 메모 미리보기)
// 지난 일정은 흐리게(불투명 55%). 누르면 일정 상세(`/events/<코드>`, 넓은 화면 패널은 onClick 으로 가로챈다).
// 자료는 모두 props 로 받는다. 장소 이름 다시 찾기(#199 usePlaceResolve)만 resolvePlace 일 때 부른다(한 화면에 줄이 많으면 끈다)
import Link from "next/link";
import { IconPin, IconTeam } from "./icons";
import { Avatar } from "./ui";
import { usePlaceResolve } from "@/hooks";
import { eventRowLabel, eventRowTime, isPastEvent, myRsvpOf, visibleParticipants } from "@/lib/event-row";
import { chipColor, type WhoContext } from "@/lib/participants";
import { placeLabel } from "@/lib/place";
import { eventHref } from "@/lib/routes";
import { RSVP_LABEL } from "@/lib/rsvp";
import type { DateKey } from "@/lib/date";
import type { Event, Place, Rsvp } from "@/lib/types";

export type EventRowProps = {
  event: Event;
  /** 사람 표기 기준 (내 id, 개인 팀). 개인 팀은 아바타와 참석을 그리지 않는다 */
  who: WhoContext;
  /** 줄이 놓인 날 (일 상세, 날짜 묶음). 여러 날 일정의 시각 글자가 그날 기준이 된다. 없으면 시작한 날 */
  day?: DateKey;
  /** 시각 앞 날짜 글자 (날짜로 묶지 않은 목록: 검색) */
  dateText?: string;
  /** 지금 (ms). 주면 끝난 일정을 흐리게 */
  now?: number;
  /** 제목 대신 그릴 것 (검색 강조). 읽기 이름은 늘 event.title */
  title?: React.ReactNode;
  /** 시각 줄 뒤 작은 조각 (반복 표시, 팀 이름) */
  extra?: React.ReactNode;
  /** 맨 아래 한 줄 (메모 미리보기) */
  note?: React.ReactNode;
  /** extra, note 의 읽기 글자 (aria-label 끝에 붙는다) */
  labelExtra?: readonly (string | null | undefined)[];
  /** 장소 이름을 다시 찾아 보일지 (카카오 장소). 끄면 사용자 글자만 */
  resolvePlace?: boolean;
  /** 기본은 일정 상세 주소 */
  href?: string;
  /** 넓은 화면 패널처럼 같은 자리에서 열 때 (preventDefault 로 이동을 막는다) */
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

/** 줄 묶음 카드 (흰 면, 모서리 16). 줄 사이 1px `--line` 은 카드 안쪽 여백 선에서 */
export function EventList({ label, className = "", children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <ul aria-label={label} className={`overflow-hidden rounded-xl bg-paper ${className}`}>
      {children}
    </ul>
  );
}

export function EventRow(props: EventRowProps) {
  const { event: ev, resolvePlace = false } = props;
  const hasPlace = placeLabel(ev.place) !== null;
  // 장소가 있는 줄만 훅을 부르는 조각을 따로 그린다 (훅을 조건으로 부르지 않으려고)
  return hasPlace && resolvePlace ? <ResolvedRow {...props} place={ev.place!} /> : <RowBody {...props} placeName={placeLabel(ev.place)} />;
}

function ResolvedRow(props: EventRowProps & { place: Place }) {
  const r = usePlaceResolve(props.place);
  return <RowBody {...props} placeName={r.data?.place?.name ?? placeLabel(props.place)} />;
}

function RowBody({
  event: ev,
  who,
  day,
  dateText,
  now,
  title,
  extra,
  note,
  labelExtra,
  href,
  onClick,
  placeName,
}: EventRowProps & { placeName: string | null }) {
  const time = eventRowTime(ev, day);
  const past = now !== undefined && isPastEvent(ev, now);
  const people = visibleParticipants(ev, who.personal);
  const rsvp = myRsvpOf(ev, who.personal);
  const hasMeta = placeName !== null || people.all || people.members.length > 0 || rsvp !== null;
  const label = eventRowLabel(ev, { day, dateText, who, place: placeName, past, extra: labelExtra });

  return (
    <li className="relative not-first:after:pointer-events-none not-first:after:absolute not-first:after:inset-x-3.5 not-first:after:top-0 not-first:after:h-px not-first:after:bg-line">
      <Link
        href={href ?? eventHref(ev)}
        onClick={onClick}
        aria-label={label}
        className={`flex min-h-[60px] items-stretch gap-3 px-3.5 py-2.5 hover:bg-[color-mix(in_srgb,var(--tile),var(--ink)_5%)] ${past ? "opacity-55" : ""}`}
      >
        <i aria-hidden="true" data-bar className="block w-1 shrink-0 rounded-full" style={{ background: chipColor(ev) }} />
        <span aria-hidden="true" className="min-w-0 flex-1 self-center">
          <b className="block truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">{title ?? ev.title}</b>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-ink-2">
            {dateText && <span className="shrink-0 font-semibold">{dateText}</span>}
            <span className="truncate">{time}</span>
            {extra}
          </span>
          {hasMeta && (
            <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-ink-2">
              {placeName !== null && (
                <span className="flex min-w-0 items-center gap-1">
                  <IconPin size={14} className="shrink-0" />
                  <span className="truncate">{placeName}</span>
                </span>
              )}
              {/* (#427) 모두: 아바타를 늘어놓지 않고 팀 아이콘 + "모두" */}
              {people.all && (
                <span className="flex shrink-0 items-center gap-1">
                  <IconTeam size={14} className="shrink-0" />
                  모두
                </span>
              )}
              {people.members.length > 0 && (
                <span className="flex shrink-0 items-center">
                  {people.members.map((m, i) => (
                    <span key={`${m.userId ?? "x"}-${i}`} className={`inline-flex rounded-full ring-2 ring-paper ${i > 0 ? "-ml-1" : ""}`}>
                      <Avatar member={m} color={m.color} size={18} />
                    </span>
                  ))}
                  {people.more > 0 && <span className="ml-1 text-[11px] font-semibold">+{people.more}</span>}
                </span>
              )}
              {rsvp !== null && <RsvpPill value={rsvp} />}
            </span>
          )}
          {note && <span className="mt-1 block truncate text-[12px] leading-4 text-soft">{note}</span>}
        </span>
      </Link>
    </li>
  );
}

/** 내 참석 알약 11/700. 참석은 먹색 글자 + `--hover` 면, 미정과 불참은 테두리만 (색으로만 가르지 않고 글자로) */
function RsvpPill({ value }: { value: Rsvp }) {
  const on = value === "GOING";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-px text-[11px] font-bold leading-4 ${on ? "bg-hover text-ink" : "border border-line text-ink-2"}`}
    >
      {RSVP_LABEL[value]}
    </span>
  );
}
