// 화면 폭 구간 (docs/설계/폴더블.md 3장, D-58, D-69). JS 판단과 Tailwind 변형(fold:, lg:) 이 같은 경계를 쓴다
//   phone <600 : 모바일 1단(머리줄 + 유리 알약 독 + FAB), 날짜 상세 = 일 상세 화면
//   fold 600~1023, pc ≥1024 : 왼쪽 사이드바 264 + 본문(바깥 여백 28 32), 날짜 상세 = 날짜 칸 옆 팝오버 (디자인규칙.md 2-2, #212)
// React 를 import 하지 않는다 (단위 테스트 대상)

export type Layout = "phone" | "fold" | "pc";

export const FOLD_MIN = 600;
export const PC_MIN = 1024;

export const FOLD_QUERY = `(min-width: ${FOLD_MIN}px)`;
export const PC_QUERY = `(min-width: ${PC_MIN}px)`;

/** 폭(CSS px) → 배치 */
export function layoutOf(width: number): Layout {
  if (width >= PC_MIN) return "pc";
  if (width >= FOLD_MIN) return "fold";
  return "phone";
}

/** 사이드바 폭과 본문 좌우 바깥 여백(32 + 32). AppShell 의 fold:grid-cols-[264px_…], fold:px-8 과 같은 값 */
export const SIDEBAR_W = 264;
const MAIN_PAD_X = 64;

/** 넓은 화면(≥600) 본문 폭(CSS px). 달력 타일과 요약 카드 3열이 이 폭을 나눠 쓴다 */
export function mainWidthOf(width: number): number {
  return width - SIDEBAR_W - MAIN_PAD_X;
}

/** matchMedia 두 개의 결과 → 배치 (useLayout 이 쓴다) */
export function layoutFromMatches(fold: boolean, pc: boolean): Layout {
  return pc ? "pc" : fold ? "fold" : "phone";
}
