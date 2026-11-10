// 멤버 색 표시 규칙 (디자인토큰.md "2026-11 확정: 밀도 조정 + 색 A", D-57)
// 서버는 api.md 의 MEMBER_COLORS 8개 hex 중 하나를 저장한다(배정 순서 = 팔레트 순서). hex 는 사실상 키다.
// 화면은 그 순번을 멤버 색 7개(--m1 ~ --m7, 빨강과 주황 없음)로 바꿔 그린다. DB 는 건드리지 않는다.
// 순번 7(8번째 키)은 블루와 겹치지 않게 --m7(슬레이트)로 따로 보낸다. API 는 새 배정에 앞 7개만 쓴다.
// CSS 변수로 돌려주므로 라이트/다크에 따라 값이 바뀐다.
import { MEMBER_COLORS } from "./types";

const DISPLAY = ["var(--m1)", "var(--m2)", "var(--m3)", "var(--m4)", "var(--m5)", "var(--m6)", "var(--m7)"] as const;

/** 팔레트 순번 → 화면 색 순번. 0~6 은 그대로, 7 이상(옛 8번째 키)은 마지막 색 */
export function displayIndex(i: number): number {
  return i < DISPLAY.length ? i : DISPLAY.length - 1;
}

/** 서버 색(hex) → 화면 색(CSS 값). 팔레트 밖 값(탈퇴한 멤버 회색 등)은 그대로 */
export function memberColor(hex: string | null | undefined): string {
  if (!hex) return "var(--mute)";
  const i = MEMBER_COLORS.findIndex((c) => c.toUpperCase() === hex.toUpperCase());
  return i < 0 ? hex : DISPLAY[displayIndex(i)];
}

/** 설정 화면 팔레트: 화면 색 7개에 대응하는 앞 7개 키만 고를 수 있다 */
export const PICKABLE_COLORS = MEMBER_COLORS.slice(0, DISPLAY.length);

/** 순번 → 화면 색 (사이드바 팀 목록처럼 서버 색이 없는 곳) */
export function cycleColor(i: number): string {
  return DISPLAY[((i % DISPLAY.length) + DISPLAY.length) % DISPLAY.length];
}

/** 멤버 색 바탕 위 글자색. 7색 모두 라이트는 흰색, 다크는 #121214 */
export const ON_MEMBER_COLOR = "var(--on-member)";

/** 화면 색 이름 (스크린리더 라벨). PICKABLE_COLORS 와 같은 순서 */
export const COLOR_NAMES = ["블루", "머스터드", "틸", "바이올렛", "그린", "브라운", "슬레이트"] as const;
