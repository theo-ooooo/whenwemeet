// 화면 폭 구간 (docs/설계/폴더블.md 3장, D-58). JS 판단과 Tailwind 변형(fold:, lg:, wide:) 이 같은 경계를 쓴다
//   phone <600 : 지금 모바일 1단, 날짜 상세 = 바텀 시트
//   fold 600~1023 : 레일 + 2단, 날짜 상세 = 날짜 칸 옆 팝오버
//   pc ≥1024 : 2단 (1024~1199 는 레일, 1200 부터 사이드바), 날짜 상세 = 팝오버
// React 를 import 하지 않는다 (단위 테스트 대상)

export type Layout = "phone" | "fold" | "pc";

export const FOLD_MIN = 600;
export const PC_MIN = 1024;
/** 이 폭부터 레일 대신 PC 사이드바 */
export const SIDEBAR_MIN = 1200;

export const FOLD_QUERY = `(min-width: ${FOLD_MIN}px)`;
export const PC_QUERY = `(min-width: ${PC_MIN}px)`;

/** 폭(CSS px) → 배치 */
export function layoutOf(width: number): Layout {
  if (width >= PC_MIN) return "pc";
  if (width >= FOLD_MIN) return "fold";
  return "phone";
}

/** 왼쪽 레일을 쓰는 폭인지 (600~1199) */
export function hasRail(width: number): boolean {
  return width >= FOLD_MIN && width < SIDEBAR_MIN;
}

/** matchMedia 두 개의 결과 → 배치 (useLayout 이 쓴다) */
export function layoutFromMatches(fold: boolean, pc: boolean): Layout {
  return pc ? "pc" : fold ? "fold" : "phone";
}
