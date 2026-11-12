// (#315) 사이드바 접기 상태. React 를 import 하지 않는다 (단위 테스트 대상).
// - 기기별 localStorage `wwm_sidebar` = "collapsed" | "expanded". 서버에 두지 않는다 (화면 크기 취향은 기기마다 다르다)
// - 저장값이 없으면 기본값: fold(600~1023) 접힘, pc(≥1024) 펼침. 한 번 바꾸면 그 값을 지킨다 (폭이 바뀌어도)
// - 폰(<600)은 사이드바가 없으니 해당 없음
import type { Layout } from "./layout";

export const SIDEBAR_KEY = "wwm_sidebar";
export type SidebarPref = "collapsed" | "expanded";

/** 펼친 폭, 접힌 레일 폭 (디자인규칙.md 2-2) */
export const SIDEBAR_EXPANDED_W = 264;
export const SIDEBAR_RAIL_W = 72;

export function parseSidebarPref(raw: string | null | undefined): SidebarPref | null {
  return raw === "collapsed" || raw === "expanded" ? raw : null;
}

/** 지금 접혔는가. 저장값이 우선, 없으면 fold 접힘 / pc 펼침 */
export function isCollapsed(pref: SidebarPref | null, layout: Layout): boolean {
  if (pref) return pref === "collapsed";
  return layout === "fold";
}

/** 저장값 읽기. 막힌 저장소(사생활 보호 모드 등)는 null */
export function readSidebarPref(storage: Pick<Storage, "getItem"> | null | undefined): SidebarPref | null {
  try {
    return parseSidebarPref(storage?.getItem(SIDEBAR_KEY));
  } catch {
    return null;
  }
}

export function writeSidebarPref(storage: Pick<Storage, "setItem"> | null | undefined, pref: SidebarPref): void {
  try {
    storage?.setItem(SIDEBAR_KEY, pref);
  } catch {
    // 저장이 안 돼도 이번 화면에서는 바뀐 대로 둔다
  }
}
