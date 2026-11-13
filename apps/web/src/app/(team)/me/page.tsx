import type { Metadata } from "next";
import { MeScreen } from "@/screens/MeScreen";

export const metadata: Metadata = { title: "내 정보" };

// (#378) 팀 화면 뼈대(AppShell: 머리줄, 독, 사이드바) 안으로 옮겼다. 주소는 그대로 /me
export default function MePage() {
  return <MeScreen />;
}
