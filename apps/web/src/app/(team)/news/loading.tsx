import { ScreenLoading } from "@/components/ScreenLoading";

// (#339) 메뉴를 누르면 서버 응답 전에 바로 이 뼈대로 바뀐다
export default function Loading() {
  return <ScreenLoading title="새 소식" />;
}
