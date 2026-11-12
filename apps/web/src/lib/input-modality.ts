// (#339) 마지막 입력이 키보드였는지. 화면이 프로그램으로 옮기는 포커스(일 상세 패널 제목)의 테두리를
// 키보드로 열었을 때만 보이게 한다. 브라우저의 :focus-visible 판단은 스크립트 포커스에서 엇갈린다
// (주소로 바로 연 패널, 사파리의 마우스 클릭은 테두리를 그린다). React 를 import 하지 않는다 (단위 테스트 대상)

type Modality = "keyboard" | "pointer" | null;

let last: Modality = null;

/** 수정 키만 누른 것은 입력 방식으로 치지 않는다 (Cmd+클릭 등) */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function lastInputWasKeyboard(): boolean {
  return last === "keyboard";
}

/** 문서의 키, 포인터 입력을 지켜본다. 되돌리는 함수를 준다 (AppShell 이 마운트 때 건다) */
export function trackInputModality(target: Pick<Document, "addEventListener" | "removeEventListener"> = document): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!MODIFIERS.has(e.key)) last = "keyboard";
  };
  const onPointer = () => {
    last = "pointer";
  };
  target.addEventListener("keydown", onKey, true);
  target.addEventListener("pointerdown", onPointer, true);
  return () => {
    target.removeEventListener("keydown", onKey, true);
    target.removeEventListener("pointerdown", onPointer, true);
  };
}

/** 테스트용: 기록을 처음(아무 입력 없음, 주소로 바로 연 상태)으로 */
export function resetInputModality(): void {
  last = null;
}
