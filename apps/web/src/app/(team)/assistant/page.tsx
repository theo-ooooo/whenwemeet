import type { Metadata } from "next";
import { AssistantScreen } from "@/screens/AssistantScreen";

export const metadata: Metadata = { title: "볼까" };

/** (#450) AI 비서 "볼까" 전체 화면 (폰). 넓은 화면은 달력 오른쪽 패널이 주로 쓰고, 이 주소로 들어오면 본문 가운데 한 화면 (AI-비서.md 7-2, 7-3) */
export default function AssistantPage() {
  return <AssistantScreen />;
}
