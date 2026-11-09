// 테마: 시스템(기본) / 라이트 / 다크. 수동 선택만 localStorage 에 남기고 <html data-theme> 로 적용한다.
// 첫 페인트 전에 적용하는 인라인 스크립트(THEME_SCRIPT)는 app/layout.tsx 의 <head> 에 넣는다.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "wwm_theme";

/** <head> 인라인 스크립트. 저장값이 light/dark 일 때만 data-theme 를 단다 (system 은 미디어 쿼리에 맡김).
 *  시스템 라이트/다크가 바뀔 때는 전환 순간에만 transition 을 끈다(withoutTransition 과 같은 방식).
 *  그렇지 않으면 날짜 칸처럼 color/background 에 transition 이 걸린 요소가 이전 테마 색에서 출발해,
 *  렌더가 멈춘 탭(백그라운드)에서는 흐린 중간색으로 남는다 (#24 리뷰) */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")d.setAttribute("data-theme",t)}catch(e){}try{window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(){d.setAttribute("data-theme-switching","");getComputedStyle(d.querySelector("body")||d).color;requestAnimationFrame(function(){d.removeAttribute("data-theme-switching")})})}catch(e){}})()`;

/** 테마 변수만 바꾸고 그 순간의 transition 은 건너뛴다 */
function withoutTransition(change: () => void) {
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  change();
  // 스타일을 한 번 확정시킨 뒤 다음 프레임에 되돌린다 (새 값은 이미 확정돼 다시 애니메이션되지 않음)
  void getComputedStyle(document.body).color;
  requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
}

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  withoutTransition(() => {
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  });
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // 저장이 막힌 환경(사생활 보호 모드 등)에서는 이번 방문에만 적용된다
  }
}

const EVENT = "wwm-theme";

/** useSyncExternalStore 구독: 이 탭의 변경(applyTheme) 과 다른 탭의 변경(storage) 을 모두 듣는다 */
export function subscribeTheme(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function setTheme(choice: ThemeChoice) {
  applyTheme(choice);
  window.dispatchEvent(new Event(EVENT));
}
