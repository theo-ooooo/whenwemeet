// 멤버 색 표시 규칙 (디자인토큰.md 2026)
// 서버는 api.md 의 MEMBER_COLORS 8색 중 하나를 저장한다(배정 순서 = 팔레트 순서).
// 화면에서는 팔레트 순번을 2026 멤버 색 5개(레드, 블루, 보라, 그린, 오렌지)로 순환해 보여준다.
// CSS 변수로 돌려주므로 라이트/다크에 따라 값이 바뀐다.
import { MEMBER_COLORS } from "./types";

const DISPLAY = ["var(--m1)", "var(--m2)", "var(--m3)", "var(--m4)", "var(--m5)"] as const;

/** 서버 색(hex) → 화면 색(CSS 값). 팔레트 밖 값(탈퇴한 멤버 회색 등)은 그대로 */
export function memberColor(hex: string | null | undefined): string {
  if (!hex) return "var(--mute)";
  const i = MEMBER_COLORS.findIndex((c) => c.toUpperCase() === hex.toUpperCase());
  return i < 0 ? hex : DISPLAY[i % DISPLAY.length];
}

/** 설정 화면 팔레트: 화면에서 서로 다르게 보이는 앞 5색만 고를 수 있게 한다 */
export const PICKABLE_COLORS = MEMBER_COLORS.slice(0, DISPLAY.length);

/** 순번 → 화면 색 (사이드바 팀 목록처럼 서버 색이 없는 곳) */
export function cycleColor(i: number): string {
  return DISPLAY[((i % DISPLAY.length) + DISPLAY.length) % DISPLAY.length];
}

/** 멤버 색 바탕 위 글자색. 밝은 그린/오렌지(4, 5번째) 위에는 먹색, 나머지는 흰색 */
export function onMemberColor(hex: string | null | undefined): string {
  if (!hex) return "#ffffff";
  const i = MEMBER_COLORS.findIndex((c) => c.toUpperCase() === hex.toUpperCase());
  return i >= 0 && i % DISPLAY.length >= 3 ? "#0f0f10" : "#ffffff";
}
