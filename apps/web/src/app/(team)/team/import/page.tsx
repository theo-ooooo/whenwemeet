import type { Metadata } from "next";
import { ImportScreen } from "@/screens/ImportScreen";

export const metadata: Metadata = { title: "일정 가져오기" };

// (#279) 팀 설정 > 일정 가져오기 (.ics). (#311) 옛 /g/<id>/import
export default function ImportPage() {
  return <ImportScreen />;
}
