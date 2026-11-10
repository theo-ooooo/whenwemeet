// 작성 중인 화면에서 벗어나기 전 확인 (#137).
// 작성 화면이 setLeaveGuard 로 확인 함수를 걸어 두면, 링크가 아닌 화면 이동(팀 전환 등)은 confirmLeave 를 거친다.
// 링크(<a href>) 클릭은 작성 화면이 문서 캡처 단계에서 직접 가로챈다 (useLeaveGuard)

type Guard = (go: () => void) => void;

let current: Guard | null = null;

/** 작성 화면이 마운트 중일 때만 건다. null 이면 해제 */
export function setLeaveGuard(guard: Guard | null): void {
  current = guard;
}

/** 확인이 걸려 있으면 확인 뒤에, 아니면 바로 go 를 부른다 */
export function confirmLeave(go: () => void): void {
  if (current) current(go);
  else go();
}

/** 클릭한 링크가 이 앱 안 다른 화면으로 가는 일반 클릭인지 (새 탭, 수정 키, 같은 주소, 다운로드는 아님) */
export function isInternalNavClick(
  e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  anchor: { href: string; target: string; hasDownload: boolean },
  current: { origin: string; href: string },
): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (anchor.hasDownload || (anchor.target && anchor.target !== "_self")) return false;
  let url: URL;
  try {
    url = new URL(anchor.href, current.href);
  } catch {
    return false;
  }
  if (url.origin !== current.origin) return false;
  const here = new URL(current.href);
  return url.pathname + url.search !== here.pathname + here.search;
}
