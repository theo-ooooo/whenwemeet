// (#378) 일정 줄(EventRow) 하나가 쓰는 순수 계산: 시각 글자(한 번만), 지난 일정, 보일 참여자, 내 참석 표시, 읽기 이름.
// 일 상세, 다가오는 일정, 검색, 홈이 같은 줄을 쓴다 (디자인규칙.md 8-4). React 를 import 하지 않는다 (단위 테스트 대상)
import { dateKeyOf, parseKey, toKst, type DateKey } from "./date";
import { participantsOf, type WhoContext, whoOf } from "./participants";
import { RSVP_LABEL, showRsvp } from "./rsvp";
import { lastDayOf } from "./upcoming";
import type { Event, Member, Rsvp } from "./types";

type Clock = { meridiem: "오전" | "오후"; text: string };

/** 시각 하나 → 오전/오후 h:mm (KST). 0시는 "오전 12:00", 12시는 "오후 12:00" */
export function clockOf(at: string | number): Clock {
  const { h, min } = toKst(at);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { meridiem: h < 12 ? "오전" : "오후", text: `${h12}:${String(min).padStart(2, "0")}` };
}

/** "오전 8:00" */
export function clockText(at: string | number): string {
  const c = clockOf(at);
  return `${c.meridiem} ${c.text}`;
}

/** 같은 날 두 시각 "오전 8:00 ~ 9:00". 오전/오후가 바뀌면 끝에도 붙인다 "오전 11:00 ~ 오후 1:00" */
export function clockRangeText(start: string | number, end: string | number): string {
  const s = clockOf(start);
  const e = clockOf(end);
  return `${s.meridiem} ${s.text} ~ ${e.meridiem === s.meridiem ? "" : `${e.meridiem} `}${e.text}`;
}

const md = (key: DateKey) => {
  const { m, d } = parseKey(key);
  return `${m}월 ${d}일`;
};

/**
 * 일정 줄의 시각 글자. 줄마다 **한 번만** 쓴다 (예전 왼쪽 시각 열 + 카드 안 시각 두 번을 없앤다).
 * day 는 그 줄이 놓인 날(일 상세, 다가오는 일정의 날짜 묶음). 없으면 시작한 날 기준(검색).
 * - 하루 시간 일정: "오전 8:00 ~ 9:00"
 * - 종일 하루: "종일"
 * - 여러 날 종일: "종일 ~11월 22일" (마지막 날 줄은 "종일")
 * - 여러 날 시간 일정: 시작한 날 "오후 10:00 ~ 11월 22일 오전 2:00", 가운데 날 "종일 ~11월 22일", 끝나는 날 "~ 오전 2:00"
 */
export function eventRowTime(ev: Pick<Event, "startsAt" | "endsAt" | "allDay">, day?: DateKey): string {
  const first = dateKeyOf(ev.startsAt);
  const last = lastDayOf(ev);
  const on = day ?? first;
  if (ev.allDay) return on < last ? `종일 ~${md(last)}` : "종일";
  if (first === last) return clockRangeText(ev.startsAt, ev.endsAt);
  if (on <= first) return `${clockText(ev.startsAt)} ~ ${md(last)} ${clockText(ev.endsAt)}`;
  if (on < last) return `종일 ~${md(last)}`;
  return `~ ${clockText(ev.endsAt)}`;
}

/** 지난 일정 (끝 시각이 지금 이전). 줄을 흐리게 그린다 */
export function isPastEvent(ev: Pick<Event, "endsAt">, now: number): boolean {
  return Date.parse(ev.endsAt) <= now;
}

/**
 * 줄에 보일 참여자. 개인 팀이면 없음. 앞 max 명 아바타 + 넘친 수.
 * (#427) "모두" 는 아바타를 늘어놓지 않고(팀 전체 일정이 대부분이라 소음, D-252) all=true 로 팀 아이콘 + "모두" 한 덩어리를 그린다.
 * 예전엔 아무것도 그리지 않아 "모두" 일정만 사람 표시가 빠졌다
 */
export function visibleParticipants(
  ev: Pick<Event, "creator" | "participants">,
  personal: boolean,
  max = 3,
): { all: boolean; members: Member[]; more: number } {
  const p = participantsOf(ev);
  if (personal) return { all: false, members: [], more: 0 };
  if (p.all) return { all: true, members: [], more: 0 };
  return { all: false, members: p.members.slice(0, max), more: Math.max(0, p.members.length - max) };
}

/** 내 참석 알약 글자. 참여자가 아니거나 아직 고르지 않았으면 null (줄에는 아무것도 그리지 않는다) */
export function myRsvpOf(ev: Pick<Event, "creator" | "participants" | "rsvp">, personal: boolean): Rsvp | null {
  if (!showRsvp(ev, personal)) return null;
  return ev.rsvp?.mine ?? null;
}

/**
 * 줄의 읽기 이름 (링크 aria-label). 보이는 조각을 같은 순서로: 제목, 날짜, 시각, 사람(모두면 "모두"), 장소, 내 참석, 그 밖.
 * 화면 조각은 aria-hidden 이고 이 한 줄만 읽힌다
 */
export function eventRowLabel(
  ev: Pick<Event, "title" | "startsAt" | "endsAt" | "allDay" | "creator" | "participants" | "rsvp">,
  o: { day?: DateKey; dateText?: string | null; who: WhoContext; place?: string | null; past?: boolean; extra?: readonly (string | null | undefined)[] },
): string {
  const rsvp = myRsvpOf(ev, o.who.personal);
  return [
    ev.title,
    o.dateText,
    eventRowTime(ev, o.day),
    whoOf(ev, o.who),
    o.place ? `장소 ${o.place}` : null,
    rsvp ? `내 응답 ${RSVP_LABEL[rsvp]}` : null,
    ...(o.extra ?? []),
    o.past ? "지난 일정" : null,
  ]
    .filter(Boolean)
    .join(", ");
}
