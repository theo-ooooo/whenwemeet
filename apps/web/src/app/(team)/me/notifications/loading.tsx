import { ScreenLoading } from "@/components/ScreenLoading";

// (#378) 내 정보도 팀 화면 뼈대(AppShell) 안이라 누르면 바로 이 뼈대로 바뀐다
// (#552, D-295) 화면과 같은 ‹ 머리줄. 폰에서 뼈대 동안에도 앱 위쪽 바를 숨긴다
export default function Loading() {
  return <ScreenLoading title="알림" back={{ fallbackHref: "/me", backLabel: "내 정보로" }} />;
}
