// (#311) 주소 규칙. 주소에 팀 번호를 두지 않는다 (D-196 ~ D-199). React 를 import 하지 않는다 (단위 테스트 대상)
//   /calendar /upcoming /free /anniversaries /news /team /team/import /events/new   ← 팀은 쿠키 wwm_group (지금 보는 팀)
//   /events/<일정 공개 코드>[?occurrence=]        일정 상세 (달력 위 시트/오른쪽 패널, 새로 고침해도 같은 화면)
//   /events/<일정 공개 코드>/edit[?occurrence=&scope=]   일정 수정 화면
//   /todos, /todos/<목록 공개 코드>                 (#276) 할 일 목록, 목록 상세
//   ?team=<팀 공개 코드>  팀을 지정해야 할 때만 (알림, 위젯, 공유, 내 정보의 팀 목록). AppShell 이 쿠키를 바꾸고 주소에서 뗀다
// 옛 /g/<id>/... 는 lib/legacy-routes.ts 가 308 로 새 주소에 맞춘다

/** 팀을 지정하는 쿼리 이름 */
export const TEAM_PARAM = "team";

/** API common/public-code.ts 와 같은 모양: 소문자 영숫자 8자. 대문자는 소문자로 맞춰 받는다 */
export const PUBLIC_CODE_PATTERN = /^[a-z0-9]{8}$/;

export function parsePublicCode(raw: string | string[] | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return PUBLIC_CODE_PATTERN.test(code) ? code : null;
}

/** 팀 안 화면 (주소 첫 조각). settings → team, import → team/import 로 이름이 바뀌었다 */
export const SCREENS = ["calendar", "upcoming", "free", "anniversaries", "todos", "news", "team", "events"] as const;
export type Screen = (typeof SCREENS)[number];

export const CALENDAR_PATH = "/calendar";
export const UPCOMING_PATH = "/upcoming";
export const FREE_PATH = "/free";
export const ANNIVERSARIES_PATH = "/anniversaries";
/** (#276) 할 일 목록 */
export const TODOS_PATH = "/todos";
export const NEWS_PATH = "/news";
export const TEAM_PATH = "/team";
export const IMPORT_PATH = "/team/import";
export const NEW_EVENT_PATH = "/events/new";

const qs = (q: URLSearchParams | Record<string, string | null | undefined>): string => {
  const params = q instanceof URLSearchParams ? q : new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const s = params.toString();
  return s ? `?${s}` : "";
};

/** 팀 설정. `?invite=1` 이면 초대 섹션을 연 채로 (팀 만들기 직후, 함께 안내) */
export function teamHref(opts: { invite?: boolean } = {}): string {
  return `${TEAM_PATH}${opts.invite ? "?invite=1" : ""}`;
}

/** 달력. date, month 등 달력 쿼리는 그대로 싣는다 */
export function calendarHref(query: Record<string, string | null | undefined> = {}): string {
  return `${CALENDAR_PATH}${qs(query)}`;
}

/** 일정 상세 `/events/<코드>`. 반복 회차면 `?occurrence=` */
export function eventHref(ev: { publicCode: string; occurrence?: string | null }): string {
  return `/events/${ev.publicCode}${ev.occurrence ? `?occurrence=${ev.occurrence}` : ""}`;
}

/** 일정 수정 화면 `/events/<코드>/edit`. 반복 회차면 `?occurrence=`, 범위를 미리 정했으면 `&scope=` */
export function eventEditHref(ev: { publicCode: string; occurrence?: string | null }, scope?: "this" | "following" | null): string {
  return `/events/${ev.publicCode}/edit${qs({ occurrence: ev.occurrence ?? null, scope: scope ?? null })}`;
}

/** 새 일정. start, end 는 ISO, copy 는 복제할 일정의 공개 코드 (+ 회차), 빠른 추가의 title, allDay, reminder */
export function newEventHref(query: URLSearchParams | Record<string, string | null | undefined> = {}): string {
  return `${NEW_EVENT_PATH}${qs(query)}`;
}

/** 일정 복제 주소. 반복 회차면 그 회차 값으로 채우게 occurrence 를 같이 */
export function eventCopyHref(ev: { publicCode: string; occurrence?: string | null }): string {
  return newEventHref({ copy: ev.publicCode, occurrence: ev.occurrence ?? null });
}

/** (#276) 할 일 목록 상세 `/todos/<목록 공개 코드>` */
export function todoListHref(list: { publicCode: string }): string {
  return `${TODOS_PATH}/${list.publicCode}`;
}

/** (#276) 목록 화면. `new` 면 만들기 시트를 연 채로 */
export function todosHref(opts: { create?: boolean } = {}): string {
  return `${TODOS_PATH}${opts.create ? "?new=1" : ""}`;
}

/** 주소에 `?team=<코드>` 를 붙인다 (이미 있으면 바꾼다). 해시는 유지 */
export function withTeam(href: string, groupCode: string): string {
  const [rest, hash] = href.split("#", 2);
  const [path, search = ""] = rest.split("?", 2);
  const q = new URLSearchParams(search);
  q.set(TEAM_PARAM, groupCode);
  return `${path}?${q.toString()}${hash !== undefined ? `#${hash}` : ""}`;
}

/** search 문자열(`?` 포함 또는 제외)에서 team 을 뗀 search. 비면 "" */
export function stripTeam(search: string): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  q.delete(TEAM_PARAM);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type RouteInfo = {
  /** 첫 조각. 아는 화면이 아니면 null */
  screen: Screen | null;
  /** `/events/<코드>` 의 코드 (상세, 수정). `new` 나 코드 모양이 아니면 null */
  eventCode: string | null;
  /** 작성/수정 화면 (`/events/new`, `/events/<코드>/edit`) 과 가져오기. 폰 독과 + 를 숨긴다 */
  form: boolean;
  /** 일정 상세 주소 (`/events/<코드>`). 달력 화면이 그린다 */
  eventDetail: boolean;
  /** (#276) `/todos/<코드>` 의 목록 코드. 목록 화면이나 코드 모양이 아니면 null */
  todoCode: string | null;
};

/** 주소 → 화면 정보. 사이드바 선택, 폰 독 표시, 팀 전환 뒤 갈 곳을 정한다 */
export function routeInfo(pathname: string): RouteInfo {
  const seg = pathname.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  const first = seg[0] ?? "";
  const screen = (SCREENS as readonly string[]).includes(first) ? (first as Screen) : null;
  if (screen === "events") {
    if (seg[1] === "new") return { screen, eventCode: null, form: true, eventDetail: false, todoCode: null };
    const code = parsePublicCode(seg[1]);
    if (code === null) return { screen, eventCode: null, form: false, eventDetail: false, todoCode: null };
    const edit = seg[2] === "edit";
    return { screen, eventCode: code, form: edit, eventDetail: !edit && seg.length === 2, todoCode: null };
  }
  const todoCode = screen === "todos" ? parsePublicCode(seg[1]) : null;
  return { screen, eventCode: null, form: screen === "team" && seg[1] === "import", eventDetail: false, todoCode };
}

/** 사이드바와 폰 독에서 켤 항목. 다가오는 일정 목록(#222)과 일정 화면은 달력에 딸린 화면 */
export function activeTab(pathname: string): "calendar" | "upcoming" | "free" | "anniversaries" | "todos" | "news" | "team" | null {
  const { screen } = routeInfo(pathname);
  if (screen === "events") return "calendar";
  return screen;
}

/**
 * 팀을 바꾼 뒤 머물 곳. 화면은 그대로, 다른 팀의 일정을 가리키는 주소(`/events/<코드>`...)와 가져오기 완료 화면만 달력으로.
 * (#276) 다른 팀의 할 일 목록 상세(`/todos/<코드>`)는 목록 화면으로.
 * null 이면 주소를 바꾸지 않는다 (같은 화면, 데이터만 새 팀)
 */
export function afterTeamSwitch(pathname: string): string | null {
  const { screen, eventCode, todoCode } = routeInfo(pathname);
  if (screen === null) return CALENDAR_PATH;
  if (todoCode !== null) return TODOS_PATH;
  return eventCode !== null ? CALENDAR_PATH : null;
}
