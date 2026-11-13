// 일정 참석 여부와 짧은 반응 (#190, 설계 docs/설계/참석-여부.md). React 를 import 하지 않는다 (단위 테스트 대상)
// - 참석 여부는 그 회차의 참여자만, 반응은 팀원 누구나. 개인 팀은 두 줄 모두 숨긴다 (웹에서만 분기)
// - 응답은 회차 단위: 반복 일정은 occurrence, 한 번짜리는 생략
import { participantsOf } from "./participants";
import type { Event, Reaction, ReactionSummary, Rsvp, RsvpSummary } from "./types";

/** 세그먼트 순서: 참석 / 미정 / 불참 (가운데가 미정, 이슈 화면 초안) */
export const RSVP_OPTIONS: readonly { value: Rsvp; label: string }[] = [
  { value: "GOING", label: "참석" },
  { value: "MAYBE", label: "미정" },
  { value: "NOT_GOING", label: "불참" },
];

export const RSVP_LABEL: Record<Rsvp, string> = { GOING: "참석", MAYBE: "미정", NOT_GOING: "불참" };

/** 반응 낱말 3개 (Q5). 이모지 없음 */
export const REACTION_OPTIONS: readonly { value: Reaction; label: string }[] = [
  { value: "LIKE", label: "좋아요" },
  { value: "EXCITED", label: "기대돼요" },
  { value: "ACK", label: "확인했어요" },
];

export const EMPTY_REACTIONS: ReactionSummary = { LIKE: 0, EXCITED: 0, ACK: 0, mine: null };

/** 내가 이 일정(회차)의 참여자인지. 모두면 팀원 누구나 */
export function isParticipant(ev: Pick<Event, "creator" | "participants">, meId: number | null): boolean {
  if (meId === null) return false;
  const p = participantsOf(ev);
  return p.all || p.members.some((m) => m.userId === meId);
}

/** 응답 줄을 그릴지: 개인 팀이 아니고, API 가 집계를 주고, 참여자가 한 명 이상 */
export function showRsvp(ev: Pick<Event, "creator" | "participants" | "rsvp">, personal: boolean): boolean {
  if (personal || !ev.rsvp) return false;
  return participantsOf(ev).members.length > 0;
}

/** 집계 한 줄 "참석 3, 미정 1, 불참 1, 응답 전 2". 0 인 칸은 뺀다. 아무도 없으면 "아직 아무도 답하지 않았어요" */
export function rsvpSummaryText(s: RsvpSummary): string {
  const parts: string[] = [];
  if (s.going) parts.push(`참석 ${s.going}`);
  if (s.maybe) parts.push(`미정 ${s.maybe}`);
  if (s.notGoing) parts.push(`불참 ${s.notGoing}`);
  if (s.pending) parts.push(`응답 전 ${s.pending}`);
  if (s.going + s.maybe + s.notGoing === 0) return "아직 아무도 답하지 않았어요";
  return parts.join(", ");
}

/** 내 응답을 바꾼 집계 (서버 응답 전 화면에 먼저 그린다). 참여자가 아니면 그대로 */
export function applyMyRsvp(s: RsvpSummary, next: Rsvp | null): RsvpSummary {
  const out = { ...s };
  const bump = (v: Rsvp | null, d: number) => {
    if (v === "GOING") out.going += d;
    else if (v === "MAYBE") out.maybe += d;
    else if (v === "NOT_GOING") out.notGoing += d;
    else out.pending += d;
  };
  bump(s.mine, -1);
  bump(next, 1);
  out.mine = next;
  return out;
}

/** 내 반응을 바꾼 집계. 같은 반응을 다시 누르면 취소(null) */
export function applyMyReaction(s: ReactionSummary, next: Reaction | null): ReactionSummary {
  const out = { ...s };
  if (s.mine) out[s.mine] = Math.max(0, out[s.mine] - 1);
  if (next) out[next] += 1;
  out.mine = next;
  return out;
}

/** 누른 반응 → 보낼 값. 내 반응을 다시 누르면 취소 */
export function nextReaction(mine: Reaction | null, pressed: Reaction): Reaction | null {
  return mine === pressed ? null : pressed;
}

/** 응답, 반응 요청의 회차 쿼리. 반복 회차만 */
export function occurrenceQuery(ev: Pick<Event, "repeat" | "occurrence">): string | undefined {
  return ev.repeat && ev.occurrence ? ev.occurrence : undefined;
}
