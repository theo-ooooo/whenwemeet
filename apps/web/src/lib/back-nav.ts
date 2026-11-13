// (#378) 하위 화면 머리줄 "‹" 의 뒤로 판단. React 를 import 하지 않는다 (단위 테스트 대상).
// 이 앱 안에서 넘어온 화면이면 브라우저 뒤로(스크롤, 앞 화면 상태 유지), 알림이나 외부 링크로 바로 열었으면 정해 둔 화면(fallback)으로.
// 판단 근거:
//   1. 처음 문서를 연 주소와 지금 경로가 다르면 이 문서 안에서 앱 이동이 있었다 → 바로 앞 기록은 이 앱 화면
//      (검색 화면처럼 검색어만 replaceState 로 바꾸는 경우를 빼려고 경로만 비교한다)
//   2. 같다면 이 문서를 연 앞 페이지(referrer)가 같은 출처일 때만 (앱 안 링크를 새로 고침 없이 연 경우)
//   3. 기록이 하나뿐이면(새 탭, 앱 셸 첫 화면) 무조건 fallback

export type BackContext = {
  historyLength: number;
  /** 처음 문서를 연 주소 (performance navigation 항목). 모르면 null */
  initialUrl: string | null;
  currentUrl: string;
  referrer: string;
};

const pathOf = (url: string): string | null => {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
};

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export function canGoBackInApp(c: BackContext): boolean {
  if (c.historyLength <= 1) return false;
  const current = pathOf(c.currentUrl);
  const initial = c.initialUrl ? pathOf(c.initialUrl) : null;
  if (initial !== null && current !== null && initial !== current) return true;
  const here = originOf(c.currentUrl);
  return here !== null && c.referrer !== "" && originOf(c.referrer) === here;
}

/** 브라우저에서 지금 상태로 판단. 서버 렌더 중이면 false */
export function canGoBack(): boolean {
  if (typeof window === "undefined") return false;
  let initialUrl: string | null = null;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    initialUrl = nav?.name ?? null;
  } catch {
    initialUrl = null;
  }
  return canGoBackInApp({ historyLength: window.history.length, initialUrl, currentUrl: window.location.href, referrer: document.referrer });
}
