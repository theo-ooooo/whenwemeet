// 테마: 시스템(기본) / 라이트 / 다크. 수동 선택만 localStorage 에 남기고 <html data-theme> 로 적용한다.
// 첫 페인트 전에 적용하는 인라인 스크립트(THEME_SCRIPT)는 app/layout.tsx 의 <head> 에 넣는다.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "wwm_theme";

/** <head> 인라인 스크립트. 저장값이 light/dark 일 때만 data-theme 를 단다 (system 은 미디어 쿼리에 맡김) */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

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
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
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
