import { ScreenLoading } from "@/components/ScreenLoading";
import { TODOS_PATH } from "@/lib/routes";

// (#339) 위 화면의 loading 제목이 이 화면에 비치지 않게 제목 없는 뼈대.
// (#552) 머리줄(‹)은 화면과 같게 그려 폰에서 위쪽 바가 잠깐 비치지 않게 한다
export default function Loading() {
  return <ScreenLoading back={{ fallbackHref: TODOS_PATH, backLabel: "할 일 목록으로" }} />;
}
