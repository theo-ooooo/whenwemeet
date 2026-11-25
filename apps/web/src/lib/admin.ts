// (#515) 관리자 화면 공통 표기 (D-285, D-286). 단위 테스트 대상이라 React 를 import 하지 않는다

/** 관리자 탭. 순서 고정 */
export const ADMIN_TABS = [
  { href: "/admin/notices", label: "공지사항" },
  { href: "/admin/users", label: "사용자" },
  { href: "/admin/teams", label: "팀" },
  { href: "/admin/events", label: "일정" },
  { href: "/admin/logs", label: "기록" },
] as const;

/** 지금 주소에 맞는 탭 (하위 주소 포함). 없으면 null */
export function adminTabOf(pathname: string): string | null {
  return ADMIN_TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`))?.href ?? null;
}

const ACTION_LABEL: Record<string, string> = {
  notice_create: "공지 작성",
  notice_update: "공지 수정",
  notice_delete: "공지 삭제",
  // (#528)
  notice_push: "공지 푸시",
  user_role: "역할 변경",
  group_hide: "팀 숨김",
  group_unhide: "팀 숨김 해제",
  group_delete: "팀 삭제",
  event_hide: "일정 숨김",
  event_unhide: "일정 숨김 해제",
  event_delete: "일정 삭제",
};

export function adminActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

const TARGET_LABEL: Record<string, string> = { notice: "공지", user: "사용자", group: "팀", event: "일정" };

export function adminTargetLabel(type: string, id: number): string {
  return `${TARGET_LABEL[type] ?? type} #${id}`;
}

const PROVIDER_LABEL: Record<string, string> = { KAKAO: "카카오", APPLE: "Apple", EMAIL: "이메일", DEV: "개발" };

/** 로그인 방법 목록 → "카카오, Apple". 없으면 "-" */
export function providerText(providers: string[]): string {
  return providers.length ? providers.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") : "-";
}

/** 관리자 표의 날짜시각 "2026.11.25 14:05" (KST) */
/**
 * (#528) 관리자 화면의 팀 이름. 개인 달력은 이름이 모두 "내 달력" 이라 주인으로 부른다: "지우의 개인 달력".
 * 주인이 없으면(탈퇴로 빈 개인 달력) "개인 달력"
 */
export function adminGroupName(group: { name: string; type: string; owner: { nickname: string } | null }): string {
  if (group.type !== "PERSONAL") return group.name;
  return group.owner ? `${group.owner.nickname}의 개인 달력` : "개인 달력";
}

/** (#528) 관리자 팀 목록 종류 필터. URL `?type=` 값 (기본 team) ↔ API `type` */
export type AdminGroupFilter = "team" | "personal" | "all";
export const ADMIN_GROUP_FILTERS: { value: AdminGroupFilter; label: string }[] = [
  { value: "team", label: "팀" },
  { value: "personal", label: "개인 달력" },
  { value: "all", label: "전체" },
];
export function adminGroupFilterOf(raw: string | null): AdminGroupFilter {
  return raw === "personal" || raw === "all" ? raw : "team";
}
export function adminGroupTypeParam(filter: AdminGroupFilter): "TEAM" | "PERSONAL" | null {
  return filter === "team" ? "TEAM" : filter === "personal" ? "PERSONAL" : null;
}

export function adminDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** (#515) 관리자 일정 시각 "2026.11.25 14:05", 종일은 "2026.11.25 종일" */
export function adminEventTime(startsAt: string, allDay: boolean): string {
  const text = adminDateTime(startsAt);
  return allDay ? `${text.slice(0, 10)} 종일` : text;
}

/** (#515) 숨김 사유 상한 (API 와 같다) */
export const HIDE_REASON_MAX = 200;
