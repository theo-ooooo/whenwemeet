import { ScreenLoading } from "@/components/ScreenLoading";

// (#378) 내 정보도 팀 화면 뼈대(AppShell) 안이라 누르면 바로 이 뼈대로 바뀐다
export default function Loading() {
  return <ScreenLoading title="내 정보" />;
}
