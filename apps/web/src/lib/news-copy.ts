// 새 소식 문구 (#187, 설계 4-3, 기획 3-6). React 를 import 하지 않는다 (단위 테스트 대상)
// 화면은 "{이름}님이 '{제목}' " 뒤에 newsPhrase 를 붙인다
import { KIND_OPTIONS } from "./anniversary";
import { dateKeyOf, formatDateKo, parseKey, type DateKey } from "./date";
import { REPEAT_NAME } from "./recurrence";
import { euroJosa, hasBatchim } from "./text";
import type { ActivityNewsItem, ActivityType, AnniversaryField, NewsEntry, NewsItem } from "./types";

type Item = Pick<NewsItem, "action" | "repeat" | "scope" | "occurrence" | "eventId">;

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
 * 누르면 갈 주소. 일정이 없거나 삭제 기록이면 null (지금 규칙).
 * "이 일정만" 은 그 회차로(occurrence 는 원래 날짜라 옮긴 회차도 찾는다).
 * "이후 모두" 는 그 회차가 (새) 원본의 첫 회차가 되므로 occurrence 없이 연다. 시작 날짜를 옮겼으면
 * 원래 날짜가 새 규칙의 회차가 아니라 occurrence 를 붙이면 404 가 난다
 */
export function newsHref(groupId: number, item: Item): string | null {
  if (!item.eventId || item.action === "DELETED") return null;
  const base = `/g/${groupId}/events/${item.eventId}`;
  return item.scope === "THIS" && item.occurrence ? `${base}?occurrence=${item.occurrence}` : base;
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
];

export const isActivity = (item: NewsEntry): item is ActivityNewsItem => item.kind === "ACTIVITY";

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
      return "팀에 들어왔어요";
    case "MEMBER_LEFT":
      return "팀을 나갔어요";
    case "MEMBER_DELETED":
      return "서비스를 떠났어요";
    case "GROUP_RENAMED":
      return `팀 이름을 ${quoted(p.from ?? "")}에서 ${withEuro(p.to ?? "")} 바꿨어요`;
    case "EVENTS_IMPORTED":
      return `일정 ${(p.count ?? 0).toLocaleString("en-US")}개를 가져왔어요`;
  }
}

/** 누르면 갈 곳. 기념일 추가, 수정은 기념일 화면, 합류와 팀 이름 변경은 팀 설정. 삭제, 나가기, 탈퇴는 없음 */
export function activityHref(groupId: number, item: Pick<ActivityNewsItem, "type">): string | null {
  switch (item.type) {
    case "ANNIVERSARY_CREATED":
    case "ANNIVERSARY_UPDATED":
      return `/g/${groupId}/anniversaries`;
    case "MEMBER_JOINED":
    case "GROUP_RENAMED":
      return `/g/${groupId}/settings`;
    case "EVENTS_IMPORTED":
      return `/g/${groupId}/calendar`;
    default:
      return null;
  }
}

/** 둘째 줄. 기념일은 "11월 22일, 함께한 날 세기" (올해가 아니면 연도), 그 밖은 null */
export function activitySubline(item: Pick<ActivityNewsItem, "type" | "payload">, today: DateKey): string | null {
  if (!item.type.startsWith("ANNIVERSARY_") || !item.payload?.date) return null;
  const { y, m, d } = parseKey(item.payload.date);
  const day = y === parseKey(today).y ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
  const kind = KIND_OPTIONS.find((option) => option.value === (item.payload.kind ?? "COUNT_UP"));
  return kind ? `${day}, ${kind.label}` : day;
}
