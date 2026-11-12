import type { Metadata } from "next";
import { CalendarScreen } from "@/screens/CalendarScreen";

export const metadata: Metadata = { title: "달력" };

// 선택 날짜(?date)와 보던 달(?month), 날짜 상세(?day=1)는 CalendarScreen 이 주소에서 직접 읽는다 (#81). 팀은 AppShell (#311)
export default function CalendarPage() {
  return <CalendarScreen />;
}
