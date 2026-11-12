// 멤버 색, 일정 색 표시 규칙 (디자인토큰.md "멤버 색", D-57, D-215)
// 서버는 api.md 의 MEMBER_COLORS 8개 hex 중 하나를 저장한다(배정 순서 = 팔레트 순서). hex 는 사실상 키다.
// 화면은 그 순번을 화면 색 8개(--m1 ~ --m8, 빨강과 주황 없음)로 바꿔 그린다. DB 는 건드리지 않는다.
// (#343) 순번 7(8번째 키 #F279B5)은 핑크 --m8. 예전에는 슬레이트(--m7)로 보냈다. 멤버 색과 일정 색이 같은 8색을 쓴다.
// CSS 변수로 돌려주므로 라이트/다크에 따라 값이 바뀐다.
import { MEMBER_COLORS } from "./types";

const DISPLAY = ["var(--m1)", "var(--m2)", "var(--m3)", "var(--m4)", "var(--m5)", "var(--m6)", "var(--m7)", "var(--m8)"] as const;

/** 팔레트 순번 → 화면 색 순번. 0~7 은 그대로 (팔레트와 화면 색이 같은 8개) */
export function displayIndex(i: number): number {
  return i < DISPLAY.length ? i : DISPLAY.length - 1;
}

/** 서버 색(hex) → 화면 색(CSS 값). 팔레트 밖 값(탈퇴한 멤버 회색 등)은 그대로 */
export function memberColor(hex: string | null | undefined): string {
  if (!hex) return "var(--mute)";
  const i = MEMBER_COLORS.findIndex((c) => c.toUpperCase() === hex.toUpperCase());
  return i < 0 ? hex : DISPLAY[displayIndex(i)];
}

/** 설정 화면(내 색), 일정 폼(일정 색) 팔레트: 8개 키 모두 (D-215) */
export const PICKABLE_COLORS = MEMBER_COLORS.slice(0, DISPLAY.length);

/** 순번 → 화면 색 (사이드바 팀 목록처럼 서버 색이 없는 곳) */
export function cycleColor(i: number): string {
  return DISPLAY[((i % DISPLAY.length) + DISPLAY.length) % DISPLAY.length];
}

/** 멤버 색 바탕 위 글자색. 8색 모두 라이트는 흰색, 다크는 #121214 */
export const ON_MEMBER_COLOR = "var(--on-member)";

/** 화면 색 이름 (스크린리더 라벨). PICKABLE_COLORS 와 같은 순서 */
export const COLOR_NAMES = ["블루", "머스터드", "틸", "바이올렛", "그린", "브라운", "슬레이트", "핑크"] as const;

/* ---------- (#343) 일정 색 (D-215) ---------- */

/** 일정 색 이름 (스크린리더 라벨, 폼 줄 값). null 이면 "자동", 팔레트 밖이면 "지금 색" */
export function eventColorName(color: string | null): string {
  if (color === null) return "자동";
  const i = PICKABLE_COLORS.findIndex((c) => c.toUpperCase() === color.toUpperCase());
  return i < 0 ? "지금 색" : COLOR_NAMES[i];
}

/** 같은 일정 색인지 (대소문자 무시, null = 자동) */
export function sameEventColor(a: string | null, b: string | null): boolean {
  return (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
}

/** 수정에서 일정 색을 바꿨는지. 반복 일정이면 범위 시트가 "이 일정만" 을 막는다 (참여자와 같은 규칙) */
export function eventColorChanged(o: { editing: boolean; current: string | null; initial: string | null }): boolean {
  return o.editing && !sameEventColor(o.current, o.initial);
}

/**
 * 본문에 실을 color. undefined 면 싣지 않는다
 * - 반복 "이 일정만" 은 싣지 않는다 (서버 400)
 * - 생성: 고른 색만 (자동이면 생략)
 * - 수정: 바꿨을 때만. 자동으로 되돌리면 null
 */
export function eventColorBody(o: { editing: boolean; thisOnly: boolean; current: string | null; initial: string | null }): string | null | undefined {
  if (o.thisOnly) return undefined;
  if (!o.editing) return o.current ?? undefined;
  return eventColorChanged(o) ? o.current : undefined;
}
