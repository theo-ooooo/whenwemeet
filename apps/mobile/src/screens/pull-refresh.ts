// (#415) 당겨서 새로고침을 켤지 정한다. 순수 함수만 두고 WebScreen 이 쓴다.
// 화면 중간에서 위로 올리던 손짓이 맨 위에 닿은 뒤 계속 끌리면 새로고침으로 이어졌다(웹뷰 스크롤 0 이 되는 순간 켰기 때문).
// 그래서 "손가락을 댈 때 이미 맨 위였는가" 로 판정한다. 맨 위를 벗어나면 바로 끈다.

// (#419) 웹 문서가 맨 위여도 모달(바텀 시트)이나 안쪽 스크롤 영역에서 시작한 손짓은 웹이 webAllow=false 로 알린다.

export type PullRefresh = { atTop: boolean; armed: boolean; webAllow: boolean };

export const PULL_REFRESH_INITIAL: PullRefresh = { atTop: true, armed: true, webAllow: true };

/** 웹뷰 스크롤 이벤트. 맨 위를 벗어나면 즉시 끄고, 맨 위에 닿아도 켜지는 않는다 (다음 손짓 시작에 켠다) */
export function pullOnScroll(s: PullRefresh, y: number): PullRefresh {
  const atTop = y <= 0;
  if (atTop) return s.atTop ? s : { ...s, atTop: true };
  return s.atTop || s.armed ? { ...s, atTop: false, armed: false } : s;
}

/** 손가락을 댈 때. 이때 맨 위였을 때만 이번 손짓에서 새로고침을 허용한다 */
export function pullOnTouchStart(s: PullRefresh): PullRefresh {
  return s.armed === s.atTop ? s : { ...s, armed: s.atTop };
}

/** (#419) 웹이 이번 손짓의 시작 위치를 알려 온다 (모달 안, 위로 스크롤된 안쪽 영역이면 false) */
export function pullOnWebAllow(s: PullRefresh, allow: boolean): PullRefresh {
  return s.webAllow === allow ? s : { ...s, webAllow: allow };
}

/** 실제로 새로고침을 켤지 */
export function pullEnabled(s: PullRefresh): boolean {
  return s.armed && s.webAllow;
}
