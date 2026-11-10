import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { UpcomingScreen } from "@/screens/UpcomingScreen";

export const metadata: Metadata = { title: "다가오는 일정" };

export default async function UpcomingPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <UpcomingScreen groupId={groupId} />;
}
