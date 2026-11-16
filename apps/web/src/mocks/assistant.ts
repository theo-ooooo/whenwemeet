// (#450) API_MOCK=1 AI 비서 "볼까" (설계 AI-비서.md 7-10, api.md 2.15). 모델 대신 키워드 규칙으로 늘 같은 답을 만든다.
// 서버 문구 틀(4-3, 4-4)과 카드 모양, 오류 코드, 하루 횟수(30번, KST 날짜)를 실제 API 와 같게 둔다. 화면 확인과 단위 시험용.
//   "한도" → 429 하루 한도, "느려" → 504, "장애" → 503 (둘은 횟수를 되돌린다)
//   "고쳐", "바꿔", "수정" → 못 하는 일(고치기), "지워", "삭제" → 못 하는 일(지우기)
//   "빈 시간", "되는", "비는" → 빈 시간(+ "투표" 면 투표 초안), "생일", "기념일" → 기념일 목록, "뭐 있", "일정 알려" → 일정 목록
//   "잡아", "넣어", "추가", "만들어" → 일정 초안, "회의" → 시각 되묻기, "누구" → 이름 고르기, "안녕", "고마" → 인사, 그 밖 → 거절
// 데이터는 목 API 자신(일정, 빈 시간, 팀, 생일, 기념일 경로)을 다시 불러 만든다 (call)
import { addDays, dateKeyOf, daysBetween, dowOf, kstToIso, parseKey, startOfWeek, todayKey, type DateKey } from "@/lib/date";
import { errorBody, okBody } from "@/lib/envelope";
import type { AssistantCard, AssistantDay, AssistantEvent, AssistantReply, FreeQuery } from "@/lib/assistant";
import type { Event, GroupDetail, Member } from "@/lib/types";
import type { Store } from "./fixtures";

type Result = { status: number; body: unknown };
/** 목 API 를 안에서 다시 부른다. 성공이면 data, 아니면 null */
export type MockCall = <T>(method: string, path: string, query?: Record<string, string>) => T | null;

export const MOCK_ASSISTANT_LIMIT = 30;
const TEXT_MAX = 300;

const ok = (data: unknown): Result => ({ status: 200, body: okBody(data) });
const err = (status: number, code: string, message: string, field?: string): Result => ({
  status,
  body: errorBody(status, code, message, field ? [{ field, message }] : undefined),
});

function state(s: Store) {
  return (s.assistant ??= { consent: {}, usage: {} });
}

function usedToday(s: Store, userId: number): number {
  const u = state(s).usage[userId];
  return u && u.day === todayKey() ? u.count : 0;
}

/** GET /me 의 assistant. MOCK_ASSISTANT_OFF=1 이면 키 없는 서버처럼 available false (버튼 숨김 확인용) */
export function mockAssistantMeta(s: Store, userId: number) {
  return {
    available: process.env.MOCK_ASSISTANT_OFF !== "1",
    consented: Boolean(state(s).consent[userId]),
    dailyLimit: MOCK_ASSISTANT_LIMIT,
    usedToday: usedToday(s, userId),
  };
}

/** POST /me/assistant-consent (멱등: 이미 했으면 처음 값) */
export function mockAssistantConsent(s: Store, userId: number): Result {
  const st = state(s);
  st.consent[userId] ??= new Date().toISOString();
  return ok({ consentedAt: st.consent[userId] });
}

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/** POST /groups/:id/assistant/messages */
export function mockAssistantMessage(s: Store, groupId: number, userId: number, body: Record<string, unknown> | null, call: MockCall): Result {
  if (process.env.MOCK_ASSISTANT_OFF === "1") return err(503, "ASSISTANT_UNAVAILABLE", "지금은 볼까를 쓸 수 없어요. 잠시 후 다시 해 주세요");
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return err(400, "VALIDATION_FAILED", "보낼 글을 적어 주세요", "text");
  if ([...text].length > TEXT_MAX) return err(400, "VALIDATION_FAILED", "300자까지 보낼 수 있어요", "text");
  const history = body?.history;
  if (history !== undefined && (!Array.isArray(history) || history.length > 10)) return err(400, "VALIDATION_FAILED", "대화 기록 형식이 맞지 않아요", "history");
  const st = state(s);
  if (!st.consent[userId]) return err(409, "ASSISTANT_CONSENT_REQUIRED", "먼저 안내를 확인해 주세요");

  const today = todayKey();
  const limitMsg = "오늘은 볼까를 30번 다 썼어요. 내일 다시 불러 주세요";
  if (has(text, "한도") || usedToday(s, userId) >= MOCK_ASSISTANT_LIMIT) return err(429, "ASSISTANT_DAILY_LIMIT", limitMsg);
  const count = usedToday(s, userId) + 1;
  st.usage[userId] = { day: today, count };
  const rollback = () => (st.usage[userId] = { day: today, count: count - 1 });
  if (has(text, "느려")) {
    rollback();
    return err(504, "ASSISTANT_TIMEOUT", "답이 늦어지고 있어요. 다시 보내 주세요");
  }
  if (has(text, "장애")) {
    rollback();
    return err(503, "ASSISTANT_UNAVAILABLE", "지금은 볼까를 쓸 수 없어요. 잠시 후 다시 해 주세요");
  }

  const group = call<GroupDetail>("GET", `/groups/${groupId}`);
  const members = group?.members ?? [];
  const personal = group?.type === "PERSONAL";
  const reply = (r: string, cards: AssistantCard[], historyText: string): Result =>
    ok({ reply: r, cards, historyText: historyText.slice(0, 600), usage: { used: count, limit: MOCK_ASSISTANT_LIMIT } } satisfies AssistantReply);

  if (has(text, "지워", "삭제")) {
    return reply("일정 지우기는 아직 못 해요. 일정을 눌러 지울 수 있어요", [{ type: "unsupported", action: "delete_event", link: { label: "달력 열기", href: "/calendar" } }], "[안내] 일정 지우기는 못 함");
  }
  if (has(text, "고쳐", "바꿔", "수정")) {
    return reply("일정 고치기는 아직 못 해요. 일정을 눌러 고칠 수 있어요", [{ type: "unsupported", action: "edit_event", link: { label: "달력 열기", href: "/calendar" } }], "[안내] 일정 고치기는 못 함");
  }
  if (has(text, "빈 시간", "되는", "비는")) return freeReply(text, today, groupId, members, personal, call, reply);
  if (has(text, "생일", "기념일")) return daysReply(today, groupId, call, reply);
  if (has(text, "뭐 있", "일정 알려", "무슨 일정")) return listReply(text, today, groupId, call, reply);
  if (has(text, "잡아", "넣어", "추가", "만들어")) return draftReply(text, today, userId, members, reply);
  if (has(text, "회의")) return reply("몇 시로 할까요?", [{ type: "clarify", field: "time", choices: [] }], "[되물음] 몇 시로 할까요?");
  if (has(text, "누구")) {
    return reply("'민'님이 누구인가요?", [{ type: "clarify", field: "participant", choices: members.filter((m) => m.userId !== userId) }], "[되물음] 누구인지");
  }
  if (has(text, "안녕", "고마")) return reply("무엇을 도와 드릴까요? 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기를 할 수 있어요", [], "[인사]");
  return reply("볼까는 일정 만들기, 빈 시간 찾기, 투표, 일정 묻기만 도와 드려요", [{ type: "refusal" }], "[거절]");
}

type Reply = (r: string, cards: AssistantCard[], historyText: string) => Result;

const md = (key: DateKey) => {
  const { m, d } = parseKey(key);
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });

function draftReply(text: string, today: DateKey, userId: number, members: Member[], reply: Reply): Result {
  // 날짜: "다음 주 금요일" 은 다음 주(일요일 시작)의 금요일, 그 밖은 내일
  const date = has(text, "다음 주 금요일") ? addDays(startOfWeek(today), 12) : addDays(today, 1);
  const hourMatch = /(\d{1,2})\s*시/.exec(text);
  let hour = hourMatch ? Number(hourMatch[1]) : 19;
  if (hour <= 6 || (hour <= 11 && has(text, "회식", "저녁", "술", "약속"))) hour += 12;
  const place = /(강남|홍대|성수|잠실|판교)/.exec(text)?.[1] ?? null;
  const what = has(text, "회식") ? "회식" : has(text, "점심", "밥") ? "점심" : "약속";
  const title = place ? `${place} ${what}` : what;
  const all = has(text, "다 같이", "모두", "우리");
  const named = members.filter((m) => m.userId !== null && m.userId !== userId && text.includes(m.displayName));
  const picked = all ? members : members.filter((m) => m.userId === userId || named.includes(m));
  const startsAt = kstToIso(date, `${String(hour).padStart(2, "0")}:00`);
  const endsAt = new Date(Date.parse(startsAt) + 3_600_000).toISOString();
  const ids = picked.flatMap((m) => (m.userId === null ? [] : [m.userId]));
  return reply(
    "이렇게 넣을까요?",
    [{ type: "eventDraft", draft: { title, startsAt, endsAt, allDay: false, place: place ? { text: place } : null, participants: ids, members: picked } }],
    `[일정 초안] ${title}, ${date} ${hm(startsAt)}~${hm(endsAt)}${place ? `, 장소 ${place}` : ""}, 참여자 ${picked.map((m) => m.displayName).join(", ")}`,
  );
}

function freeReply(text: string, today: DateKey, groupId: number, members: Member[], personal: boolean, call: MockCall, reply: Reply): Result {
  const thisWeek = has(text, "이번 주");
  const from = today;
  const to = thisWeek ? addDays(startOfWeek(today), 7) : addDays(today, 30);
  const evening = has(text, "저녁");
  const days: FreeQuery["days"] = has(text, "주말") ? "weekend" : has(text, "평일") ? "weekday" : "all";
  const ids = members.flatMap((m) => (m.userId === null ? [] : [m.userId]));
  const query: FreeQuery = {
    from: kstToIso(from),
    to: kstToIso(to),
    dayStart: evening ? "18:00" : "09:00",
    dayEnd: evening ? "22:00" : "23:00",
    minMinutes: 120,
    days,
    participants: ids,
  };
  const r = call<{ slots: { startsAt: string; endsAt: string }[] }>("GET", `/groups/${groupId}/free-slots`, {
    from: query.from,
    to: query.to,
    dayStart: query.dayStart,
    dayEnd: query.dayEnd,
    minMinutes: String(query.minMinutes),
  });
  const all = (r?.slots ?? []).filter((sl) => {
    const dow = dowOf(dateKeyOf(sl.startsAt));
    const weekend = dow === 0 || dow === 6;
    return days === "all" || (days === "weekend" ? weekend : !weekend);
  });
  const slots = all.slice(0, 3);
  if (slots.length === 0) return reply("그 조건으로는 다 같이 비는 시간이 없어요. 기간이나 시간대를 넓혀 볼까요?", [], "[빈 시간] 없음");
  const pollTitle = evening ? "저녁 약속" : "약속";
  const card: AssistantCard = { type: "freeSlots", query, slots, total: all.length, pollTitle };
  const lines = `[빈 시간] ${slots.map((sl) => `${md(dateKeyOf(sl.startsAt))} ${hm(sl.startsAt)}~${hm(sl.endsAt)}`).join("; ")}`;
  if (has(text, "투표") && !personal && slots.length >= 2) {
    const options = slots.map((sl) => ({
      startsAt: sl.startsAt,
      endsAt: new Date(Math.min(Date.parse(sl.startsAt) + query.minMinutes * 60_000, Date.parse(sl.endsAt))).toISOString(),
      allDay: false as const,
    }));
    return reply(
      `${slots.length}개로 투표를 열까요?`,
      [card, { type: "pollDraft", draft: { title: pollTitle, options, participants: ids }, members }],
      `${lines}\n[투표 초안] 제목 ${pollTitle}, 후보 ${slots.length}개`,
    );
  }
  return reply(`${all.length}개 찾았어요. 가까운 순으로 ${slots.length}개예요`, [card], lines);
}

function listReply(text: string, today: DateKey, groupId: number, call: MockCall, reply: Reply): Result {
  const next = has(text, "다음 주");
  const from = addDays(startOfWeek(today), next ? 7 : 0);
  const to = addDays(from, 7);
  const label = next ? "다음 주" : "이번 주";
  const evs = call<Event[]>("GET", `/groups/${groupId}/events`, { from: kstToIso(from), to: kstToIso(to) }) ?? [];
  const sorted = [...evs].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const events: AssistantEvent[] = sorted.slice(0, 10).map((e) => ({
    id: e.id,
    publicCode: e.publicCode,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    occurrence: e.occurrence,
    members: e.participants?.members ?? [e.creator],
  }));
  const card: AssistantCard = { type: "eventList", from: kstToIso(from), to: kstToIso(to), events, more: Math.max(0, sorted.length - 10), days: [] };
  if (sorted.length === 0) return reply(`${label}에는 일정이 없어요`, [card], `[일정 목록 ${md(from)}~${md(addDays(to, -1))}] 없음`);
  return reply(
    `${label}에 일정이 ${sorted.length}개 있어요`,
    [card],
    `[일정 목록 ${md(from)}~${md(addDays(to, -1))}] ${events.map((e) => `${md(dateKeyOf(e.startsAt))} ${e.allDay ? "종일" : hm(e.startsAt)} ${e.title}`).join("; ")}`,
  );
}

/** 'MM-DD' 의 오늘부터 다음 날짜 (2월 29일은 평년이면 2월 28일) */
function nextYearly(mmdd: string, today: DateKey): DateKey {
  const y = parseKey(today).y;
  const at = (year: number) => {
    const [m, d] = mmdd.split("-").map(Number);
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const day = m === 2 && d === 29 && !leap ? 28 : d;
    return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
  return at(y) >= today ? at(y) : at(y + 1);
}

function daysReply(today: DateKey, groupId: number, call: MockCall, reply: Reply): Result {
  const birthdays = call<{ member: Member; date: string }[]>("GET", `/groups/${groupId}/birthdays`) ?? [];
  const anniversaries = call<{ name: string; date: string; kind: string }[]>("GET", `/groups/${groupId}/anniversaries`) ?? [];
  const days: AssistantDay[] = [
    ...birthdays.map((b) => ({ name: `${b.member.displayName} 생일`, date: nextYearly(b.date, today), kind: "BIRTHDAY" as const })),
    ...anniversaries
      .filter((a) => a.kind !== "ONCE" || a.date >= today)
      .map((a) => ({ name: a.name, date: a.kind === "ONCE" ? a.date : nextYearly(a.date.slice(5), today), kind: "ANNIVERSARY" as const })),
  ]
    .map((d) => ({ ...d, dday: daysBetween(today, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  if (days.length === 0) return reply("찾는 기념일이 없어요", [], "[기념일] 없음");
  const card: AssistantCard = { type: "eventList", from: kstToIso(today), to: kstToIso(addDays(today, 365)), events: [], more: 0, days };
  const text =
    days.length === 1
      ? `'${days[0].name}'은 ${Number(days[0].date.slice(5, 7))}월 ${Number(days[0].date.slice(8))}일이에요. ${days[0].dday === 0 ? "오늘이에요" : `D-${days[0].dday}`}`
      : `${days.length}개 찾았어요`;
  return reply(text, [card], `[기념일] ${days.map((d) => `${d.name} ${d.date}`).join("; ")}`);
}
