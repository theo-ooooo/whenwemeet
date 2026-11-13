// 새 소식 문구 (#187, 설계 4-3, 기획 3-6). React 를 import 하지 않는다 (단위 테스트 대상)
// 화면은 "{이름}님이 '{제목}' " 뒤에 newsPhrase 를 붙인다
import { KIND_OPTIONS } from "./anniversary";
import { addDays, dateKeyOf, formatDateKo, formatEventTime, parseKey, startOfWeek, type DateKey } from "./date";
import { REPEAT_NAME } from "./recurrence";
import { pollActivityPhrase, pollActivitySubline } from "./poll";
import { ANNIVERSARIES_PATH, CALENDAR_PATH, eventEditHref, eventHref, pollHref, TEAM_PATH } from "./routes";
import { RSVP_LABEL } from "./rsvp";
import { euroJosa, hasBatchim } from "./text";
import type { ActivityNewsItem, ActivityType, AnniversaryField, NewsEntry, NewsItem } from "./types";

type Item = Pick<NewsItem, "action" | "repeat" | "scope" | "occurrence" | "eventCode">;

const md = (key: string) => {
  const { m, d } = parseKey(key);
  return `${m}월 ${d}일`;
};

/** 제목 뒤 문구. 반복이 아닌 일정(또는 범위 정보가 없는 기록)은 예전 그대로 "일정을 추가했어요" 형태 */
export function newsPhrase(item: Item): string {
  const { action, repeat, scope, occurrence } = item;
  if (action === "CREATED") return repeat && !scope ? `${REPEAT_NAME[repeat]} 반복 일정을 추가했어요` : "일정을 추가했어요";
  if (scope && occurrence) {
    const day = md(occurrence);
    if (action === "UPDATED") return scope === "THIS" ? `${day} 일정만 수정했어요` : `${day}부터 반복 일정을 수정했어요`;
    return scope === "THIS" ? `${day} 일정을 삭제했어요` : `${day}부터 반복을 삭제했어요`;
  }
  return action === "UPDATED" ? "일정을 수정했어요" : "일정을 삭제했어요";
}

/**
 * 누르면 갈 주소 (일정 수정 화면 `/events/<코드>/edit`, #311). 일정이 없거나 삭제 기록이면 null (지금 규칙).
 * "이 일정만" 은 그 회차로(occurrence 는 원래 날짜라 옮긴 회차도 찾는다).
 * "이후 모두" 는 그 회차가 (새) 원본의 첫 회차가 되므로 occurrence 없이 연다. 시작 날짜를 옮겼으면
 * 원래 날짜가 새 규칙의 회차가 아니라 occurrence 를 붙이면 404 가 난다
 */
export function newsHref(item: Item): string | null {
  if (!item.eventCode || item.action === "DELETED") return null;
  return eventEditHref({ publicCode: item.eventCode, occurrence: item.scope === "THIS" && item.occurrence ? item.occurrence : null });
}

/** 시각 줄 앞 날짜 "2월 29일 (목)". 올해(KST) 가 아닌 회차는 연도를 붙인다 ("2024년 2월 29일 (목)", QA3-L6) */
export function newsDateLabel(startsAt: string, today: DateKey): string {
  const key = dateKeyOf(startsAt);
  return formatDateKo(key, parseKey(key).y !== parseKey(today).y);
}

// ── 팀 활동 기록 (#191, api.md 2.6). 화면은 "{이름}님이 " 뒤에 activityPhrase 를 붙인다 ──

const ACTIVITY_TYPES: readonly ActivityType[] = [
  "ANNIVERSARY_CREATED",
  "ANNIVERSARY_UPDATED",
  "ANNIVERSARY_DELETED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "MEMBER_DELETED",
  "GROUP_RENAMED",
  "EVENTS_IMPORTED",
  "EVENT_RSVP",
  "POLL_CREATED",
  "POLL_CLOSED",
];

export const isActivity = (item: NewsEntry): item is ActivityNewsItem => item.kind === "ACTIVITY";

/** (#378) 새 소식 묶음. 오늘, 어제, 이번 주(월요일부터), 그 전 */
export type NewsDay = "오늘" | "어제" | "이번 주" | "이전";

/** (#378) 기록 시각(KST 날짜)으로 묶음을 고른다. 어제가 지난주여도 "어제" */
export function newsDayOf(createdAt: string, today: DateKey): NewsDay {
  const key = dateKeyOf(createdAt);
  if (key >= today) return "오늘";
  if (key === addDays(today, -1)) return "어제";
  if (key >= startOfWeek(today)) return "이번 주";
  return "이전";
}

/** (#378) 받은 순서(최근 먼저)를 지키며 묶음으로 나눈다. 빈 묶음은 없다 */
export function groupNewsByDay<T extends { createdAt: string }>(items: readonly T[], today: DateKey): { day: NewsDay; items: T[] }[] {
  const out: { day: NewsDay; items: T[] }[] = [];
  for (const item of items) {
    const day = newsDayOf(item.createdAt, today);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}

/** (#378) 줄 왼쪽 종류 아이콘. 일정 기록과 가져오기는 일정, 기념일, 팀(멤버, 이름), 투표, 참석 */
export type NewsKind = "event" | "anniversary" | "team" | "poll" | "rsvp";
export function newsKindOf(item: NewsEntry): NewsKind {
  if (!isActivity(item) || item.type === "EVENTS_IMPORTED") return "event";
  if (item.type.startsWith("ANNIVERSARY_")) return "anniversary";
  if (item.type.startsWith("POLL_")) return "poll";
  if (item.type === "EVENT_RSVP") return "rsvp";
  return "team";
}

/** 목록 키. 일정 기록과 활동 기록의 id 가 겹칠 수 있어 종류를 붙인다 */
export const newsKey = (item: NewsEntry): string => `${item.kind ?? "EVENT"}:${item.id}`;

/**
 * 그릴 줄만 남긴다. kind 가 없거나 EVENT 면 일정 줄, ACTIVITY 는 아는 종류만.
 * 뒤에 생길 종류(#190 참석 여부, #189 투표 등)나 모르는 kind 는 이 웹에서 건너뛴다
 */
export function knownNewsItems(items: readonly NewsEntry[]): NewsEntry[] {
  return items.filter((item) => {
    const kind = (item as { kind?: string }).kind;
    if (kind === undefined || kind === "EVENT") return true;
    return kind === "ACTIVITY" && ACTIVITY_TYPES.includes((item as ActivityNewsItem).type);
  });
}

const quoted = (name: string) => `'${name}'`;
const withEulReul = (name: string) => `${quoted(name)}${hasBatchim(name) ? "을" : "를"}`;
const withEuro = (name: string) => `${quoted(name)}${euroJosa(name)}`;

const FIELD_NAME: Record<AnniversaryField, string> = { name: "이름", date: "날짜", kind: "종류" };

/** "{이름}님이" 뒤 문장 */
export function activityPhrase(item: Pick<ActivityNewsItem, "type" | "payload">): string {
  const p = item.payload ?? {};
  const name = p.name ?? "";
  switch (item.type) {
    case "ANNIVERSARY_CREATED":
      return `기념일 ${withEulReul(name)} 추가했어요`;
    case "ANNIVERSARY_DELETED":
      return `기념일 ${withEulReul(name)} 삭제했어요`;
    case "ANNIVERSARY_UPDATED": {
      const changed = p.changed ?? [];
      if (changed.length !== 1) return `기념일 ${withEulReul(name)} 수정했어요`;
      const [field] = changed;
      if (field === "name") return `기념일 ${quoted(p.before?.name ?? name)}의 이름을 ${withEuro(name)} 바꿨어요`;
      return `기념일 ${quoted(name)}의 ${FIELD_NAME[field]}를 바꿨어요`;
    }
    case "MEMBER_JOINED":
      // (#274) 일정 링크로 들어오면 경로를 붙인다 (D-185)
      return p.via === "EVENT_SHARE" ? "일정 링크로 팀에 들어왔어요" : "팀에 들어왔어요";
    case "MEMBER_LEFT":
      return "팀을 나갔어요";
    case "MEMBER_DELETED":
      return "서비스를 떠났어요";
    case "GROUP_RENAMED":
      return `팀 이름을 ${quoted(p.from ?? "")}에서 ${withEuro(p.to ?? "")} 바꿨어요`;
    case "EVENTS_IMPORTED":
      return `일정 ${(p.count ?? 0).toLocaleString("en-US")}개를 가져왔어요`;
    case "EVENT_RSVP":
      // (#190) "{이름}님이 '저녁 약속'에 참석으로 답했어요"
      return `${quoted(p.title ?? "")}에 ${p.status ? RSVP_LABEL[p.status] : "응답"}으로 답했어요`;
    // (#189) 투표를 열었다 / 시간을 정했다. 정해서 생긴 일정 추가 줄은 서버가 숨긴다 (D-236)
    case "POLL_CREATED":
    case "POLL_CLOSED":
      return pollActivityPhrase(item.type, p);
  }
}

/**
 * 누르면 갈 곳. 기념일 추가, 수정은 기념일 화면, 합류와 팀 이름 변경은 팀 설정. 삭제, 나가기, 탈퇴는 없음.
 * (#189) 투표 열림은 투표 화면, 정함은 그 일정 (닫힌 투표는 새 소식에서만 연다)
 */
export function activityHref(item: Pick<ActivityNewsItem, "type"> & { payload?: ActivityNewsItem["payload"] }): string | null {
  const p = item.payload ?? {};
  switch (item.type) {
    case "ANNIVERSARY_CREATED":
    case "ANNIVERSARY_UPDATED":
      return ANNIVERSARIES_PATH;
    case "MEMBER_JOINED":
    case "GROUP_RENAMED":
      return TEAM_PATH;
    case "EVENTS_IMPORTED":
      return CALENDAR_PATH;
    case "EVENT_RSVP":
      // (#190) 그 일정(회차) 상세. 지워진 일정이면 상세가 "찾을 수 없어요" 를 보여 준다
      return p.eventCode ? eventHref({ publicCode: p.eventCode, occurrence: p.occurrence ?? null }) : null;
    case "POLL_CREATED":
      return p.code ? pollHref({ publicCode: p.code }) : null;
    case "POLL_CLOSED":
      return p.eventCode ? eventHref({ publicCode: p.eventCode }) : p.code ? pollHref({ publicCode: p.code }) : null;
    default:
      return null;
  }
}

/** 둘째 줄. 기념일은 "11월 22일, 함께한 날 세기" (올해가 아니면 연도), 그 밖은 null */
export function activitySubline(item: Pick<ActivityNewsItem, "type" | "payload">, today: DateKey): string | null {
  // (#190) 참석 여부는 일정 줄과 같은 날짜 시각
  if (item.type === "EVENT_RSVP") {
    const p = item.payload;
    return p?.startsAt && p.endsAt ? `${newsDateLabel(p.startsAt, today)} ${formatEventTime(p.startsAt, p.endsAt, p.allDay ?? false)}` : null;
  }
  // (#189) 정한 투표는 정한 시간
  if (item.type === "POLL_CLOSED") return pollActivitySubline(item.payload ?? {}, today);
  if (!item.type.startsWith("ANNIVERSARY_") || !item.payload?.date) return null;
  const { y, m, d } = parseKey(item.payload.date);
  const day = y === parseKey(today).y ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
  const kind = KIND_OPTIONS.find((option) => option.value === (item.payload.kind ?? "COUNT_UP"));
  return kind ? `${day}, ${kind.label}` : day;
}
