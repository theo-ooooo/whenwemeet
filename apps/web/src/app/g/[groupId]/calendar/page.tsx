import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { CalendarScreen } from "@/screens/CalendarScreen";

export const metadata: Metadata = { title: "달력" };

// 선택 날짜(?date)와 보던 달(?month)은 CalendarScreen 이 주소에서 직접 읽는다 (#81)
export default async function CalendarPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <CalendarScreen groupId={groupId} />;
}
