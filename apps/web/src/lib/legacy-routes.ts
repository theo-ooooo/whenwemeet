// (#311) 옛 주소 `/g/<팀 번호>/...` → 새 주소 (D-197). React 를 import 하지 않는다 (단위 테스트 대상).
// 앱 1.1.x 의 알림, 지난 알림, 공유된 링크가 계속 열리게 `app/g/[groupId]/[[...rest]]/page.tsx` 가 멤버십을 확인한 뒤 308 로 보낸다.
// 팀은 `?team=<팀 공개 코드>` 로 넘기고(AppShell 이 쿠키를 바꾼다), 일정 번호는 페이지가 공개 코드로 바꿔 넣는다
import { withTeam } from "./routes";

/** 번호를 공개 코드로 바꿔야 하는 일정 자리 */
export type LegacyEventRef =
  | { as: "detail"; eventId: number; occurrence: string | null }
  | { as: "edit"; eventId: number }
  | { as: "copy"; eventId: number };

export type LegacyRoute = {
  /** 새 경로 (쿼리 제외). 일정 상세/수정은 코드를 알아야 해서 페이지가 `eventRef` 로 채운다 */
  path: string;
  /** 그대로 넘기는 쿼리 (team 은 페이지가 붙인다) */
  query: URLSearchParams;
  /** 일정 번호 → 공개 코드 조회가 필요한 자리. 없으면 null */
  eventRef: LegacyEventRef | null;
};

const ID = /^[1-9]\d{0,15}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const pick = (from: URLSearchParams, keys: readonly string[]): URLSearchParams => {
  const q = new URLSearchParams();
  for (const key of keys) {
    const v = from.get(key);
    if (v) q.set(key, v);
  }
  return q;
};

/**
 * `/g/<id>/<rest...>?<search>` 의 rest 와 쿼리 → 새 주소 조각. 모르는 하위 경로는 null (404).
 * - (없음), calendar: `/calendar` + date, month, day, add. `event=<번호>` 가 있으면 `/events/<코드>` 로 (코드는 페이지가)
 * - upcoming, free, anniversaries, news: 같은 이름
 * - settings: `/team` (+ invite), import: `/team/import`
 * - events/new: `/events/new` + start, end, title, allDay, reminder, occurrence. copy=<번호> 는 코드로
 * - events/<번호>: `/events/<코드>/edit` + occurrence, scope
 */
export function legacyRoute(rest: readonly string[], search: URLSearchParams): LegacyRoute | null {
  const [first, second, ...more] = rest;
  if (more.length > 0) return null;
  if (first === undefined || first === "calendar") {
    if (second !== undefined) return null;
    const event = search.get("event");
    const occurrence = search.get("occurrence");
    if (event && ID.test(event) && search.get("day") === "1") {
      return {
        path: "",
        query: new URLSearchParams(),
        eventRef: { as: "detail", eventId: Number(event), occurrence: occurrence && DATE.test(occurrence) ? occurrence : null },
      };
    }
    return { path: "/calendar", query: pick(search, ["date", "month", "day", "add"]), eventRef: null };
  }
  if (second !== undefined && first !== "events") return null;
  switch (first) {
    case "upcoming":
    case "free":
    case "anniversaries":
    case "news":
      return { path: `/${first}`, query: new URLSearchParams(), eventRef: null };
    case "settings":
      return { path: "/team", query: pick(search, ["invite"]), eventRef: null };
    case "import":
      return { path: "/team/import", query: new URLSearchParams(), eventRef: null };
    case "events": {
      if (second === "new") {
        const query = pick(search, ["start", "end", "title", "allDay", "reminder", "occurrence"]);
        const copy = search.get("copy");
        return { path: "/events/new", query, eventRef: copy && ID.test(copy) ? { as: "copy", eventId: Number(copy) } : null };
      }
      if (second !== undefined && ID.test(second)) {
        return { path: "", query: pick(search, ["occurrence", "scope"]), eventRef: { as: "edit", eventId: Number(second) } };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * 조회를 마친 뒤의 최종 주소. eventCode 는 eventRef 의 일정 공개 코드, 못 찾았으면(삭제됨) null:
 * 상세는 달력(그날이 있으면 날짜 상세), 수정은 달력, 복제는 copy 없이 빈 폼으로
 */
export function legacyTarget(route: LegacyRoute, groupCode: string, eventCode: string | null): string {
  const q = new URLSearchParams(route.query);
  let path = route.path;
  const ref = route.eventRef;
  if (ref?.as === "detail") {
    if (eventCode) {
      path = `/events/${eventCode}`;
      if (ref.occurrence) q.set("occurrence", ref.occurrence);
    } else {
      path = "/calendar";
      if (ref.occurrence) {
        q.set("date", ref.occurrence);
        q.set("day", "1");
      }
    }
  } else if (ref?.as === "edit") {
    if (eventCode) path = `/events/${eventCode}/edit`;
    else {
      path = "/calendar";
      q.delete("occurrence");
      q.delete("scope");
    }
  } else if (ref?.as === "copy" && eventCode) {
    q.set("copy", eventCode);
  }
  const s = q.toString();
  return withTeam(`${path}${s ? `?${s}` : ""}`, groupCode);
}
