// (#419) 앱 셸의 당겨서 새로고침을 이번 손짓에서 막을지 판정한다. 셸은 웹뷰 문서 스크롤만 보므로
// 모달(바텀 시트)이나 안쪽 스크롤 영역(주간 보기 등)에서 위로 올리는 손짓을 웹이 알려 준다. 판정은 순수 함수, 연결은 components/PullRefreshGuard

/** 판정에 쓰는 요소 모양 (테스트에서 DOM 없이 만들 수 있게 필요한 칸만) */
export type GuardNode = {
  parentElement: GuardNode | null;
  getAttribute(name: string): string | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** 모달, 다이얼로그 */
function isDialog(n: GuardNode): boolean {
  return n.getAttribute("aria-modal") === "true" || n.getAttribute("role") === "dialog";
}

/**
 * 손가락이 닿은 요소에서 위로 올라가며 본다. 모달 안이면 막는다(시트를 끌어 내리는 손짓과 겹친다).
 * 세로로 스크롤되는 안쪽 영역이 이미 위로 스크롤돼 있으면 막는다(그 영역을 위로 올리는 손짓이다)
 */
export function blocksPullRefresh(target: GuardNode | null, overflowY: (n: GuardNode) => string, anyModalOpen: boolean): boolean {
  if (anyModalOpen) return true;
  for (let n = target; n; n = n.parentElement) {
    if (isDialog(n)) return true;
    const o = overflowY(n);
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0) return true;
  }
  return false;
}
