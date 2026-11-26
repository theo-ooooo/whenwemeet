// (#450) AI 비서 "볼까" 웹 쪽 순수 계산 (설계 AI-비서.md 7장, api.md 2.15). React 를 import 하지 않는다 (단위 테스트 대상).
// - 대화 메시지 모양과 서버로 보낼 history 만들기 (최근 10턴, 볼까 턴은 서버가 준 historyText)
// - 카드 → 기존 저장 본문(EventInput, PollInput), [고치기] 주소(/events/new?...&from=assistant)
// - 빈 시간 카드에서 웹이 만드는 투표 초안 (서버 요청 없음, D-273)
// - 카드 글자 (날짜 시각 한 줄, 빈 시간 조건 한 줄), 예시 문장
// - (#511) 고치기, 지우기 카드 → PATCH 본문과 범위, 고르기 후보 → 확인 카드 (D-283)
import { addDays, clockRangeText, clockText, dateKeyOf, formatDateKo, formatMinutes, kstToIso, type DateKey } from "./date";
import { lunarLabelOf } from "./lunar";
import { newEventHref } from "./routes";
import type { Event, EventInput, EventPatchInput, EventScope, Member, PollInput, PollOptionInput } from "./types";

/* ---------- 서버 계약 (api.md 2.15, AI-비서.md 2장) ---------- */

/** GET /me 의 assistant. 옛 API 는 없음 = 버튼을 그리지 않는다 */
export type AssistantMeta = { available: boolean; consented: boolean; dailyLimit: number; usedToday: number };

export type AssistantTurn = { role: "user" | "assistant"; text: string };
export type AssistantRequest = { text: string; history?: AssistantTurn[] };

export type EventDraftCard = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: { text: string } | null;
  participants: number[];
  members: Member[];
  /** (#566) "음력 3월 15일" 로 말한 날짜면 true (D-298). 카드에 음력 날짜를 같이 보이고 저장도 음력 입력으로 */
  lunarInput?: boolean;
};

export type FreeQuery = {
  from: string;
  to: string;
  dayStart: string;
  dayEnd: string;
  minMinutes: number;
  days: "all" | "weekend" | "weekday";
  participants: number[];
};

export type PollDraft = { title: string; options: PollOptionInput[]; participants: number[] };

export type AssistantEvent = {
  id: number;
  publicCode: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  occurrence: string | null;
  members: Member[];
};

export type AssistantDay = { name: string; date: DateKey; kind: "ANNIVERSARY" | "BIRTHDAY"; dday: number };

/** change: (#511) 고칠 일정은 찾았는데 바꿀 값을 말하지 않음 */
export type ClarifyField = "date" | "time" | "title" | "period" | "which" | "participant" | "change";
/** (#511) 고치기, 지우기는 확인 카드라 여기 없다 (D-283) */
export type UnsupportedAction =
  | "repeat"
  | "reminder"
  | "anniversary_create"
  | "todo"
  | "team"
  | "other_team"
  | "team_only"
  | "other";

/** (#511) 고치기, 지우기 대상 일정. 반복이면 그 회차(occurrence)이고 이 회차만(scope this) 고치고 지운다 */
export type EventTarget = {
  id: number;
  publicCode: string;
  occurrence: string | null;
  repeat: boolean;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: { text: string } | null;
  members: Member[];
};

/** (#511) 고친 뒤 값 */
export type EventAfter = { title: string; startsAt: string; endsAt: string; allDay: boolean; place: { text: string } | null };
export type EventEditDraft = { target: EventTarget; after: EventAfter };
/** (#511) 고르기 후보. 고치기는 after 가 있고 지우기는 null */
export type EventChoiceOption = { target: EventTarget; after: EventAfter | null };

export type AssistantCard =
  | { type: "eventDraft"; draft: EventDraftCard }
  | { type: "eventEditDraft"; draft: EventEditDraft }
  | { type: "eventDeleteDraft"; target: EventTarget }
  | { type: "eventChoice"; action: "edit" | "delete"; options: EventChoiceOption[]; more: number }
  | { type: "freeSlots"; query: FreeQuery; slots: { startsAt: string; endsAt: string }[]; total: number; pollTitle: string | null }
  | { type: "pollDraft"; draft: PollDraft; members: Member[] }
  | { type: "eventList"; from: string; to: string; events: AssistantEvent[]; more: number; days: AssistantDay[] }
  | { type: "clarify"; field: ClarifyField; choices: Member[] }
  | { type: "unsupported"; action: UnsupportedAction; link: { label: string; href: string } | null }
  | { type: "refusal" };

export type AssistantReply = {
  reply: string;
  cards: AssistantCard[];
  historyText: string;
  usage: { used: number; limit: number };
};

/* ---------- 화면의 대화 (메모리만, D-264) ---------- */

/**
 * 대화 한 줄.
 * - user: 내가 보낸 글
 * - assistant: 서버 답 (말풍선 + 카드). historyText 는 다음 요청의 볼까 턴
 * - local: 웹이 만든 카드(빈 시간 → 투표 초안). 서버에 보내지 않는다
 * - error: 오류 말풍선. retry 가 있으면 "다시 보내기" 로 같은 글을 다시 보낸다. 서버에 보내지 않는다
 */
export type ChatMessage =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; reply: string; cards: AssistantCard[]; historyText: string }
  | { id: number; role: "local"; card: AssistantCard }
  | { id: number; role: "error"; text: string; retry: string | null };

/** 서버 계약의 한도 */
export const TEXT_MAX = 300;
export const TURN_MAX = 600;
export const HISTORY_TURNS = 10;
export const HISTORY_CHARS = 4000;
/** 이 글자 수부터 "N/300" 을 보인다 */
export const COUNTER_FROM = 250;
/** 남은 횟수가 이만큼 이하면 "오늘 N번 남았어요" 를 강조색으로 (#470 부터 늘 보인다) */
export const REMAIN_HINT = 5;

/**
 * 서버로 보낼 history: 사용자 글과 볼까의 historyText 만, 최근 10턴, 오래된 것이 앞, 합계 4,000자 이하.
 * 오류 말풍선, 웹이 만든 카드는 넣지 않는다 (7-4). 각 턴은 600자에서 자른다
 */
export function buildHistory(messages: readonly ChatMessage[]): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  // 답을 받지 못한 내 말(오류, 한도, 닫아서 끊김)은 보내지 않는다. 다음 메시지(웹 카드, 오류 제외)가 볼까 답인 것만
  const answered = (i: number) => messages.slice(i + 1).find((n) => n.role === "user" || n.role === "assistant")?.role === "assistant";
  messages.forEach((m, i) => {
    if (m.role === "user" && m.text.trim() && answered(i)) turns.push({ role: "user", text: m.text.trim().slice(0, TURN_MAX) });
    else if (m.role === "assistant" && m.historyText.trim()) turns.push({ role: "assistant", text: m.historyText.trim().slice(0, TURN_MAX) });
  });
  const recent = turns.slice(-HISTORY_TURNS);
  let total = recent.reduce((n, t) => n + t.text.length, 0);
  while (recent.length > 0 && total > HISTORY_CHARS) total -= recent.shift()!.text.length;
  return recent;
}

/* ---------- 카드 → 저장 본문 ---------- */

/** [추가] 본문 (POST /groups/:id/events). 알림 생략 = NONE, 장소는 직접 적은 글자 */
export function eventInputOf(d: EventDraftCard): EventInput {
  const input: EventInput = { title: d.title, startsAt: d.startsAt, endsAt: d.endsAt, allDay: d.allDay, participants: [...d.participants] };
  if (d.place?.text.trim()) input.place = { text: d.place.text.trim() };
  if (d.lunarInput) input.lunarInput = true;
  return input;
}

/* ---------- (#511) 고치기, 지우기 (D-283) ---------- */

/** 고친 뒤 값이 지금 값과 다른 칸 */
export function editChanges(d: EventEditDraft): { title: boolean; time: boolean; place: boolean } {
  const { target: t, after: a } = d;
  return {
    title: a.title !== t.title,
    time: a.startsAt !== t.startsAt || a.endsAt !== t.endsAt || a.allDay !== t.allDay,
    place: (a.place?.text ?? null) !== (t.place?.text ?? null),
  };
}

/** [수정] 본문 (PATCH /groups/:id/events/:eventId). 제목, 시각, 종일은 늘 싣고 장소는 바뀌었을 때만. 참여자, 반복, 알림, 색은 싣지 않는다 */
export function eventPatchOf(d: EventEditDraft): EventPatchInput {
  const input: EventPatchInput = { title: d.after.title, startsAt: d.after.startsAt, endsAt: d.after.endsAt, allDay: d.after.allDay };
  if (editChanges(d).place) input.place = d.after.place ? { text: d.after.place.text } : null;
  return input;
}

/** 반복 회차면 이 회차만 (scope this). "이후 모두" 는 [고치기] 로 연 폼에서만. 한 번짜리는 둘 다 생략 */
export function targetScope(t: Pick<EventTarget, "occurrence">): { occurrence?: string; scope?: EventScope } {
  return t.occurrence ? { occurrence: t.occurrence, scope: "this" } : {};
}

/** 고르기 후보 → 확인 카드 (웹이 만든다, 서버 요청 없음) */
export function cardOfChoice(action: "edit" | "delete", option: EventChoiceOption): AssistantCard | null {
  if (action === "delete") return { type: "eventDeleteDraft", target: option.target };
  return option.after ? { type: "eventEditDraft", draft: { target: option.target, after: option.after } } : null;
}

/** [투표 열기] 본문 (POST /groups/:id/polls). 마감 없음 */
export function pollInputOf(d: PollDraft): PollInput {
  return { title: d.title, options: d.options.map((o) => ({ startsAt: o.startsAt, endsAt: o.endsAt, allDay: false })), participants: [...d.participants] };
}

/** [고치기] 가 연 폼임을 알리는 쿼리 값 (6-1 X-Client-Source 판정) */
export const FROM_ASSISTANT = "assistant";

/**
 * 일정 [고치기] 주소 `/events/new?title&start&end&allDay&participants&place&from=assistant` (D-273).
 * 종일은 폼이 시작, 끝 날짜를 읽게 시작 날 10:00, 마지막 날 11:00 으로 넘긴다 (빠른 추가 "자세히" 와 같은 방식)
 */
export function eventEditHref(d: Pick<EventDraftCard, "title" | "startsAt" | "endsAt" | "allDay" | "participants" | "place" | "lunarInput">): string {
  const first = dateKeyOf(d.startsAt);
  const last = d.allDay ? addDays(dateKeyOf(d.endsAt), -1) : null;
  const q: Record<string, string> = {
    title: d.title,
    start: d.allDay ? kstToIso(first, "10:00") : d.startsAt,
    end: d.allDay ? kstToIso(last && last >= first ? last : first, "11:00") : d.endsAt,
  };
  if (d.allDay) q.allDay = "1";
  if (d.participants.length) q.participants = d.participants.join(",");
  if (d.place?.text.trim()) q.place = d.place.text.trim();
  // (#566) 음력으로 말한 초안은 폼을 음력으로 연다
  if (d.lunarInput) q.lunar = "1";
  q.from = FROM_ASSISTANT;
  return newEventHref(q);
}

/** 빈 시간 한 줄의 "이 시간으로 일정": 시작 = 구간 시작, 끝 = 시작 + 최소 길이(구간 끝을 넘지 않게), 참여자 = 카드 대상 */
export function slotEditHref(slot: { startsAt: string; endsAt: string }, query: FreeQuery, title: string | null): string {
  const end = Math.min(Date.parse(slot.startsAt) + query.minMinutes * 60_000, Date.parse(slot.endsAt));
  return eventEditHref({
    title: title ?? "",
    startsAt: slot.startsAt,
    endsAt: new Date(end).toISOString(),
    allDay: false,
    participants: query.participants,
    place: null,
  });
}

/** 투표 후보는 2~5개 (api.md 2.13) */
export const POLL_MIN = 2;
export const POLL_MAX = 5;

/** "이 N개로 투표 열기" 를 보일지: 팀이고 멤버 2명 이상, 후보 2개 이상 */
export function canPollFrom(slots: readonly unknown[], o: { personal: boolean; memberCount: number }): boolean {
  return !o.personal && o.memberCount >= 2 && slots.length >= POLL_MIN;
}

/** 빈 시간 카드 → 웹이 만드는 투표 초안 카드 (서버 요청 없음, D-273). 제목 = pollTitle ?? "약속", 후보 = 앞 5개를 최소 길이로 */
export function pollDraftFromSlots(card: Extract<AssistantCard, { type: "freeSlots" }>, members: readonly Member[]): Extract<AssistantCard, { type: "pollDraft" }> {
  const options = card.slots.slice(0, POLL_MAX).map((s) => {
    const end = Math.min(Date.parse(s.startsAt) + card.query.minMinutes * 60_000, Date.parse(s.endsAt));
    return { startsAt: s.startsAt, endsAt: new Date(end).toISOString(), allDay: false };
  });
  const ids = new Set(card.query.participants);
  return {
    type: "pollDraft",
    draft: { title: card.pollTitle?.trim() || "약속", options, participants: [...card.query.participants] },
    members: members.filter((m) => m.userId !== null && ids.has(m.userId)),
  };
}

/** 투표 [고치기] 로 여는 시트의 최소 길이: 후보 중 가장 긴 것 (짧은 후보는 시트가 구간 끝에서 자른다) */
export function pollSheetMinutes(options: readonly PollOptionInput[]): number {
  const lens = options.map((o) => Math.round((Date.parse(o.endsAt) - Date.parse(o.startsAt)) / 60_000));
  return Math.max(30, ...lens);
}

/* ---------- X-Client-Source (6-1) ---------- */

export type ClientSource = "assistant" | "assistant-poll" | "assistant-edit" | "assistant-edit-changed";
export const CLIENT_SOURCES: readonly ClientSource[] = ["assistant", "assistant-poll", "assistant-edit", "assistant-edit-changed"];
export const CLIENT_SOURCE_HEADER = "X-Client-Source";

/** 허용 값만 통과 (프록시가 브라우저 헤더를 API 로 넘길 때) */
export function clientSourceOf(raw: string | null | undefined): ClientSource | null {
  return raw && (CLIENT_SOURCES as readonly string[]).includes(raw) ? (raw as ClientSource) : null;
}

/** [고치기]로 연 폼의 저장: 처음 연 값에서 날짜, 시각, 종일을 바꿨으면 assistant-edit-changed */
export function editSource(
  initial: { allDay: boolean; startDate: string; startTime: string; endDate: string; endTime: string },
  current: { allDay: boolean; startDate: string; startTime: string; endDate: string; endTime: string },
): ClientSource {
  const keys = ["allDay", "startDate", "startTime", "endDate", "endTime"] as const;
  return keys.some((k) => initial[k] !== current[k]) ? "assistant-edit-changed" : "assistant-edit";
}

/* ---------- 새 일정 폼이 읽는 쿼리 (D-273) ---------- */

/** `participants=3,5` → [3, 5]. 숫자가 아닌 조각은 버리고, 남는 게 없으면 null(폼 기본 [나]) */
export function participantsParam(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  const ids = [...new Set(raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  return ids.length ? ids : null;
}

/* ---------- 카드 글자 ---------- */

/** (#566) 음력으로 말한 초안의 둘째 줄 "음력 3월 15일" (시작 날짜의 음력). 아니면 null */
export function draftLunarText(d: Pick<EventDraftCard, "startsAt" | "lunarInput">): string | null {
  return d.lunarInput ? lunarLabelOf(dateKeyOf(d.startsAt)) : null;
}

/** 일정 초안 날짜 시각 한 줄: "11월 27일 (금) 오후 7:00 ~ 8:00", 종일 "11월 27일 (금) 하루 종일", 여러 날 종일 "11월 27일 (금) ~ 11월 29일 (일)" */
export function draftWhenText(d: Pick<EventDraftCard, "startsAt" | "endsAt" | "allDay">): string {
  const first = dateKeyOf(d.startsAt);
  if (d.allDay) {
    const last = addDays(dateKeyOf(d.endsAt), -1);
    return last > first ? `${formatDateKo(first)} ~ ${formatDateKo(last)}` : `${formatDateKo(first)} 하루 종일`;
  }
  const lastKey = dateKeyOf(Date.parse(d.endsAt) - 1);
  if (lastKey !== first) return `${formatDateKo(first)} ${clockText(d.startsAt)} ~ ${formatDateKo(lastKey)} ${clockText(d.endsAt)}`;
  return `${formatDateKo(first)} ${clockRangeText(d.startsAt, d.endsAt)}`;
}

/** 빈 시간, 투표 후보 한 줄의 시각 "오후 6:00 ~ 10:00" */
export function slotTimeText(s: { startsAt: string; endsAt: string }): string {
  return clockRangeText(s.startsAt, s.endsAt);
}

/** 빈 시간 조건 한 줄: "주말 저녁, 2시간 이상, 3명" */
export function freeQueryText(q: FreeQuery): string {
  const days = q.days === "weekend" ? "주말" : q.days === "weekday" ? "평일" : "";
  const band = bandText(q.dayStart, q.dayEnd);
  const head = [days, band].filter(Boolean).join(" ") || "모든 날";
  const who = q.participants.length <= 1 ? "나" : `${q.participants.length}명`;
  return `${head}, ${formatMinutes(q.minMinutes)} 이상, ${who}`;
}

function bandText(start: string, end: string): string {
  if (start === "18:00" && end === "22:00") return "저녁";
  if (start === "11:00" && end === "14:00") return "점심";
  if (start === "09:00" && end === "12:00") return "오전";
  if (start === "13:00" && end === "18:00") return "오후";
  if (start === "09:00" && end === "23:00") return "";
  return `${start}~${end}`;
}

/** 기념일 줄의 D-n: 0 → "오늘", 앞이면 "D-12" */
export function ddayText(dday: number): string {
  return dday === 0 ? "오늘" : `D-${dday}`;
}

/** 첫 화면 예시 3개 (누르면 바로 보낸다). 두 번째는 팀 크기에 맞춘다: 둘 "둘 다", 셋 이상 "다 같이", 개인 팀 "내 빈 시간" */
export function examplePrompts(o: { personal: boolean; memberCount: number }): string[] {
  const free = o.personal
    ? "이번 주 내 빈 시간 찾아줘"
    : o.memberCount === 2
      ? "이번 달 주말에 둘 다 되는 저녁 찾아줘"
      : "이번 달 주말에 다 같이 되는 저녁 찾아줘";
  return ["다음 주 금요일 7시 강남 회식 잡아줘", free, "이번 주에 뭐 있어?"];
}

/** 하루 한도에 걸렸는지. resetAt(다음 KST 자정)이 지나면 풀린다 */
export function dailyLimited(o: { used: number; limit: number; resetAt: string | null }, now = Date.now()): boolean {
  if (o.resetAt) return Date.parse(o.resetAt) > now;
  return o.limit > 0 && o.used >= o.limit;
}

/** 다음 KST 자정 (서버가 resetAt 을 안 줬을 때) */
export function nextKstMidnight(now = Date.now()): string {
  return kstToIso(addDays(dateKeyOf(now), 1));
}

/** 일정 목록 카드의 일정 → 공통 일정 줄(EventRow)이 받는 모양. 반복, 색, 장소는 카드에 없어 비운다 */
export function rowEventOf(e: AssistantEvent, groupId: number): Event {
  const creator: Member = e.members[0] ?? { userId: null, displayName: "", color: "", profileImageUrl: null };
  return {
    id: e.id,
    groupId,
    publicCode: e.publicCode,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    occurrence: e.occurrence,
    creator,
    createdAt: e.startsAt,
    updatedAt: e.startsAt,
    repeat: null,
    repeatUntil: null,
    seriesStartsAt: null,
    repeatAnchor: null,
    participants: { all: false, members: e.members },
  };
}

/**
 * (#470) 넓은 화면 패널에서 달력을 움직인다. event 없이 부르면 그날을 고르기만 하고([추가] 직후),
 * event 를 주면 그 일정 상세를 연다("달력에서 보기")
 */
export type ShowDate = (date: string, event?: { publicCode: string }) => void;
