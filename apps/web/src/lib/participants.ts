// 일정 참여자 (#248, 설계 docs/설계/일정-참여자.md 7장, D-140 ~ D-142). React 를 import 하지 않는다 (단위 테스트 대상)
// - 응답 participants = { all, members } (가입순). all 이면 members 는 그 팀 지금 멤버 전원, 아니면 참여자 (0 = 참여자 없음)
// - 색은 모두 memberColor() 를 거친다. 참여자 없음과 넘친 색은 --mute (새 색 없음, 디자인규칙 7장)
// - (#343) 일정 색(ev.color)을 골랐으면 막대, 점, 칩 모두 그 색 하나 (D-215). 참여자 이름 표기는 그대로
import { memberColor } from "./colors";
import type { Event, Member } from "./types";

export type Participants = { all: boolean; members: Member[] };

/** 폼에서 고른 값 = 보낼 값 ("ALL" 또는 멤버 userId 배열) */
export type ParticipantPick = "ALL" | number[];

type HasParticipants = Pick<Event, "creator"> & { participants?: Participants | null; color?: string | null };

export const MUTE = "var(--mute)";

/** 막대, 점 묶음에 그리는 최대 색 수 (기획 3-4) */
export const MAX_COLORS = 3;

/** 응답의 참여자. API 가 아직 participants 를 싣지 않으면(웹이 먼저 배포) 등록자 한 명으로 본다 */
export function participantsOf(ev: HasParticipants): Participants {
  return ev.participants ?? { all: false, members: [ev.creator] };
}

/** 참여자 색 (가입순, 화면 색). 참여자 없음이면 [] */
export function participantColors(ev: HasParticipants): string[] {
  return participantsOf(ev).members.map((m) => memberColor(m.color));
}

/** (#343) 일정을 그리는 색. 일정 색을 골랐으면 그 색 하나, 자동(null)이면 참여자 색 (D-215) */
export function eventColors(ev: HasParticipants): string[] {
  return ev.color ? [memberColor(ev.color)] : participantColors(ev);
}

/** 막대용 색: 일정 색이면 그 색 하나. 자동은 0명 → [--mute], 1~3명 → 그 색, 4명 이상 → 앞 3색 + --mute */
export function barColors(ev: HasParticipants): string[] {
  const colors = eventColors(ev);
  if (colors.length === 0) return [MUTE];
  if (colors.length <= MAX_COLORS) return colors;
  return [...colors.slice(0, MAX_COLORS), MUTE];
}

/** 색 하나면 단색, 둘 이상이면 같은 폭으로 단단하게 나눈 linear-gradient (D-141) */
export function splitBackground(colors: readonly string[], dir: "to bottom" | "to right"): string {
  if (colors.length === 0) return MUTE;
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  const pct = (n: number) => `${Number((n * step).toFixed(2))}%`;
  const stops = colors.map((c, i) => `${c} ${pct(i)} ${pct(i + 1)}`);
  return `linear-gradient(${dir}, ${stops.join(", ")})`;
}

/** 점 묶음 (PC 칩, 다가오는 일정 카드): 앞 max 색 + 넘치면 more. 참여자 없음은 회색 점 하나. 일정 색이면 그 점 하나 */
export function dotCluster(ev: HasParticipants, max = MAX_COLORS): { dots: string[]; more: boolean } {
  const colors = eventColors(ev);
  if (colors.length === 0) return { dots: [MUTE], more: false };
  return { dots: colors.slice(0, max), more: colors.length > max };
}

/** 칩 면 색: 일정 색, 자동이면 첫 참여자 색 (없으면 --mute) */
export function chipColor(ev: HasParticipants): string {
  return eventColors(ev)[0] ?? MUTE;
}

const nameOf = (m: Member, meId: number | null) => (meId !== null && m.userId === meId ? "나" : m.displayName);

/** 참여자 이름 표기: "나" / "민지" / "민지, 지훈" / "민지 외 2명" / "모두" / "참여자 없음" */
export function participantLabel(ev: HasParticipants, meId: number | null): string {
  return labelOf(participantsOf(ev), meId);
}

export function labelOf(p: Participants, meId: number | null): string {
  if (p.all) return "모두";
  const names = p.members.map((m) => nameOf(m, meId));
  if (names.length === 0) return "참여자 없음";
  if (names.length <= 2) return names.join(", ");
  return `${names[0]} 외 ${names.length - 1}명`;
}

/** 수정 폼의 처음 값 */
export function pickOf(ev: HasParticipants): ParticipantPick {
  const p = participantsOf(ev);
  if (p.all) return "ALL";
  return p.members.map((m) => m.userId).filter((id): id is number => id !== null);
}

/** 같은 선택인지 (순서 무시). 바꿨을 때만 보낸다 (D-142) */
export function samePick(a: ParticipantPick, b: ParticipantPick): boolean {
  if (a === "ALL" || b === "ALL") return a === b;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id)) && new Set(b).size === set.size;
}

/** 복제: 원본 참여자(pickOf)를 지금 멤버로 거르고, 비면 [나] (D-142). 이미 거른 값에 다시 써도 같다 */
export function copyPick(p: ParticipantPick, memberIds: readonly number[], meId: number): ParticipantPick {
  if (p === "ALL") return "ALL";
  const alive = new Set(memberIds);
  const kept = p.filter((id) => alive.has(id));
  return kept.length ? kept : [meId];
}

/** 고른 값 → 화면용 참여자 (팀 멤버 가입순). 지금 멤버가 아닌 id 는 빠진다 */
export function participantsFromPick(pick: ParticipantPick, members: readonly Member[]): Participants {
  if (pick === "ALL") return { all: true, members: [...members] };
  const set = new Set(pick);
  return { all: false, members: members.filter((m) => m.userId !== null && set.has(m.userId)) };
}

/** 정렬된 사본 (스냅샷, 본문용) */
export function normalizePick(pick: ParticipantPick): ParticipantPick {
  return pick === "ALL" ? "ALL" : [...new Set(pick)].sort((a, b) => a - b);
}

/** 목록 줄, aria-label 에 붙는 사람 표기. 개인 팀은 사람 표시를 하지 않는다 (null, 7-2) */
export type WhoContext = { meId: number | null; personal: boolean };

export function whoOf(ev: HasParticipants, who: WhoContext): string | null {
  return who.personal ? null : participantLabel(ev, who.meId);
}

/** "제목, 시각" 뒤에 사람 표기를 붙인다 */
export function withWho(text: string, ev: HasParticipants, who: WhoContext): string {
  const w = whoOf(ev, who);
  return w ? `${text}, ${w}` : text;
}

/** 폼의 참여자 줄을 보이는지: 개인 팀, "이 일정만" 으로 들어온 반복 수정은 숨긴다 (7-3) */
export function showParticipantRow(o: { personal: boolean; thisOnly: boolean }): boolean {
  return !o.personal && !o.thisOnly;
}

/** 수정에서 참여자를 바꿨는지 (범위 시트가 "이 일정만" 을 막는다, D-135) */
export function participantsChanged(o: { editing: boolean; current: ParticipantPick | null; initial: ParticipantPick | null }): boolean {
  return o.editing && o.current !== null && o.initial !== null && !samePick(o.current, o.initial);
}

/**
 * 본문에 실을 participants (D-142). undefined 면 싣지 않는다
 * - 개인 팀, "이 일정만" 범위는 싣지 않는다 (서버는 this + participants 를 400)
 * - 생성: 팀이면 늘 싣는다
 * - 수정: 바꿨을 때만 (참여자 없음 일정의 제목만 고쳐도 400 이 나지 않게)
 */
export function participantsBody(o: {
  editing: boolean;
  personal: boolean;
  scope: "this" | "following" | null;
  current: ParticipantPick | null;
  initial: ParticipantPick | null;
}): ParticipantPick | undefined {
  if (o.personal || o.scope === "this" || o.current === null) return undefined;
  if (!o.editing) return normalizePick(o.current);
  return participantsChanged(o) ? normalizePick(o.current) : undefined;
}
