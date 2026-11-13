// (#192) 달력 보기 (월 | 주). React 를 import 하지 않는다 (단위 테스트 대상)
// - 주소 `?view=week` 가 우선 (새로고침, 공유, 뒤로가기). 월은 쿼리를 붙이지 않는다 (기본, Q4)
// - 주소에 없으면 기기별 마지막 선택 `localStorage.wwm_cal_view` (서버에 두지 않는다. 사이드바 접기 D-200 과 같은 이유)
export const CAL_VIEW_KEY = "wwm_cal_view";
export type CalView = "month" | "week";

export function parseCalView(raw: string | null | undefined): CalView | null {
  return raw === "month" || raw === "week" ? raw : null;
}

/** 지금 보기: 주소 → 저장값 → 월 */
export function resolveCalView(param: string | null | undefined, pref: CalView | null): CalView {
  return parseCalView(param) ?? pref ?? "month";
}

export function readCalView(storage: Pick<Storage, "getItem"> | null | undefined): CalView | null {
  try {
    return parseCalView(storage?.getItem(CAL_VIEW_KEY));
  } catch {
    return null;
  }
}

export function writeCalView(storage: Pick<Storage, "setItem"> | null | undefined, view: CalView): void {
  try {
    storage?.setItem(CAL_VIEW_KEY, view);
  } catch {
    // 저장이 안 돼도 이번 화면에서는 바뀐 대로 둔다
  }
}

/** 주소(search)에 보기를 입힌 새 search ("?" 포함, 비면 ""). 바뀔 게 없으면 null. 주는 view=week, 월은 뗀다 */
export function withCalView(search: string, view: CalView): string | null {
  const q = new URLSearchParams(search);
  const want = view === "week" ? "week" : null;
  if (q.get("view") === want) return null;
  if (want) q.set("view", want);
  else q.delete("view");
  const s = q.toString();
  return s ? `?${s}` : "";
}
