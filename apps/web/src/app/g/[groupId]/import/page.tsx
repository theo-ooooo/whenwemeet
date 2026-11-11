import type { Metadata } from "next";
import { idParam } from "@/lib/id";
import { ImportScreen } from "@/screens/ImportScreen";

export const metadata: Metadata = { title: "일정 가져오기" };

// (#279) 팀 설정 > 일정 가져오기 (.ics)
export default async function ImportPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = idParam((await params).groupId);
  return <ImportScreen groupId={groupId} />;
}
