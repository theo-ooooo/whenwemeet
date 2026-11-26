import { ScreenLoading } from "@/components/ScreenLoading";
import { CALENDAR_PATH } from "@/lib/routes";

// (#339) 메뉴를 누르면 서버 응답 전에 바로 이 뼈대로 바뀐다
// (#552, D-295) 화면과 같은 ‹ 머리줄. 폰에서 뼈대 동안에도 앱 위쪽 바를 숨긴다
export default function Loading() {
  return <ScreenLoading title="다가오는 일정" back={{ fallbackHref: CALENDAR_PATH, backLabel: "달력으로", phoneOnly: true }} />;
}
